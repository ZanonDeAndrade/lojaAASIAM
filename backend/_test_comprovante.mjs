/**
 * Testes do comprovante em PDF e da validação pelo QR Code.
 *
 * Mesmo desenho dos outros: Express de verdade com as rotas reais, planilha em
 * memória e `fetch` falso no lugar de api.mercadopago.com. O PDF gerado é o
 * de produção — os testes abrem o arquivo e leem o conteúdo dele para provar
 * que nenhum segredo entrou.
 *
 * Rodar: node backend/_test_comprovante.mjs
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = (name) => pathToFileURL(path.join(here, "_test_churrasco_fakes", name)).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("?real")) return nextResolve(specifier.replace("?real", ""), context);
    if (specifier.endsWith("/google-sheets.js")) {
      return { url: fake("google-sheets.js"), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const ACCESS_TOKEN = "TEST-token-de-mentira-que-nunca-pode-vazar";
const WEBHOOK_SECRET = "segredo-de-webhook-de-teste";
const COMPROVANTE_SECRET = "segredo-do-comprovante-com-mais-de-32-bytes-de-verdade";

process.env.APP_URL = "https://loja.exemplo.com";
process.env.API_URL = "https://api.exemplo.com";
process.env.INFINITEPAY_HANDLE = "loja-aasiam";
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "planilha-de-teste";
process.env.CHURRASCO_TOKEN_SECRET = "segredo-de-teste";
process.env.MERCADO_PAGO_ACCESS_TOKEN = ACCESS_TOKEN;
process.env.MERCADO_PAGO_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.COMPROVANTE_SIGNING_SECRET = COMPROVANTE_SECRET;

const express = (await import("express")).default;
const { sheet, resetSheet } = await import(fake("google-sheets.js"));
const { mp, creditar, instalarFetchFalso, orderDe, resetMercadoPago } = await import(
  fake("mercadopago-api.mjs")
);

instalarFetchFalso();

const { registerChurrascoRoutes, CHURRASCO_WEBHOOK_PATH } = await import("./churrasco.js");
const { criarTokenVerificacao, lerTokenVerificacao, nomeArquivoComprovante } = await import(
  "./comprovante.js"
);

const app = express();
app.use(express.json());
registerChurrascoRoutes(app);

const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

const COL = { id: 1, nome: 2, status: 7, valorPago: 17 };

let passed = 0;
const failures = [];
let ipDoTeste = "";
let proximoIp = 0;

async function test(nome, fn) {
  resetSheet();
  resetMercadoPago();
  ipDoTeste = `198.51.100.${(proximoIp++ % 250) + 1}`;
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${nome}`);
  } catch (err) {
    failures.push({ nome, err });
    console.log(`  ✗ ${nome}\n      ${err.message}`);
  }
}

/* ─── Atalhos ────────────────────────────────────────────────────────── */

let seq = 0;
const dadosInscricao = (extra = {}) => ({
  name: "Ana Maria Souza",
  phone: "(55) 99999-9999",
  email: `ana.souza+${++seq}@exemplo.com`,
  course: "Sistemas de Informação",
  ...extra,
});

function assinarWebhook(dataId, requestId = "req-teste") {
  const ts = String(Date.now());
  const manifesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", WEBHOOK_SECRET).update(manifesto).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
}

/** Cria uma inscrição e a confirma pelo webhook — o caminho real. */
async function inscricaoPaga(extra = {}) {
  const res = await fetch(`${base}/api/churrasco/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ipDoTeste },
    body: JSON.stringify(dadosInscricao(extra)),
  });
  const body = await res.json();
  assert.equal(res.status, 201, `checkout falhou: ${JSON.stringify(body)}`);

  const order = orderDe(body.orderId);
  creditar(order.id);
  const webhook = await fetch(`${base}${CHURRASCO_WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ipDoTeste, ...assinarWebhook(order.id) },
    body: JSON.stringify({ type: "order", data: { id: order.id } }),
  });
  assert.equal(webhook.status, 200);
  assert.equal(sheet.rows[0][COL.status], "Pago", "a inscrição deveria estar paga");
  return body;
}

const baixar = (orderId, token) =>
  fetch(`${base}/api/churrasco/comprovantes/${orderId}/pdf`, {
    headers: { "x-forwarded-for": ipDoTeste, ...(token ? { "X-Inscricao-Token": token } : {}) },
  });

const validar = (token) =>
  fetch(`${base}/api/churrasco/comprovantes/validar/${encodeURIComponent(token)}`, {
    headers: { "x-forwarded-for": ipDoTeste },
  });

/** Troca o rótulo de status direto na linha, para exercitar cada situação. */
function definirStatus(rotulo) {
  sheet.rows[0][COL.status] = rotulo;
}

/**
 * Todo o texto de dentro do PDF: o corpo cru mais os streams descomprimidos.
 * É assim que os testes de vazamento olham o conteúdo de verdade.
 */
function streamsInflados(buffer) {
  const saida = [];
  const marcaInicio = Buffer.from("stream");
  const marcaFim = Buffer.from("endstream");

  let de = 0;
  for (;;) {
    const inicio = buffer.indexOf(marcaInicio, de);
    if (inicio === -1) break;
    const fim = buffer.indexOf(marcaFim, inicio);
    if (fim === -1) break;

    let corpo = buffer.subarray(inicio + marcaInicio.length, fim);
    // Pula o CR/LF que separa a palavra "stream" do conteúdo.
    let i = 0;
    while (i < corpo.length && (corpo[i] === 0x0d || corpo[i] === 0x0a)) i++;
    corpo = corpo.subarray(i);

    try {
      saida.push(zlib.inflateSync(corpo).toString("latin1"));
    } catch {
      /* stream que não é zlib */
    }
    de = fim + marcaFim.length;
  }
  return saida;
}

function textoDoPdf(buffer) {
  return [buffer.toString("latin1"), ...streamsInflados(buffer)].join("");
}

/**
 * O texto legível do PDF, achatado.
 *
 * O PDF não guarda frases inteiras: o kerning parte cada palavra em pedaços
 * dentro de um array TJ, e o pdfkit escreve cada pedaço como string
 * hexadecimal (`<41415349414d>`) e não entre parênteses. Decodificamos as duas
 * formas, juntamos tudo e tiramos os espaços — o que sobra permite procurar
 * por uma frase mesmo ela tendo sido escrita letra a letra.
 */
function textoLegivel(buffer) {
  // Só os streams de conteúdo de página. Os bytes da imagem do QR, lidos como
  // texto, produzem "<...>" por acaso e embaralhariam a leitura.
  const bruto = streamsInflados(buffer)
    .filter((s) => s.includes("BT") && s.includes("Tf"))
    .join("");
  let saida = "";

  const pedacos = bruto.match(/<[0-9A-Fa-f\s]*>|\((?:\\.|[^()\\])*\)/g) || [];
  for (const pedaco of pedacos) {
    if (pedaco.startsWith("<")) {
      const hex = pedaco.slice(1, -1).replace(/\s+/g, "");
      if (hex.length % 2 === 0) saida += Buffer.from(hex, "hex").toString("latin1");
    } else {
      saida += pedaco.slice(1, -1).replace(/\\([()\\])/g, "$1");
    }
  }
  return saida.replace(/\s+/g, "");
}

const semEspacos = (texto) => String(texto).replace(/\s+/g, "");

console.log("\nComprovante em PDF e validação pelo QR Code\n");

/* ─── Download ───────────────────────────────────────────────────────── */

await test("inscrição paga baixa o PDF com os cabeçalhos certos", async () => {
  const inscricao = await inscricaoPaga();
  const gravacoesAntes = { ...sheet.calls };
  const cobrancasAntes = mp.orders.size;

  const res = await baixar(inscricao.orderId, inscricao.token);
  assert.equal(res.status, 200);

  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(
    res.headers.get("content-disposition"),
    `attachment; filename="comprovante-churrasco-${inscricao.orderId}.pdf"`
  );
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");

  const pdf = Buffer.from(await res.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", "não começa com a assinatura de PDF");
  assert.ok(pdf.length > 5000, `PDF pequeno demais: ${pdf.length} bytes`);
  assert.ok(pdf.subarray(-1024).toString("latin1").includes("%%EOF"), "PDF sem marca de fim");

  // Baixar lê a linha, mas nunca escreve — e nunca cria cobrança.
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.calls.append, gravacoesAntes.append, "o download criou linha");
  assert.equal(sheet.calls.update, gravacoesAntes.update, "o download gravou na planilha");
  assert.equal(mp.orders.size, cobrancasAntes, "o download criou cobrança");
});

await test("o PDF traz os dados reais da inscrição, vindos da planilha", async () => {
  const inscricao = await inscricaoPaga();
  const pdf = Buffer.from(await (await baixar(inscricao.orderId, inscricao.token)).arrayBuffer());
  const texto = textoLegivel(pdf);

  for (const esperado of [
    "Ana Maria Souza",
    "Sistemas de Informa",         // acentuação é codificada; o prefixo basta
    "Aluno de SI",
    "25,00",
    inscricao.orderId,
    "PAGAMENTO CONFIRMADO",
    "COMPROVANTE DE INSCRI",
    "Churrasco da Alcateia",
    "AASIAM",
    "Pix",
    "Mercado Pago",
  ]) {
    assert.ok(texto.includes(semEspacos(esperado)), `o PDF não contém "${esperado}"`);
  }
});

await test("o PDF não carrega credencial, token nem dado de contato", async () => {
  const inscricao = await inscricaoPaga({ email: "pessoa.secreta@exemplo.com" });
  const pdf = Buffer.from(await (await baixar(inscricao.orderId, inscricao.token)).arrayBuffer());
  const cru = textoDoPdf(pdf);
  const legivel = textoLegivel(pdf);

  const proibidos = [
    ACCESS_TOKEN,
    WEBHOOK_SECRET,
    COMPROVANTE_SECRET,
    inscricao.token,              // o token da inscrição nunca entra no documento
    "pessoa.secreta@exemplo.com", // e-mail
    "55999999999",                // telefone
    "Bearer ",
    "00020126",                   // início do copia e cola do Pix
  ];
  for (const segredo of proibidos) {
    assert.ok(!cru.includes(segredo), `o PDF vazou "${segredo.slice(0, 18)}..." no conteúdo cru`);
    assert.ok(
      !legivel.includes(semEspacos(segredo)),
      `o PDF vazou "${segredo.slice(0, 18)}..." no texto impresso`
    );
  }
});

await test("o nome do arquivo é sanitizado e não usa o nome da pessoa", async () => {
  assert.equal(
    nomeArquivoComprovante("CHURRASCO-2026-A7F9K2M4"),
    "comprovante-churrasco-CHURRASCO-2026-A7F9K2M4.pdf"
  );
  // Tentativas de escapar do nome do arquivo não sobrevivem.
  assert.equal(
    nomeArquivoComprovante('../../etc/passwd"; rm -rf /'),
    "comprovante-churrasco-etcpasswdrm-rf.pdf"
  );
  assert.equal(nomeArquivoComprovante("Ana Maria Souza"), "comprovante-churrasco-AnaMariaSouza.pdf");
  assert.equal(nomeArquivoComprovante(""), "comprovante-churrasco-inscricao.pdf");
  for (const nome of [nomeArquivoComprovante("a\r\nb"), nomeArquivoComprovante("x/y\\z")]) {
    assert.ok(!/[\r\n"\\/]/.test(nome), `nome de arquivo inseguro: ${nome}`);
  }
});

/* ─── Quem não pode baixar ───────────────────────────────────────────── */

await test("inscrição pendente não gera comprovante", async () => {
  const res = await fetch(`${base}/api/churrasco/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ipDoTeste },
    body: JSON.stringify(dadosInscricao()),
  });
  const inscricao = await res.json();
  assert.equal(sheet.rows[0][COL.status], "Pendente");

  const pdf = await baixar(inscricao.orderId, inscricao.token);
  assert.equal(pdf.status, 409);
  const corpo = await pdf.json();
  assert.equal(corpo.ok, false);
  assert.match(corpo.error, /ainda não foi confirmado/i);
});

await test("situações encerradas e em conferência não geram comprovante", async () => {
  const casos = [
    ["Expirado", 410],
    ["Cancelado", 410],
    ["Reembolsado", 410],
    ["Falhou", 410],
    ["Recusado", 410],
    ["Erro", 410],
    ["Processando", 409],
    ["Revisão manual", 409],
  ];

  for (const [rotulo, esperado] of casos) {
    resetSheet();
    resetMercadoPago();
    const inscricao = await inscricaoPaga();
    definirStatus(rotulo);

    const res = await baixar(inscricao.orderId, inscricao.token);
    assert.equal(res.status, esperado, `"${rotulo}" deveria responder ${esperado}, veio ${res.status}`);

    const corpo = await res.json();
    assert.equal(corpo.ok, false);
    assert.ok(corpo.error && !corpo.error.includes(ACCESS_TOKEN));
  }
});

await test("valor divergente na linha não vira comprovante", async () => {
  const inscricao = await inscricaoPaga();
  sheet.rows[0][COL.valorPago] = "R$ 1,00"; // adulterado direto na planilha

  const res = await baixar(inscricao.orderId, inscricao.token);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /confer/i);
});

/* ─── Token do download ──────────────────────────────────────────────── */

await test("token ausente ou malformado responde 401", async () => {
  const inscricao = await inscricaoPaga();

  assert.equal((await baixar(inscricao.orderId, null)).status, 401);
  assert.equal((await baixar(inscricao.orderId, "curto")).status, 401);
  assert.equal((await baixar(inscricao.orderId, "!".repeat(32))).status, 401);
  assert.equal((await baixar(inscricao.orderId, "a".repeat(64))).status, 401);
});

await test("token de outra inscrição responde 403", async () => {
  const primeira = await inscricaoPaga();
  const segunda = await inscricaoPaga({ course: "Direito" });

  const res = await baixar(primeira.orderId, segunda.token);
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /outra inscrição/i);

  // E cada uma continua abrindo a sua.
  assert.equal((await baixar(primeira.orderId, primeira.token)).status, 200);
  assert.equal((await baixar(segunda.orderId, segunda.token)).status, 200);
});

await test("inscrição inexistente e referência fora do churrasco respondem 404", async () => {
  const inscricao = await inscricaoPaga();

  // Referência do churrasco que não está na planilha: 404 depois do token.
  const outra = "CHURRASCO-2026-NAOEXIST";
  const { inscricaoToken } = await import("./churrasco.js");
  assert.equal((await baixar(outra, inscricaoToken(outra))).status, 404);

  // Pedido da loja: recusado antes de qualquer consulta.
  assert.equal((await baixar("AASIAM-20260101120000-ABC", inscricao.token)).status, 404);
  assert.equal((await baixar("qualquer-coisa", inscricao.token)).status, 404);
});

await test("o rate limit do download corta uma enxurrada", async () => {
  const inscricao = await inscricaoPaga();
  let ultimo = 0;
  for (let i = 0; i < 40; i++) {
    ultimo = (await baixar(inscricao.orderId, inscricao.token)).status;
    if (ultimo === 429) break;
  }
  assert.equal(ultimo, 429, "o rate limit deveria ter recusado algum download");
});

/* ─── QR Code e validação ────────────────────────────────────────────── */

await test("o token do QR Code é assinado e não carrega dado pessoal", async () => {
  const referencia = "CHURRASCO-2026-A7F9K2M4";
  const token = criarTokenVerificacao(referencia);

  assert.equal(lerTokenVerificacao(token), referencia, "o token não devolveu a referência");
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{32}$/);

  // Só a referência sorteada viaja no QR — nada da pessoa.
  const decodificado = Buffer.from(token.split(".")[0], "base64url").toString("utf8");
  assert.equal(decodificado, referencia);
  assert.ok(!token.includes(COMPROVANTE_SECRET));

  // Assinatura de outra referência não abre esta.
  const outro = criarTokenVerificacao("CHURRASCO-2026-OUTRAREF");
  assert.notEqual(outro.split(".")[1], token.split(".")[1]);
});

await test("token adulterado é recusado", async () => {
  const referencia = "CHURRASCO-2026-A7F9K2M4";
  const token = criarTokenVerificacao(referencia);
  const [corpo, assinatura] = token.split(".");

  const adulterados = [
    `${Buffer.from("CHURRASCO-2026-INVENTADO").toString("base64url")}.${assinatura}`, // troca a referência
    `${corpo}.${"a".repeat(32)}`,                                                     // troca a assinatura
    `${corpo}.${assinatura.slice(0, 31)}b`,                                           // 1 caractere
    corpo,                                                                            // sem assinatura
    `${corpo}.${assinatura}.extra`,                                                   // parte a mais
    "",
    "....",
  ];
  for (const ruim of adulterados) {
    assert.equal(lerTokenVerificacao(ruim), null, `aceitou token adulterado: ${ruim.slice(0, 24)}`);
  }

  // E a rota pública responde "inválido" sem consultar nada.
  const res = await validar(`${corpo}.${"a".repeat(32)}`);
  assert.equal(res.status, 200);
  const dados = await res.json();
  assert.equal(dados.valido, false);
  assert.equal(dados.nome, undefined, "não pode devolver dados de ninguém");
});

await test("a validação mostra o comprovante válido, sem tocar na inscrição", async () => {
  const inscricao = await inscricaoPaga();
  const gravacoesAntes = { ...sheet.calls };

  const res = await validar(criarTokenVerificacao(inscricao.orderId));
  assert.equal(res.status, 200);
  const dados = await res.json();

  assert.equal(dados.valido, true);
  assert.equal(dados.status, "pago");
  assert.equal(dados.statusLabel, "Pago");
  assert.equal(dados.nome, "Ana Maria Souza");
  assert.equal(dados.curso, "Sistemas de Informação");
  assert.equal(dados.categoria, "Aluno de SI");
  assert.equal(dados.orderId, inscricao.orderId);
  assert.match(dados.amount, /25,00/);
  assert.ok(dados.pagoEm, "sem data de confirmação");

  // Nada de contato, nada de credencial, nada da outra inscrição.
  const cru = JSON.stringify(dados);
  for (const proibido of ["@exemplo.com", "55999999999", ACCESS_TOKEN, inscricao.token, "qrCode"]) {
    assert.ok(!cru.includes(proibido), `a validação vazou "${proibido}"`);
  }

  // Validar é só leitura.
  assert.equal(sheet.calls.append, gravacoesAntes.append, "a validação criou linha");
  assert.equal(sheet.calls.update, gravacoesAntes.update, "a validação gravou na planilha");
  assert.equal(sheet.rows[0][COL.status], "Pago");
});

await test("quem perdeu o status Pago não aparece como válido", async () => {
  const casos = ["Expirado", "Cancelado", "Reembolsado", "Revisão manual", "Pendente", "Falhou"];

  for (const rotulo of casos) {
    resetSheet();
    resetMercadoPago();
    const inscricao = await inscricaoPaga();
    definirStatus(rotulo);

    const dados = await (await validar(criarTokenVerificacao(inscricao.orderId))).json();
    assert.equal(dados.valido, false, `"${rotulo}" não pode ser válido`);
    assert.equal(dados.statusLabel, rotulo, "a situação real precisa aparecer");
    assert.equal(dados.orderId, inscricao.orderId);
    assert.equal(dados.provedor, null, "não anuncia pagamento para quem não pagou");
  }
});

await test("token válido de inscrição que não está na planilha não valida", async () => {
  await inscricaoPaga();
  const dados = await (await validar(criarTokenVerificacao("CHURRASCO-2026-SUMIU12"))).json();
  assert.equal(dados.valido, false);
  assert.equal(dados.orderId, undefined);
});

await test("a validação tem rate limit", async () => {
  const inscricao = await inscricaoPaga();
  const token = criarTokenVerificacao(inscricao.orderId);
  let ultimo = 0;
  for (let i = 0; i < 700; i++) {
    ultimo = (await validar(token)).status;
    if (ultimo === 429) break;
  }
  assert.equal(ultimo, 429, "o rate limit da validação deveria ter cortado");
});

/* ─── Regressão ──────────────────────────────────────────────────────── */

await test("o comprovante não mexeu na loja nem no fluxo do Pix", async () => {
  const infinitepay = await import("./infinitepay.js?real");
  assert.equal(
    infinitepay.defaultRedirectUrl("AASIAM-20260101120000-ABC123"),
    "https://loja.exemplo.com/pagamento-concluido?pedido=AASIAM-20260101120000-ABC123&status=concluido"
  );
  assert.equal(infinitepay.defaultWebhookUrl(), "https://api.exemplo.com/api/webhooks/infinitepay");

  const fs = await import("node:fs/promises");
  const comprovante = await fs.readFile(path.join(here, "comprovante.js"), "utf8");
  assert.ok(!comprovante.includes("infinitepay"), "o comprovante não pode tocar na InfinitePay");
  assert.ok(!/https?:\/\/(?!localhost)/.test(comprovante.replace(/APP_URL/g, "")),
    "o comprovante não pode buscar nada na rede");

  // O churrasco continua cobrando só por Pix.
  const inscricao = await inscricaoPaga();
  const criacao = mp.requisicoes.find((r) => r.method === "POST" && r.path === "/v1/orders");
  assert.equal(criacao.body.transactions.payments[0].payment_method.id, "pix");
  assert.equal(criacao.body.transactions.payments[0].payment_method.type, "bank_transfer");
  assert.equal((await baixar(inscricao.orderId, inscricao.token)).status, 200);
});

server.close();

console.log(`\n${passed} teste(s) passaram, ${failures.length} falharam.\n`);
if (failures.length) {
  for (const { nome, err } of failures) console.error(`FALHOU: ${nome}\n${err.stack}\n`);
  process.exitCode = 1;
}
