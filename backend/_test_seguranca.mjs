/**
 * Segurança (etapa 1): cota do Google Sheets na rota de imagens, limites de
 * requisição pelo IP real (trust proxy), neutralização de fórmulas na
 * planilha e a válvula RATE_LIMIT_DISABLED.
 *
 * Tudo local: planilha falsa em memória, servidores em portas aleatórias.
 * Rodar: node backend/_test_seguranca.mjs
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { registerSiteAdmin } from "./site-admin.js";
import { createSiteStore } from "./site-store.js";
import { attemptLimiter, rateLimit } from "./rate-limit.js";
import { sheetSafe } from "./sheet-safe.js";

let passed = 0;
const failures = [];
async function test(nome, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${nome}`);
  } catch (err) {
    failures.push({ nome, err });
    console.log(`  ✗ ${nome}\n      ${err.message}`);
  }
}

async function servidor(app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { base: `http://127.0.0.1:${server.address().port}`, fechar: () => new Promise((r) => server.close(r)) };
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("\nSegurança — etapa 1\n");

/* ─── Imagens: nenhuma requisição pública lê a aba inteira ─── */

function planilhaFalsa() {
  const midia = [];
  const leituras = [];
  const client = {
    spreadsheets: {
      get: async () => ({ data: { sheets: [{ properties: { title: "Site Config" } }, { properties: { title: "Site Midia" } }] } }),
      values: {
        get: async ({ range }) => {
          leituras.push(range);
          if (range.includes("Site Config")) return { data: { values: [] } };
          const linhas = /!A(\d+):D(\d+)$/.exec(range);
          const valores = linhas ? midia.slice(Number(linhas[1]) - 1, Number(linhas[2])) : midia.map((row) => row.slice(0, 3));
          return { data: { range: linhas ? range : "'Site Midia'!A1:C" + midia.length, values: valores } };
        },
        update: async () => ({}),
        append: async ({ requestBody }) => {
          const inicio = midia.length + 1;
          midia.push(...requestBody.values);
          return { data: { updates: { updatedRange: `'Site Midia'!A${inicio}:D${midia.length}` } } };
        },
      },
    },
  };
  return { client, midia, leituras };
}

await test("imagem com id inexistente responde 404 sem ler a planilha, e o 'não encontrado' fica em cache", async () => {
  const planilha = planilhaFalsa();
  const store = createSiteStore({ sheets: true, sheetsClient: planilha.client });
  const id = "ab".repeat(20);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await store.writeMedia(id, "image/png", png);

  const app = express();
  registerSiteAdmin(app, { store, password: "senha-do-teste" });
  const { base, fechar } = await servidor(app);
  try {
    await esperar(50); // índice carregado na inicialização (timer, não visitante)
    const leiturasDoIndice = planilha.leituras.filter((r) => r.endsWith("!A:C")).length;
    assert.equal(leiturasDoIndice, 1, "o índice deveria ser lido uma vez, na inicialização");

    const antes = planilha.leituras.length;
    for (let i = 0; i < 20; i++) {
      const inexistente = i.toString(16).padStart(2, "0").repeat(20);
      assert.equal((await fetch(`${base}/api/site/media/${inexistente}`)).status, 404);
    }
    assert.equal((await fetch(`${base}/api/site/media/${"cd".repeat(20)}`)).status, 404);
    assert.equal((await fetch(`${base}/api/site/media/${"cd".repeat(20)}`)).status, 404);
    assert.equal(planilha.leituras.length, antes, "id inexistente leu a planilha");
    assert.ok(!planilha.leituras.some((r) => r.endsWith("!A:D")), "alguma leitura pegou a aba inteira com o conteúdo");

    const ok = await fetch(`${base}/api/site/media/${id}`);
    assert.equal(ok.status, 200);
    assert.ok(Buffer.from(await ok.arrayBuffer()).equals(png));
    assert.equal(planilha.leituras.at(-1), "'Site Midia'!A1:D1", "a imagem deveria ler só as suas linhas");
    const depois = planilha.leituras.length;
    assert.equal((await fetch(`${base}/api/site/media/${id}`)).status, 200);
    assert.equal(planilha.leituras.length, depois, "a segunda visita deveria vir do cache");
  } finally {
    await fechar();
  }
});

await test("rota de imagens tem limite de requisições por IP", async () => {
  const store = { listMedia: async () => new Map(), readMedia: async () => null, readConfig: async () => ({ revision: 0, config: null }) };
  const app = express();
  app.set("trust proxy", 1);
  registerSiteAdmin(app, { store, password: "senha-do-teste" });
  const { base, fechar } = await servidor(app);
  try {
    await esperar(20);
    let status = [];
    for (let i = 0; i < 301; i++) status.push((await fetch(`${base}/api/site/media/${"ef".repeat(20)}`, { headers: { "X-Forwarded-For": "198.51.100.7" } })).status);
    assert.equal(status.at(-2), 404);
    assert.equal(status.at(-1), 429, "a 301ª requisição do mesmo IP deveria ser barrada");
    assert.equal((await fetch(`${base}/api/site/media/${"ef".repeat(20)}`, { headers: { "X-Forwarded-For": "198.51.100.8" } })).status, 404, "outro IP foi barrado");
  } finally {
    await fechar();
  }
});

/* ─── Limitador pelo IP real (trust proxy) ─── */

await test("com trust proxy, o limite usa o IP real: forjar o 1º valor do X-Forwarded-For não burla", async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.post("/limitada", rateLimit({ windowMs: 60_000, max: 3 }), (_req, res) => res.json({ ok: true }));
  const { base, fechar } = await servidor(app);
  try {
    const status = [];
    for (let i = 0; i < 5; i++) {
      // O atacante inventa o primeiro valor; o proxy acrescenta o IP real no fim.
      status.push((await fetch(`${base}/limitada`, { method: "POST", headers: { "X-Forwarded-For": `10.9.9.${i}, 203.0.113.50` } })).status);
    }
    assert.deepEqual(status, [200, 200, 200, 429, 429]);
    const outro = await fetch(`${base}/limitada`, { method: "POST", headers: { "X-Forwarded-For": "10.9.9.1, 203.0.113.51" } });
    assert.equal(outro.status, 200, "um IP real diferente foi bloqueado");
  } finally {
    await fechar();
  }
});

await test("sem trust proxy o X-Forwarded-For é ignorado (não serve para trocar de IP)", async () => {
  const app = express();
  app.post("/limitada", rateLimit({ windowMs: 60_000, max: 2 }), (_req, res) => res.json({ ok: true }));
  const { base, fechar } = await servidor(app);
  try {
    const status = [];
    for (let i = 0; i < 4; i++) status.push((await fetch(`${base}/limitada`, { method: "POST", headers: { "X-Forwarded-For": `198.51.100.${i}` } })).status);
    assert.deepEqual(status, [200, 200, 429, 429]);
  } finally {
    await fechar();
  }
});

await test("login: 10 erradas por IP passam, a 11ª é bloqueada com a espera em minutos; outro IP segue livre", async () => {
  const store = { listMedia: async () => new Map(), readMedia: async () => null, readConfig: async () => ({ revision: 0, config: null }) };
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  registerSiteAdmin(app, { store, password: "senha-do-teste" });
  const { base, fechar } = await servidor(app);
  const login = (ip, password = "errada") =>
    fetch(`${base}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify({ username: "admin", password }) });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await login("203.0.113.10")).status, 401, `tentativa ${i + 1}`);
    const bloqueada = await login("203.0.113.10");
    assert.equal(bloqueada.status, 429);
    assert.equal((await bloqueada.json()).error, "Muitas tentativas, aguarde 15 minutos.");
    assert.ok(Number(bloqueada.headers.get("retry-after")) > 0);
    assert.equal((await login("203.0.113.10", "senha-do-teste")).status, 429, "bloqueado não pode testar senha");
    assert.equal((await login("203.0.113.11")).status, 401, "outro IP foi bloqueado");
    assert.equal((await login("203.0.113.11", "senha-do-teste")).status, 200);
  } finally {
    await fechar();
  }
});

await test("limitador guarda no máximo 10.000 chaves e corta chaves gigantes", async () => {
  const limitador = attemptLimiter({ windowMs: 60_000, max: 1, keyFrom: (req) => req.chave });
  limitador.falhou({ chave: "primeira" });
  assert.ok(limitador.bloqueado({ chave: "primeira" }) > 0);
  for (let i = 0; i < 10_000; i++) limitador.falhou({ chave: `k${i}` });
  assert.equal(limitador.bloqueado({ chave: "primeira" }), 0, "a chave mais antiga deveria ter saído");
  const gigante = "x".repeat(50_000);
  limitador.falhou({ chave: gigante });
  assert.ok(limitador.bloqueado({ chave: gigante.slice(0, 200) + "diferente" }) > 0, "chave não foi cortada em 200 caracteres");
});

/* ─── Planilha: neutralização de fórmulas ─── */

await test("sheetSafe neutraliza = + - @ mesmo com espaço ou caractere de controle antes", () => {
  const casos = [
    ["=1+1", "1+1"],
    [" =IMAGE(\"https://x\")", "IMAGE(\"https://x\")"],
    ["\u0000=HYPERLINK(\"x\")", "HYPERLINK(\"x\")"],
    ["\t+55 51 99999-0000", "55 51 99999-0000"],
    ["\r\n@SUM(A1)", "SUM(A1)"],
    ["- = + @cmd", "cmd"],
    ["-5", "5"],
    ["Bola mansa", "Bola mansa"],
    ["Equipe  com   espaços", "Equipe com espaços"],
    ["Nome=com igual no meio", "Nome=com igual no meio"],
  ];
  for (const [entrada, esperado] of casos) assert.equal(sheetSafe(entrada), esperado, JSON.stringify(entrada));
  assert.equal(sheetSafe("a".repeat(500), 10), "a".repeat(10));
  assert.equal(sheetSafe(null), "");
});

/* ─── Válvula de escape ─── */

await test("RATE_LIMIT_DISABLED=true desliga os limitadores e avisa no log", async () => {
  const avisos = [];
  const warnOriginal = console.warn;
  console.warn = (msg) => avisos.push(String(msg));
  process.env.RATE_LIMIT_DISABLED = "true";
  const app = express();
  app.post("/limitada", rateLimit({ windowMs: 60_000, max: 1 }), (_req, res) => res.json({ ok: true }));
  const login = attemptLimiter({ windowMs: 60_000, max: 1, keyFrom: () => "ip" });
  const { base, fechar } = await servidor(app);
  try {
    const status = [];
    for (let i = 0; i < 5; i++) status.push((await fetch(`${base}/limitada`, { method: "POST" })).status);
    assert.deepEqual(status, [200, 200, 200, 200, 200]);
    login.falhou({}); login.falhou({});
    assert.equal(login.bloqueado({}), 0);
    assert.ok(avisos.some((a) => a.includes("RATE_LIMIT_DISABLED")), "nenhum aviso no log");
  } finally {
    delete process.env.RATE_LIMIT_DISABLED;
    console.warn = warnOriginal;
    await fechar();
  }
  // Sem a variável, volta a limitar.
  const app2 = express();
  app2.post("/limitada", rateLimit({ windowMs: 60_000, max: 1 }), (_req, res) => res.json({ ok: true }));
  const s2 = await servidor(app2);
  try {
    const a = (await fetch(`${s2.base}/limitada`, { method: "POST" })).status;
    const b = (await fetch(`${s2.base}/limitada`, { method: "POST" })).status;
    assert.deepEqual([a, b], [200, 429]);
  } finally {
    await s2.fechar();
  }
});

console.log(`\n${passed} teste(s) passaram, ${failures.length} falharam.\n`);
if (failures.length) {
  for (const { nome, err } of failures) console.error(`FALHOU: ${nome}\n${err.stack}\n`);
  process.exit(1);
}
process.exit(0);
