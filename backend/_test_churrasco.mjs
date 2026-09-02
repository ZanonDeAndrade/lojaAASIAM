/**
 * Teste de integração das rotas do churrasco.
 *
 * Sobe o Express de verdade com as rotas reais e troca só as duas fronteiras
 * externas: a planilha (um dublê em memória) e a rede (um `fetch` falso que
 * responde como api.mercadopago.com). O cliente do Mercado Pago é o REAL —
 * é o que permite afirmar o que sai pela rede: o corpo da order, o header
 * `X-Idempotency-Key`, o tratamento de 429 e a validação da assinatura.
 *
 * Nenhuma credencial, nenhuma chamada externa, nenhum pagamento real.
 *
 * Rodar: node backend/_test_churrasco.mjs
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = (name) => pathToFileURL(path.join(here, "_test_churrasco_fakes", name)).href;

// Só a planilha é trocada por import; o Mercado Pago é trocado no `fetch`.
registerHooks({
  resolve(specifier, context, nextResolve) {
    // "?real" escapa do dublê — usado para conferir os padrões da loja.
    if (specifier.endsWith("?real")) return nextResolve(specifier.replace("?real", ""), context);
    if (specifier.endsWith("/google-sheets.js")) {
      return { url: fake("google-sheets.js"), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const ACCESS_TOKEN = "TEST-token-de-mentira-que-nunca-pode-vazar";
const WEBHOOK_SECRET = "segredo-de-webhook-de-teste";

process.env.INFINITEPAY_HANDLE = "loja-aasiam";
process.env.APP_URL = "https://loja.exemplo.com";
process.env.API_URL = "https://api.exemplo.com";
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "planilha-de-teste";
process.env.CHURRASCO_TOKEN_SECRET = "segredo-de-teste";
process.env.MERCADO_PAGO_ACCESS_TOKEN = ACCESS_TOKEN;
process.env.MERCADO_PAGO_WEBHOOK_SECRET = WEBHOOK_SECRET;

const express = (await import("express")).default;
const { sheet, resetSheet } = await import(fake("google-sheets.js"));
const {
  mp,
  creditar,
  instalarFetchFalso,
  moverOrder,
  orderDe,
  plantarOrder,
  requisicoesPara,
  resetMercadoPago,
} = await import(fake("mercadopago-api.mjs"));

instalarFetchFalso();

const { registerChurrascoRoutes, CHURRASCO_WEBHOOK_PATH, inscricaoToken } = await import(
  "./churrasco.js"
);
const { CHURRASCO_SHEET_HEADERS } = await import("./churrasco-inscricoes.js");
const {
  CATEGORY_EXTERNAL,
  CATEGORY_OTHER,
  CATEGORY_SI,
  COURSES,
  OTHER_COURSE,
  PRICE_OTHER_CENTS,
  PRICE_SI_CENTS,
  SI_COURSE,
} = await import("./shared/churrasco.js");

const app = express();
app.use(express.json());
registerChurrascoRoutes(app);

const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// Índices das colunas conferidas nos testes (A=0).
const COL = {
  id: 1,
  nome: 2,
  telefone: 3,
  curso: 4,
  categoria: 5,
  valor: 6,
  status: 7,
  metodo: 8,
  orderMpId: 9,
  paymentMpId: 10,
  ticketUrl: 11,
  pagoEm: 12,
  observacoes: 14,
  email: 15,
  provedor: 16,
  valorPago: 17,
  statusMp: 18,
};

let passed = 0;
const failures = [];

// Cada teste fala de um IP diferente para não dividir o balde do rate limit.
let ipDoTeste = "";
let proximoIp = 0;

async function test(nome, fn) {
  resetSheet();
  resetMercadoPago();
  ipDoTeste = `203.0.113.${(proximoIp++ % 250) + 1}`;
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

/** Intl usa espaço não separável; a planilha grava espaço comum. */
const reais = (texto) => String(texto).replace(/\s/g, " ");

const criarCheckout = (body) =>
  fetch(`${base}/api/churrasco/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ipDoTeste },
    body: JSON.stringify(body),
  });

const consultarStatus = (orderId, token) =>
  fetch(`${base}/api/churrasco/pagamentos/${orderId}/status`, {
    headers: {
      "x-forwarded-for": ipDoTeste,
      ...(token ? { "X-Inscricao-Token": token } : {}),
    },
  });

/** Assina como o Mercado Pago assina: id + request-id + ts. */
function assinar(dataId, { requestId = "req-de-teste", ts = String(Date.now()), secret = WEBHOOK_SECRET } = {}) {
  const manifesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", secret).update(manifesto).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
}

const notificar = (dataId, { headers = null, tipo = "order" } = {}) =>
  fetch(`${base}${CHURRASCO_WEBHOOK_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ipDoTeste,
      ...(headers ?? assinar(dataId)),
    },
    body: JSON.stringify({ type: tipo, action: `${tipo}.updated`, data: { id: dataId } }),
  });

let sequenciaEmail = 0;
const inscricao = (extra = {}) => ({
  name: "Ana Maria Souza",
  phone: "(55) 99999-9999",
  email: `ana.souza+${++sequenciaEmail}@exemplo.com`,
  course: "Direito",
  ...extra,
});

/** Cria uma inscrição e devolve o corpo já lido. */
async function inscrever(extra = {}) {
  const res = await criarCheckout(inscricao(extra));
  const corpo = await res.json();
  assert.equal(res.status, 201, `checkout falhou: ${JSON.stringify(corpo)}`);
  return corpo;
}

console.log("\nChurrasco — cobrança Pix pela API de Orders do Mercado Pago\n");

/* ─── Preço, validação e referência ──────────────────────────────────── */

/* ─── A lista de cursos ──────────────────────────────────────────────── */

await test("a lista de cursos está na ordem exata que a tela mostra", () => {
  assert.deepEqual(COURSES, [
    "Administração",
    "Ciências Contábeis",
    "Direito",
    "Sistemas de Informação",
    "Pedagogia",
    "Ontopsicologia",
    "Hotelaria",
    "Gastronomia",
    "Outro",
  ]);
});

await test("Ciências Contábeis e Outro estão na lista, com a grafia exata", () => {
  assert.ok(COURSES.includes("Ciências Contábeis"), "Ciências Contábeis fora da lista");
  assert.ok(COURSES.includes("Outro"), "Outro fora da lista");
  // "Outro" é o último item: é a saída de quem não achou o próprio curso.
  assert.equal(COURSES.at(-1), OTHER_COURSE);
  assert.equal(new Set(COURSES).size, COURSES.length, "curso repetido na lista");
});

await test("o resumo da inscrição bate com o que o backend cobra", async () => {
  const { buildRegistrationSummary } = await import("./shared/churrasco.js");

  // É o card que aparece na tela assim que a pessoa escolhe o curso.
  assert.deepEqual(buildRegistrationSummary("Ciências Contábeis"), {
    course: "Ciências Contábeis",
    category: CATEGORY_OTHER,
    priceCents: PRICE_OTHER_CENTS,
    price: buildRegistrationSummary("Ciências Contábeis").price,
  });
  assert.equal(reais(buildRegistrationSummary("Ciências Contábeis").price), "R$ 35,00");

  const outro = buildRegistrationSummary("Outro");
  assert.equal(outro.course, "Outro");
  assert.equal(outro.category, CATEGORY_EXTERNAL);
  assert.equal(outro.priceCents, PRICE_OTHER_CENTS);
  assert.equal(reais(outro.price), "R$ 35,00");

  assert.equal(buildRegistrationSummary(SI_COURSE).priceCents, PRICE_SI_CENTS);
  assert.equal(reais(buildRegistrationSummary(SI_COURSE).price), "R$ 25,00");

  // Sem curso não há resumo — a tela não mostra preço nenhum.
  for (const invalido of ["", "Medicina", null, ["Outro"]]) {
    assert.equal(buildRegistrationSummary(invalido), null, `${JSON.stringify(invalido)} virou resumo`);
  }
});

await test("o arquivo compartilhado do frontend é idêntico ao do backend", async () => {
  const { readFile } = await import("node:fs/promises");
  const daqui = path.join(here, "shared", "churrasco.js");
  const doFront = path.join(here, "..", "frontend", "src", "shared", "churrasco.js");

  const [backend, frontend] = await Promise.all([
    readFile(daqui, "utf8"),
    readFile(doFront, "utf8"),
  ]);

  assert.equal(
    frontend,
    backend,
    "backend/shared/churrasco.js e frontend/src/shared/churrasco.js divergiram — " +
      "as duas listas precisam ser a mesma."
  );
});

/* ─── Preço, validação e referência ──────────────────────────────────── */

await test("cria a cobrança e grava a linha pendente com as 20 colunas", async () => {
  const body = await inscrever();

  assert.equal(body.ok, true);
  assert.match(body.orderId, /^CHURRASCO-\d{4}-[A-Z2-9]{8}$/);
  assert.equal(body.amountCents, PRICE_OTHER_CENTS);
  assert.equal(reais(body.amount), "R$ 35,00");
  assert.equal(body.status, "pendente");
  assert.ok(body.token, "token de consulta ausente");
  assert.ok(body.pix?.qrCode, "copia e cola ausente");

  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0].length, CHURRASCO_SHEET_HEADERS.length);
  assert.equal(sheet.rows[0][COL.id], body.orderId);
  assert.equal(sheet.rows[0][COL.status], "Pendente");
  assert.equal(reais(sheet.rows[0][COL.valor]), "R$ 35,00");
  assert.equal(sheet.rows[0][COL.categoria], "Outro curso");
  assert.equal(sheet.rows[0][COL.telefone], "55999999999");
  assert.equal(sheet.rows[0][COL.provedor], "Mercado Pago");
  assert.equal(sheet.rows[0][COL.metodo], "Pix");
  assert.ok(sheet.rows[0][COL.email].endsWith("@exemplo.com"));
  assert.ok(sheet.rows[0][COL.orderMpId].startsWith("ORD01"));
  assert.equal(sheet.rows[0][COL.statusMp], "action_required / waiting_transfer");
});

await test("Sistemas de Informação gera R$ 25,00", async () => {
  const body = await inscrever({ course: SI_COURSE });

  assert.equal(body.amountCents, PRICE_SI_CENTS);
  assert.equal(reais(body.amount), "R$ 25,00");

  const [criacao] = requisicoesPara("POST", "/v1/orders");
  assert.equal(criacao.body.total_amount, "25.00");
  assert.equal(criacao.body.transactions.payments[0].amount, "25.00");
  assert.equal(reais(sheet.rows[0][COL.valor]), "R$ 25,00");
  assert.equal(sheet.rows[0][COL.categoria], CATEGORY_SI);
});

await test("todo curso que não é SI gera R$ 35,00", async () => {
  // A lista inteira, menos SI — nenhum curso novo escapa deste teste.
  for (const curso of COURSES.filter((c) => c !== SI_COURSE)) {
    resetSheet();
    resetMercadoPago();
    const body = await inscrever({ course: curso });
    assert.equal(body.amountCents, PRICE_OTHER_CENTS, `${curso} deveria custar R$ 35,00`);
    assert.equal(reais(body.amount), "R$ 35,00", `${curso} deveria custar R$ 35,00`);
    assert.equal(requisicoesPara("POST", "/v1/orders")[0].body.total_amount, "35.00");
    assert.equal(reais(sheet.rows[0][COL.valor]), "R$ 35,00");
  }
});

await test("Administração continua em R$ 35,00 e na categoria de sempre", async () => {
  const body = await inscrever({ course: "Administração" });

  assert.equal(body.amountCents, PRICE_OTHER_CENTS);
  assert.equal(reais(body.amount), "R$ 35,00");
  assert.equal(sheet.rows[0][COL.curso], "Administração");
  assert.equal(sheet.rows[0][COL.categoria], CATEGORY_OTHER);
});

await test("Ciências Contábeis é aceita, cobra R$ 35,00 e vai acentuada para a planilha", async () => {
  const body = await inscrever({ course: "Ciências Contábeis" });

  assert.equal(body.amountCents, PRICE_OTHER_CENTS);
  assert.equal(reais(body.amount), "R$ 35,00");
  assert.equal(body.curso, "Ciências Contábeis");
  assert.equal(body.categoria, CATEGORY_OTHER);

  const [criacao] = requisicoesPara("POST", "/v1/orders");
  assert.equal(criacao.body.total_amount, "35.00");

  assert.equal(sheet.rows.length, 1);
  // Grafia exata: nenhuma normalização come o acento no registro final.
  assert.equal(sheet.rows[0][COL.curso], "Ciências Contábeis");
  assert.equal(sheet.rows[0][COL.categoria], CATEGORY_OTHER);
  assert.equal(reais(sheet.rows[0][COL.valor]), "R$ 35,00");
});

await test("Outro é aceito, cobra R$ 35,00 e entra como participante externo", async () => {
  const body = await inscrever({ course: "Outro" });

  assert.equal(body.amountCents, PRICE_OTHER_CENTS);
  assert.equal(reais(body.amount), "R$ 35,00");
  assert.equal(body.curso, "Outro");
  assert.equal(body.categoria, CATEGORY_EXTERNAL);

  assert.equal(requisicoesPara("POST", "/v1/orders")[0].body.total_amount, "35.00");

  assert.equal(sheet.rows.length, 1);
  // "Outro" é um valor, não um vazio: a planilha registra a palavra.
  assert.equal(sheet.rows[0][COL.curso], "Outro");
  assert.equal(sheet.rows[0][COL.categoria], CATEGORY_EXTERNAL);
  assert.equal(reais(sheet.rows[0][COL.valor]), "R$ 35,00");
  // Nome, telefone e e-mail seguem intactos — "Outro" só muda o curso.
  assert.equal(sheet.rows[0][COL.nome], "Ana Maria Souza");
  assert.equal(sheet.rows[0][COL.telefone], "55999999999");
  assert.ok(sheet.rows[0][COL.email].endsWith("@exemplo.com"));
});

await test("curso digitado sem acento é aceito e gravado na grafia da lista", async () => {
  const body = await inscrever({ course: "ciencias contabeis" });

  assert.equal(body.curso, "Ciências Contábeis");
  assert.equal(body.amountCents, PRICE_OTHER_CENTS);
  assert.equal(sheet.rows[0][COL.curso], "Ciências Contábeis");
});

await test("os cursos novos vão do formulário à confirmação em uma única linha", async () => {
  for (const [curso, categoria] of [
    ["Ciências Contábeis", CATEGORY_OTHER],
    ["Outro", CATEGORY_EXTERNAL],
  ]) {
    resetSheet();
    resetMercadoPago();

    const dados = inscricao({ course: curso });

    // Duplo clique: a segunda tentativa recai sobre a mesma cobrança.
    const [primeira, segunda] = await Promise.all([criarCheckout(dados), criarCheckout(dados)]);
    const body = await primeira.json();
    const repetida = await segunda.json();

    assert.equal(primeira.status, 201, JSON.stringify(body));
    assert.equal(segunda.status, 201, JSON.stringify(repetida));
    assert.equal(repetida.orderId, body.orderId, `${curso} duplicou a inscrição`);
    assert.equal(sheet.rows.length, 1, `${curso} criou duas linhas`);
    assert.equal(mp.orders.size, 1, `${curso} criou duas cobranças`);

    // O webhook confirma na MESMA linha, sem mexer no curso gravado.
    const order = orderDe(body.orderId);
    creditar(order.id);
    assert.equal((await notificar(order.id)).status, 200);

    assert.equal(sheet.rows.length, 1, `${curso} ganhou uma linha no webhook`);
    assert.equal(sheet.rows[0][COL.id], body.orderId);
    assert.equal(sheet.rows[0][COL.status], "Pago");
    assert.equal(sheet.rows[0][COL.curso], curso);
    assert.equal(sheet.rows[0][COL.categoria], categoria);
    assert.equal(reais(sheet.rows[0][COL.valorPago]), "R$ 35,00");

    // A tela de pagamento confirmado lê daqui — e o curso continua o mesmo.
    const confirmada = await (await consultarStatus(body.orderId, body.token)).json();
    assert.equal(confirmada.paid, true, `${curso} não confirmou`);
    assert.equal(confirmada.statusLabel, "Pago");
    assert.equal(confirmada.curso, curso, "a confirmação mudou o curso");
    assert.equal(confirmada.categoria, categoria);
    assert.equal(reais(confirmada.amount), "R$ 35,00");
    assert.equal(confirmada.amountCents, PRICE_OTHER_CENTS);
  }
});

await test("preço forjado pelo navegador é ignorado", async () => {
  const body = await inscrever({
    price: 1,
    amount: "0.01",
    amountCents: 1,
    valorCents: 1,
    value: 1,
    total: 1,
    total_amount: "0.01",
    status: "pago",
    paid: true,
    orderId: "CHURRASCO-2026-FORJADO",
    paymentId: "PAY-FORJADO",
  });

  assert.equal(body.amountCents, PRICE_OTHER_CENTS);
  assert.equal(body.status, "pendente");
  assert.notEqual(body.orderId, "CHURRASCO-2026-FORJADO");

  const [criacao] = requisicoesPara("POST", "/v1/orders");
  assert.equal(criacao.body.total_amount, "35.00");
  assert.equal(sheet.rows[0][COL.status], "Pendente");
});

await test("curso fora da lista é recusado e não cria linha nem cobrança", async () => {
  // "Outro" abriu a inscrição para quem é de fora — sem abrir a allowlist.
  for (const curso of ["Medicina", "Outros", "Ciências Contabilidade", "Engenharia"]) {
    resetSheet();
    resetMercadoPago();
    const res = await criarCheckout(inscricao({ course: curso }));
    assert.equal(res.status, 400, `"${curso}" deveria ser recusado`);
    assert.equal((await res.json()).field, "course");
    assert.equal(sheet.rows.length, 0);
    assert.equal(requisicoesPara("POST", "/v1/orders").length, 0);
  }
});

await test("curso vazio, ausente ou de outro tipo é recusado", async () => {
  for (const curso of ["", "   ", null, undefined, 0, [], {}, ["Outro"]]) {
    resetSheet();
    resetMercadoPago();
    const res = await criarCheckout(inscricao({ course: curso }));
    assert.equal(res.status, 400, `${JSON.stringify(curso)} deveria ser recusado`);
    assert.equal((await res.json()).field, "course");
    assert.equal(sheet.rows.length, 0);
    assert.equal(requisicoesPara("POST", "/v1/orders").length, 0);
  }
});

await test("e-mail inválido é recusado", async () => {
  for (const email of ["", "ana", "ana@", "@exemplo.com", "ana exemplo@x.com", "ana@exemplo"]) {
    const res = await criarCheckout(inscricao({ email }));
    assert.equal(res.status, 400, `"${email}" deveria ser recusado`);
    assert.equal((await res.json()).field, "email");
  }
  assert.equal(sheet.rows.length, 0);

  // E o e-mail válido chega ao Mercado Pago normalizado em minúsculas.
  const body = await inscrever({ email: "  ANA.Souza@Exemplo.COM  " });
  assert.equal(requisicoesPara("POST", "/v1/orders")[0].body.payer.email, "ana.souza@exemplo.com");
  assert.equal(sheet.rows[0][COL.email], "ana.souza@exemplo.com");
  assert.equal(body.status, "pendente");
});

await test("nome e telefone continuam validados", async () => {
  const semSobrenome = await criarCheckout(inscricao({ name: "Ana" }));
  assert.equal((await semSobrenome.json()).field, "name");

  const telefoneRuim = await criarCheckout(inscricao({ phone: "123" }));
  assert.equal((await telefoneRuim.json()).field, "phone");
  assert.equal(sheet.rows.length, 0);
});

await test("a referência externa usa o prefixo CHURRASCO- e é única", async () => {
  const primeira = await inscrever();
  const segunda = await inscrever();

  assert.ok(primeira.orderId.startsWith("CHURRASCO-"));
  assert.ok(segunda.orderId.startsWith("CHURRASCO-"));
  assert.notEqual(primeira.orderId, segunda.orderId);

  for (const criacao of requisicoesPara("POST", "/v1/orders")) {
    assert.ok(criacao.body.external_reference.startsWith("CHURRASCO-"));
  }
});

/* ─── O payload que sai para o Mercado Pago ──────────────────────────── */

await test("o payload da order é só Pix, com bank_transfer e sem cartão nem boleto", async () => {
  await inscrever();
  const [criacao] = requisicoesPara("POST", "/v1/orders");

  assert.equal(criacao.path, "/v1/orders");
  assert.equal(criacao.body.type, "online");
  assert.equal(criacao.body.processing_mode, "automatic");

  const pagamentos = criacao.body.transactions.payments;
  assert.equal(pagamentos.length, 1, "só pode existir um pagamento");
  assert.equal(pagamentos[0].payment_method.id, "pix");
  assert.equal(pagamentos[0].payment_method.type, "bank_transfer");
  assert.equal(pagamentos[0].expiration_time, "PT30M");

  // Nada de cartão, boleto ou parcelamento em lugar nenhum do payload.
  const cru = JSON.stringify(criacao.body).toLowerCase();
  for (const proibido of [
    "credit_card",
    "debit_card",
    "bolbradesco",
    "ticket",
    "installments",
    "card",
    "boleto",
    "payment_methods",
  ]) {
    assert.ok(!cru.includes(proibido), `payload não pode citar "${proibido}"`);
  }

  // E nenhum produto é cadastrado: a order não tem itens.
  assert.equal(criacao.body.items, undefined);
});

await test("a chamada envia Authorization e X-Idempotency-Key estável", async () => {
  const body = await inscrever();
  const [criacao] = requisicoesPara("POST", "/v1/orders");

  assert.equal(criacao.headers.Authorization, `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`);
  assert.equal(criacao.headers["Content-Type"], "application/json");
  assert.ok(criacao.headers["X-Idempotency-Key"], "X-Idempotency-Key ausente");
  assert.ok(criacao.headers["X-Idempotency-Key"].length >= 32);

  // Reenviar o MESMO formulário é a mesma tentativa lógica: mesma chave,
  // mesma order, nenhuma cobrança nova.
  const repetido = await criarCheckout({
    name: "Ana Maria Souza",
    phone: "(55) 99999-9999",
    email: sheet.rows[0][COL.email],
    course: "Direito",
  });
  const corpoRepetido = await repetido.json();

  assert.equal(corpoRepetido.orderId, body.orderId);
  assert.equal(sheet.rows.length, 1, "reenvio não pode criar outra linha");
  assert.equal(mp.orders.size, 1, "reenvio não pode criar outra cobrança");
});

/* ─── Resposta para o navegador ──────────────────────────────────────── */

await test("devolve QR Code, copia e cola e nada de credencial", async () => {
  const body = await inscrever();

  assert.ok(body.pix.qrCode.startsWith("00020126"), "copia e cola fora do padrão Pix");
  assert.ok(/^[A-Za-z0-9+/=]+$/.test(body.pix.qrCodeBase64), "Base64 do QR malformado");
  assert.equal(body.pix.mimeType, "image/png");
  assert.ok(body.pix.expiraEm, "validade do Pix ausente");

  const cru = JSON.stringify(body);
  assert.ok(!cru.includes(process.env.MERCADO_PAGO_ACCESS_TOKEN), "Access Token vazou");
  assert.ok(!cru.includes(process.env.MERCADO_PAGO_WEBHOOK_SECRET), "segredo do webhook vazou");
  assert.ok(!cru.includes("Bearer"), "header privado vazou");
  assert.equal(body.telefone, undefined, "telefone não pode voltar na resposta");
  assert.equal(body.email, undefined, "e-mail não pode voltar na resposta");
  assert.equal(body.transactions, undefined, "resposta integral da API vazou");

  // O Base64 inteiro não vai para a planilha — só os identificadores.
  const linha = sheet.rows[0].join("|");
  assert.ok(!linha.includes(body.pix.qrCodeBase64));
  assert.ok(!linha.includes(process.env.MERCADO_PAGO_ACCESS_TOKEN));
  assert.ok(sheet.rows[0][COL.paymentMpId].startsWith("PAY01"));
});

await test("duplo clique não cria duas cobranças nem duas linhas", async () => {
  const dados = inscricao();
  const [a, b, c] = await Promise.all([
    criarCheckout(dados),
    criarCheckout(dados),
    criarCheckout(dados),
  ]);
  const corpos = await Promise.all([a.json(), b.json(), c.json()]);

  assert.equal(new Set(corpos.map((x) => x.orderId)).size, 1, "referências diferentes");
  assert.equal(sheet.rows.length, 1, "duplo clique criou mais de uma linha");
  assert.equal(mp.orders.size, 1, "duplo clique criou mais de uma cobrança");
  assert.equal(requisicoesPara("POST", "/v1/orders").length, 1);
});

await test("recarregar a página recupera o mesmo Pix sem cobrar de novo", async () => {
  const body = await inscrever();

  const status = await (await consultarStatus(body.orderId, body.token)).json();
  assert.equal(status.status, "pendente");
  assert.equal(status.pix.qrCode, body.pix.qrCode);
  assert.equal(status.pix.qrCodeBase64, body.pix.qrCodeBase64);
  assert.equal(mp.orders.size, 1, "consultar não pode criar outra cobrança");
  assert.equal(requisicoesPara("POST", "/v1/orders").length, 1);
});

/* ─── Webhook ────────────────────────────────────────────────────────── */

await test("webhook com assinatura inválida ou ausente responde 401", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);

  const semAssinatura = await notificar(orderMp.id, { headers: {} });
  assert.equal(semAssinatura.status, 401);

  const forjada = await notificar(orderMp.id, {
    headers: { "x-signature": "ts=1,v1=" + "a".repeat(64), "x-request-id": "req-de-teste" },
  });
  assert.equal(forjada.status, 401);

  const outroSegredo = await notificar(orderMp.id, {
    headers: assinar(orderMp.id, { secret: "segredo-errado" }),
  });
  assert.equal(outroSegredo.status, 401);

  // Nada foi consultado nem gravado.
  assert.equal(requisicoesPara("GET", "/v1/orders").length, 0);
  assert.equal(sheet.rows[0][COL.status], "Pendente");
});

await test("webhook válido consulta a order na API e não confia no corpo", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);

  // O corpo mente que está pago; a order continua aguardando a transferência.
  const res = await fetch(`${base}${CHURRASCO_WEBHOOK_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ipDoTeste,
      ...assinar(orderMp.id),
    },
    body: JSON.stringify({
      type: "order",
      data: { id: orderMp.id },
      status: "processed",
      status_detail: "accredited",
      total_amount: "35.00",
    }),
  });

  assert.equal(res.status, 200);
  assert.equal(requisicoesPara("GET", "/v1/orders").length, 1, "deveria ter consultado a order");
  assert.equal(sheet.rows[0][COL.status], "Pendente", "o corpo do webhook não confirma nada");
});

await test("processed + accredited confirma como Pago na mesma linha", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);
  assert.equal(sheet.calls.append, 1);

  creditar(orderMp.id);
  const res = await notificar(orderMp.id);
  assert.equal(res.status, 200);

  assert.equal(sheet.rows.length, 1, "confirmar não pode criar outra linha");
  assert.equal(sheet.calls.append, 1);
  assert.equal(sheet.rows[0][COL.status], "Pago");
  assert.equal(sheet.rows[0][COL.metodo], "Pix");
  assert.equal(reais(sheet.rows[0][COL.valorPago]), "R$ 35,00");
  assert.equal(sheet.rows[0][COL.statusMp], "processed / accredited");
  assert.ok(sheet.rows[0][COL.pagoEm], "data do pagamento não foi gravada");
  assert.ok(sheet.rows[0][COL.ticketUrl].startsWith("https://"));

  const status = await (await consultarStatus(body.orderId, body.token)).json();
  assert.equal(status.paid, true);
  assert.equal(status.statusLabel, "Pago");
  assert.equal(status.final, true);
  assert.equal(status.pix, null, "não mostra QR depois de pago");
});

await test("action_required + waiting_transfer continua Pendente", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);

  assert.equal((await notificar(orderMp.id)).status, 200);
  assert.equal(sheet.rows[0][COL.status], "Pendente");

  const status = await (await consultarStatus(body.orderId, body.token)).json();
  assert.equal(status.paid, false);
  assert.equal(status.final, false);
});

await test("order processada com a transação Pix ainda em trânsito fica Processando", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);

  moverOrder(orderMp.id, {
    order: { status: "processed", status_detail: "accredited" },
    payment: { status: "processing", status_detail: "pending" },
  });

  await notificar(orderMp.id);
  assert.equal(sheet.rows[0][COL.status], "Processando");
  assert.equal(sheet.rows[0][COL.pagoEm], "", "não pode datar um pagamento não creditado");
});

await test("valor divergente vai para revisão manual", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);

  creditar(orderMp.id);
  moverOrder(orderMp.id, { order: { total_amount: "1.00" }, payment: { amount: "1.00" } });

  await notificar(orderMp.id);

  assert.equal(sheet.rows[0][COL.status], "Revisão manual");
  assert.match(sheet.rows[0][COL.observacoes], /diferente do valor do curso/i);
  assert.equal(sheet.rows[0][COL.pagoEm], "");

  const status = await (await consultarStatus(body.orderId, body.token)).json();
  assert.equal(status.paid, false);
  assert.equal(status.statusLabel, "Revisão manual");
});

await test("método diferente de Pix vai para revisão manual", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);

  creditar(orderMp.id);
  moverOrder(orderMp.id, { metodo: { id: "master", type: "credit_card" } });

  await notificar(orderMp.id);

  assert.equal(sheet.rows[0][COL.status], "Revisão manual");
  assert.match(sheet.rows[0][COL.observacoes], /fora do Pix/i);
  assert.equal(sheet.rows[0][COL.pagoEm], "");
});

await test("tipo diferente de bank_transfer vai para revisão manual", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);

  creditar(orderMp.id);
  moverOrder(orderMp.id, { metodo: { id: "pix", type: "wallet" } });

  await notificar(orderMp.id);
  assert.equal(sheet.rows[0][COL.status], "Revisão manual");
});

await test("webhook de uma order desconhecida é ignorado sem criar inscrição", async () => {
  const body = await inscrever();

  const estranha = plantarOrder({
    id: "ORD01ESTRANHA",
    status: "processed",
    status_detail: "accredited",
    external_reference: "CHURRASCO-2026-NAOEXISTE",
    total_amount: "35.00",
    transactions: {
      payments: [
        {
          id: "PAY01ESTRANHA",
          amount: "35.00",
          status: "processed",
          status_detail: "accredited",
          payment_method: { id: "pix", type: "bank_transfer" },
        },
      ],
    },
  });

  const res = await notificar(estranha.id);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ignorado, "desconhecida");
  assert.equal(sheet.rows.length, 1, "não pode criar linha para order desconhecida");
  assert.equal(sheet.rows[0][COL.id], body.orderId);
  assert.equal(sheet.rows[0][COL.status], "Pendente");

  // Uma notificação inexistente no Mercado Pago também não cria nada.
  const inexistente = await notificar("ORD01NAOEXISTE");
  assert.equal(inexistente.status, 200);
  assert.equal((await inexistente.json()).ignorado, "order_inexistente");
  assert.equal(sheet.rows.length, 1);
});

await test("webhook de pedido da loja é ignorado", async () => {
  const body = await inscrever();

  const daLoja = plantarOrder({
    id: "ORD01LOJA",
    status: "processed",
    status_detail: "accredited",
    external_reference: "AASIAM-20260101120000-XYZ",
    total_amount: "150.00",
    transactions: {
      payments: [
        {
          id: "PAY01LOJA",
          amount: "150.00",
          status: "processed",
          status_detail: "accredited",
          payment_method: { id: "pix", type: "bank_transfer" },
        },
      ],
    },
  });

  const res = await notificar(daLoja.id);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ignorado, "referencia");
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0][COL.id], body.orderId);
  assert.equal(sheet.rows[0][COL.status], "Pendente");
});

await test("notificação de outro tópico é ignorada", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);
  creditar(orderMp.id);

  const res = await notificar(orderMp.id, { tipo: "payment" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ignorado, "topico");
  assert.equal(sheet.rows[0][COL.status], "Pendente", "tópico alheio não pode confirmar");
});

await test("reenvio do webhook não cria linha nem gravação extra", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);
  creditar(orderMp.id);

  await notificar(orderMp.id);
  const updatesDepoisDaPrimeira = sheet.calls.update;

  await notificar(orderMp.id);
  await notificar(orderMp.id);
  const [x, y] = await Promise.all([notificar(orderMp.id), notificar(orderMp.id)]);
  assert.equal(x.status, 200);
  assert.equal(y.status, 200);

  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.calls.append, 1);
  assert.equal(
    sheet.calls.update,
    updatesDepoisDaPrimeira,
    "reenvio do webhook não pode gravar de novo"
  );
  assert.equal(sheet.rows[0][COL.status], "Pago");
});

await test("o status não regride de Pago para Pendente", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);

  creditar(orderMp.id);
  await notificar(orderMp.id);
  assert.equal(sheet.rows[0][COL.status], "Pago");
  const pagoEm = sheet.rows[0][COL.pagoEm];

  // O Mercado Pago volta atrás (notificação atrasada, fora de ordem).
  moverOrder(orderMp.id, {
    order: { status: "action_required", status_detail: "waiting_transfer" },
    payment: { status: "action_required", status_detail: "waiting_transfer" },
  });
  await notificar(orderMp.id);

  assert.equal(sheet.rows[0][COL.status], "Pago");
  assert.equal(sheet.rows[0][COL.pagoEm], pagoEm);

  const status = await (await consultarStatus(body.orderId, body.token)).json();
  assert.equal(status.paid, true);
});

/* ─── Consulta de status ─────────────────────────────────────────────── */

await test("o token de uma inscrição não consulta outra", async () => {
  const primeira = await inscrever();
  const segunda = await inscrever();

  assert.equal((await consultarStatus(primeira.orderId, "")).status, 404);
  assert.equal((await consultarStatus(primeira.orderId, "x".repeat(32))).status, 404);
  assert.equal((await consultarStatus(primeira.orderId, segunda.token)).status, 404);
  assert.equal((await consultarStatus("AASIAM-20260101-ABC123", primeira.token)).status, 404);
  assert.equal((await consultarStatus(segunda.orderId, primeira.token)).status, 404);

  assert.equal((await consultarStatus(primeira.orderId, primeira.token)).status, 200);
});

await test("a página aberta sozinha não confirma pagamento", async () => {
  const body = await inscrever();

  // Nem consultando muitas vezes, nem inventando parâmetros na URL.
  for (let i = 0; i < 3; i++) {
    const res = await fetch(
      `${base}/api/churrasco/pagamentos/${body.orderId}/status` +
        `?status=pago&paid=true&payment_id=PAY01FORJADO&order_id=ORD01FORJADA&amount=0.01`,
      { headers: { "x-forwarded-for": ipDoTeste, "X-Inscricao-Token": body.token } }
    );
    const status = await res.json();
    assert.equal(status.paid, false);
    assert.equal(status.status, "pendente");
  }
  assert.equal(sheet.rows[0][COL.status], "Pendente");

  // E o ID forjado nunca chega ao Mercado Pago: só a order da própria linha.
  const consultadas = requisicoesPara("GET", "/v1/orders").map((r) => r.path);
  assert.ok(consultadas.every((p) => !p.includes("FORJADA")));
});

await test("a consulta só confirma depois de ler a order", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);

  const antes = requisicoesPara("GET", "/v1/orders").length;
  creditar(orderMp.id);

  const status = await (await consultarStatus(body.orderId, body.token)).json();

  assert.ok(
    requisicoesPara("GET", "/v1/orders").length > antes,
    "a consulta deveria ler a order no Mercado Pago"
  );
  assert.equal(status.paid, true);
  assert.equal(sheet.rows[0][COL.status], "Pago");
});

await test("falha, cancelamento e expiração são tratados", async () => {
  const casos = [
    ["failed", "rejected", "Falhou", "falhou"],
    ["canceled", "canceled", "Cancelado", "cancelado"],
    ["expired", "expired", "Expirado", "expirado"],
    ["refunded", "refunded", "Reembolsado", "reembolsado"],
    ["charged_back", "charged_back", "Revisão manual", "revisao_manual"],
  ];

  for (const [status, detalhe, rotulo, canonico] of casos) {
    resetSheet();
    resetMercadoPago();
    const body = await inscrever();
    const orderMp = orderDe(body.orderId);

    moverOrder(orderMp.id, {
      order: { status, status_detail: detalhe },
      payment: { status, status_detail: detalhe },
    });
    await notificar(orderMp.id);

    assert.equal(sheet.rows[0][COL.status], rotulo, `${status} deveria virar ${rotulo}`);

    const consulta = await (await consultarStatus(body.orderId, body.token)).json();
    assert.equal(consulta.status, canonico);
    assert.equal(consulta.final, true, `${canonico} deveria encerrar a consulta automática`);
    assert.equal(consulta.paid, false);
    assert.equal(consulta.pix, null);
  }
});

await test("Pix expirado gera um novo Pix na MESMA linha", async () => {
  const dados = inscricao();
  const body = await (await criarCheckout(dados)).json();
  const primeira = orderDe(body.orderId);

  moverOrder(primeira.id, {
    order: { status: "expired", status_detail: "expired" },
    payment: { status: "expired", status_detail: "expired" },
  });
  await notificar(primeira.id);
  assert.equal(sheet.rows[0][COL.status], "Expirado");

  const renovado = await (await criarCheckout(dados)).json();

  assert.equal(renovado.orderId, body.orderId, "a referência da inscrição não muda");
  assert.equal(sheet.rows.length, 1, "renovar não pode criar outra linha");
  assert.equal(sheet.rows[0][COL.status], "Pendente");
  assert.equal(mp.orders.size, 2, "deveria existir uma cobrança nova");

  const criacoes = requisicoesPara("POST", "/v1/orders");
  assert.equal(criacoes.length, 2);
  assert.notEqual(
    criacoes[0].headers["X-Idempotency-Key"],
    criacoes[1].headers["X-Idempotency-Key"],
    "um Pix novo precisa de uma chave de idempotência nova"
  );
  assert.notEqual(renovado.pix.qrCode, body.pix.qrCode);
  assert.equal(sheet.rows[0][COL.orderMpId], orderDe(body.orderId).id);
});

await test("uma inscrição já paga nunca é cobrada de novo", async () => {
  const dados = inscricao();
  const body = await (await criarCheckout(dados)).json();
  creditar(orderDe(body.orderId).id);
  await notificar(orderDe(body.orderId).id);
  assert.equal(sheet.rows[0][COL.status], "Pago");

  const denovo = await (await criarCheckout(dados)).json();

  assert.equal(denovo.orderId, body.orderId);
  assert.equal(denovo.paid, true);
  assert.equal(denovo.pix, null);
  assert.equal(sheet.rows.length, 1);
  assert.equal(mp.orders.size, 1, "não pode existir uma segunda cobrança");
});

await test("a inscrição sobrevive a um restart do backend", async () => {
  const body = await inscrever();
  const orderMp = orderDe(body.orderId);

  // Um restart zera qualquer estado em memória, mas não a planilha. O token é
  // derivado da referência, então continua valendo.
  assert.equal(inscricaoToken(body.orderId), body.token);

  creditar(orderMp.id);
  const status = await (await consultarStatus(body.orderId, body.token)).json();

  assert.equal(status.paid, true);
  assert.equal(status.nome, "Ana Maria Souza");
  assert.equal(status.curso, "Direito");
  assert.equal(sheet.rows[0][COL.orderMpId], orderMp.id, "a associação com a order se manteve");
});

/* ─── Erros e limites ────────────────────────────────────────────────── */

await test("erros do Mercado Pago viram mensagem amigável e nada vaza", async () => {
  const casos = [
    [{ status: 429, retryAfter: 7 }, 429],
    [{ status: 500 }, 502],
    [{ status: 422 }, 502],
    [{ status: 401 }, 503],
    ["abort", 502],
  ];

  for (const [falha, esperado] of casos) {
    resetSheet();
    resetMercadoPago();
    mp.falha = falha;

    const res = await criarCheckout(inscricao());
    const corpo = await res.json();

    assert.equal(res.status, esperado, `falha ${JSON.stringify(falha)} → ${res.status}`);
    assert.equal(corpo.ok, false);
    assert.ok(corpo.error && corpo.error.length < 200, "mensagem técnica demais");
    assert.ok(!JSON.stringify(corpo).includes("erro simulado"), "resposta bruta do MP vazou");
    assert.ok(!JSON.stringify(corpo).includes(process.env.MERCADO_PAGO_ACCESS_TOKEN));

    if (falha.status === 429) assert.equal(res.headers.get("retry-after"), "7");
    // A linha pendente já criada fica marcada para a organização enxergar.
    if (sheet.rows.length) assert.equal(sheet.rows[0][COL.status], "Erro");
  }
});

await test("rate limit corta uma enxurrada de tentativas", async () => {
  // O limite por IP é largo de propósito (o wi-fi do campus é um IP só),
  // então a enxurrada precisa ser grande para esbarrar nele.
  let ultimo = 0;
  for (let i = 0; i < 60; i++) {
    ultimo = (await criarCheckout(inscricao())).status;
    if (ultimo === 429) break;
  }
  assert.equal(ultimo, 429, "o rate limit deveria ter recusado alguma tentativa");
});

await test("a configuração pública não expõe credencial nenhuma", async () => {
  const res = await fetch(`${base}/api/churrasco/config`, {
    headers: { "x-forwarded-for": ipDoTeste },
  });
  const corpo = await res.json();

  assert.equal(corpo.pagamento, "pix");
  assert.equal(corpo.provedor, "Mercado Pago");
  assert.equal(corpo.inscricoesDisponiveis, true);
  assert.equal(corpo.webhookConfigurado, true);
  assert.equal(corpo.ambiente, "teste");

  const cru = JSON.stringify(corpo);
  assert.ok(!cru.includes(process.env.MERCADO_PAGO_ACCESS_TOKEN));
  assert.ok(!cru.includes(process.env.MERCADO_PAGO_WEBHOOK_SECRET));
});

/* ─── Regressão da loja ──────────────────────────────────────────────── */

await test("a integração InfinitePay da loja continua intacta", async () => {
  const infinitepay = await import("./infinitepay.js?real");

  assert.equal(
    infinitepay.defaultRedirectUrl("AASIAM-20260101120000-ABC123"),
    "https://loja.exemplo.com/pagamento-concluido?pedido=AASIAM-20260101120000-ABC123&status=concluido"
  );
  assert.equal(infinitepay.defaultWebhookUrl(), "https://api.exemplo.com/api/webhooks/infinitepay");
  assert.equal(typeof infinitepay.criarLinkPagamento, "function");
  assert.equal(typeof infinitepay.verificarPagamento, "function");

  // O webhook do churrasco é outro endereço, sem colisão com o da loja.
  assert.notEqual(infinitepay.defaultWebhookUrl(), `https://api.exemplo.com${CHURRASCO_WEBHOOK_PATH}`);
  assert.ok(!CHURRASCO_WEBHOOK_PATH.includes("infinitepay"));

  // E o churrasco não importa mais nada da InfinitePay.
  const fs = await import("node:fs/promises");
  const fonte = await fs.readFile(path.join(here, "churrasco.js"), "utf8");
  assert.ok(!fonte.includes("infinitepay"), "churrasco.js não pode mais importar a InfinitePay");
});

await test("a loja está esgotada e os preços dela seguem guardados", async () => {
  const { calculateOrder, sanitizeSelection } = await import("./shared/order.js?real");
  const { PRODUCT_BY_ID } = await import("./shared/products.js?real");

  // Esgotado não entra no pedido, nem por uma requisição montada na mão.
  const pedido = calculateOrder(sanitizeSelection({ caneca: { quantity: 2 } }));
  assert.equal(pedido.lines.length, 0, "produto esgotado entrou no pedido");
  assert.equal(pedido.totalCents, 0);

  // Esgotar é esconder da venda, não apagar o preço: quando a loja reabrir,
  // basta tirar o `soldOut` e o valor volta como estava.
  assert.ok(PRODUCT_BY_ID.caneca.priceCents > 0, "o preço da caneca foi zerado");
  assert.ok(PRODUCT_BY_ID["moletom-verde"].priceCents > 0, "o preço do moletom foi zerado");
  assert.ok(PRODUCT_BY_ID.caneca.costCents > 0, "o preço de custo do cupom sumiu");
});

server.close();

console.log(`\n${passed} teste(s) passaram, ${failures.length} falharam.\n`);
if (failures.length) {
  for (const { nome, err } of failures) console.error(`FALHOU: ${nome}\n${err.stack}\n`);
  process.exitCode = 1;
}
