/**
 * Checkout da LOJA pelo Mercado Pago — teste de integração.
 *
 * Sobe o Express real com as rotas reais e troca só as duas fronteiras
 * externas: a planilha (dublê em memória, o mesmo do churrasco) e a rede (um
 * `fetch` falso que responde como api.mercadopago.com). O cliente do Mercado
 * Pago e o cálculo de taxas são os REAIS.
 *
 * Nenhuma credencial, nenhuma chamada externa, nenhum pagamento real.
 *
 * Rodar: node backend/_test_loja_pagamento.mjs
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
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

process.env.INFINITEPAY_HANDLE = "loja-aasiam";
process.env.APP_URL = "https://loja.exemplo.com";
process.env.API_URL = "https://api.exemplo.com";
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "planilha-de-teste";
process.env.CHURRASCO_TOKEN_SECRET = "segredo-de-teste";
process.env.MERCADO_PAGO_ACCESS_TOKEN = ACCESS_TOKEN;
process.env.MERCADO_PAGO_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.MERCADO_PAGO_PUBLIC_KEY = "TEST-public-key";
// Taxas: os padrões do módulo já são os do simulador; fixamos só o Pix.
process.env.LOJA_FEE_PIX_BPS = "99";

/* ─── Mercado Pago falso ─────────────────────────────────────────────── */

const mp = { orders: new Map(), porChave: new Map(), requisicoes: [], seq: 0, falha: null };
const QR_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function novaOrder(payload) {
  const n = ++mp.seq;
  const id = `ORD01LOJA${n}`;
  const pagamento = payload.transactions.payments[0];
  const metodo = pagamento.payment_method;
  const ehPix = metodo.id === "pix";

  const base = {
    id,
    type: payload.type,
    external_reference: payload.external_reference,
    total_amount: payload.total_amount,
    processing_mode: payload.processing_mode,
    metadata: payload.metadata || {},
    notification_url: payload.notification_url || "",
  };

  if (ehPix) {
    base.status = "action_required";
    base.status_detail = "waiting_transfer";
    base.transactions = {
      payments: [
        {
          id: `PAY01LOJA${n}`,
          amount: pagamento.amount,
          status: "action_required",
          status_detail: "waiting_transfer",
          payment_method: {
            id: "pix",
            type: "bank_transfer",
            qr_code: `PIX${id}`,
            qr_code_base64: QR_BASE64,
            ticket_url: `https://www.mercadopago.com.br/payments/${id}/ticket`,
            expiration_date: new Date(Date.now() + 30 * 60_000).toISOString(),
          },
        },
      ],
    };
  } else {
    // Cartão é síncrono: aprova, a menos que o teste force recusa via token.
    const recusado = mp.falha === "recusar_cartao";
    if (recusado) mp.falha = null;
    base.status = recusado ? "failed" : "processed";
    base.status_detail = recusado ? "rejected" : "accredited";
    base.transactions = {
      payments: [
        {
          id: `PAY01LOJA${n}`,
          amount: pagamento.amount,
          installments: metodo.installments,
          status: recusado ? "rejected" : "processed",
          status_detail: recusado ? "cc_rejected_other_reason" : "accredited",
          payment_method: { id: metodo.id, type: "credit_card", installments: metodo.installments },
        },
      ],
    };
  }
  return base;
}

function resposta(status, corpo, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (nome) => headers[String(nome).toLowerCase()] ?? null },
    text: async () => JSON.stringify(corpo),
  };
}

const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const alvo = new URL(String(url));
  if (alvo.hostname !== "api.mercadopago.com") return fetchOriginal(url, init);

  const registro = {
    method: init.method || "GET",
    path: alvo.pathname,
    headers: { ...(init.headers || {}) },
    body: init.body ? JSON.parse(init.body) : null,
  };
  mp.requisicoes.push(registro);

  if (mp.falha === "erro_500") {
    mp.falha = null;
    return resposta(500, { message: "erro simulado" });
  }

  if (registro.method === "POST" && alvo.pathname === "/v1/orders") {
    const chave = registro.headers["X-Idempotency-Key"];
    if (chave && mp.porChave.has(chave)) {
      return resposta(201, mp.orders.get(mp.porChave.get(chave)));
    }
    const order = novaOrder(registro.body);
    mp.orders.set(order.id, order);
    if (chave) mp.porChave.set(chave, order.id);
    return resposta(201, order);
  }

  const consulta = alvo.pathname.match(/^\/v1\/orders\/(.+)$/);
  if (registro.method === "GET" && consulta) {
    const order = mp.orders.get(decodeURIComponent(consulta[1]));
    return order ? resposta(200, order) : resposta(404, { message: "not found" });
  }
  return resposta(404, { message: "rota não simulada" });
};

const requisicoesPara = (metodo, prefixo) =>
  mp.requisicoes.filter((r) => r.method === metodo && r.path.startsWith(prefixo));

/* ─── App ────────────────────────────────────────────────────────────── */

const express = (await import("express")).default;
const { sheet, resetSheet } = await import(fake("google-sheets.js"));
const feesMod = await import("./loja-fees.js");
const { registerLojaRoutes, LOJA_WEBHOOK_PATH, orderIdDeTentativa, pedidoToken } = await import(
  "./loja-pagamento.js"
);

const app = express();
app.use(express.json());
registerLojaRoutes(app);
const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

const post = (rota, corpo, headers = {}) =>
  fetch(base + rota, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(corpo),
  });
const get = (rota, headers = {}) => fetch(base + rota, { headers });

function assinar(dataId, { requestId = "req-teste", ts = String(Date.now()), secret = WEBHOOK_SECRET } = {}) {
  const v1 = crypto
    .createHmac("sha256", secret)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
}
const notificar = (dataId, { headers = null } = {}) =>
  post(LOJA_WEBHOOK_PATH, { type: "order", action: "order.updated", data: { id: dataId } }, headers ?? assinar(dataId));

let attemptSeq = 0;
const novoAttempt = () => `attempt-${Date.now()}-${++attemptSeq}`;

const clienteValido = {
  name: "Ana Maria Souza",
  email: "ana.souza@exemplo.com",
  phone: "(51) 99999-9999",
};
// 2x moletom-verde (16000) = 32000 de subtotal líquido.
const selecaoMoletom = { "moletom-verde": { variants: { verde: { M: 2 } } } };

async function checkoutCartao(overrides = {}) {
  const attemptId = overrides.attemptId || novoAttempt();
  const body = {
    attemptId,
    customer: clienteValido,
    selection: selecaoMoletom,
    paymentMethod: "credit_card",
    cardToken: "a".repeat(32),
    paymentMethodId: "master",
    installments: 1,
    ...overrides,
  };
  const res = await post("/api/loja/checkout", body);
  return { res, body: await res.json(), attemptId };
}

/* ─── Runner ─────────────────────────────────────────────────────────── */

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

console.log("\nLoja — checkout pelo Mercado Pago\n");

/* ── Taxas / gross-up ── */

await test("gross-up de R$ 100 bate com o simulador em 1x/3x/4x/5x/6x", () => {
  const esperado = { 1: 10524, 3: 11062, 4: 11321, 5: 11579, 6: 11756 };
  for (const [parcelas, total] of Object.entries(esperado)) {
    const r = feesMod.simularCobranca({
      subtotalCents: 10000,
      paymentMethod: "credit_card",
      installments: Number(parcelas),
    });
    assert.equal(r.totalCents, total, `${parcelas}x deveria cobrar ${total}`);
    assert.equal(r.paymentFeeCents, total - 10000);
  }
});

await test("2x não é oferecido enquanto a taxa não é configurada", () => {
  assert.ok(!feesMod.tabelaDeTaxas().parcelasCartao.includes(2));
  assert.throws(
    () => feesMod.simularCobranca({ subtotalCents: 10000, paymentMethod: "credit_card", installments: 2 }),
    /parcela/i
  );
});

await test("gross-up nunca cobra menos que o líquido e cresce junto com ele", () => {
  const valores = [100, 999, 9990, 14990, 100000, 1, 250, 33333];
  let anterior = 0;
  for (const net of valores.sort((a, b) => a - b)) {
    const r = feesMod.simularCobranca({ subtotalCents: net, paymentMethod: "credit_card", installments: 3 });
    assert.ok(r.totalCents >= net, `total ${r.totalCents} < líquido ${net}`);
    assert.ok(r.totalCents > anterior, "gross-up não é monótono");
    anterior = r.totalCents;
    // O líquido recuperado (total - taxa do MP sobre o total) não some um centavo cheio.
    const liquidoRecuperado = r.totalCents - Math.round((r.totalCents * r.feeBps) / 10000);
    assert.ok(Math.abs(liquidoRecuperado - net) <= 1, `líquido recuperado ${liquidoRecuperado} longe de ${net}`);
  }
});

await test("Pix usa a taxa do Pix (99 bps), nunca a do cartão", () => {
  const r = feesMod.simularCobranca({ subtotalCents: 10000, paymentMethod: "pix" });
  assert.equal(r.feeBps, 99);
  assert.equal(r.installments, 1);
  assert.equal(r.totalCents, feesMod.grossUpCents(10000, 99));
});

/* ── Simulação (/quote) ── */

await test("/quote soma o catálogo real com quantidade > 1 e vários produtos", async () => {
  const body = await (
    await post("/api/loja/checkout/quote", {
      selection: { "moletom-verde": { variants: { verde: { M: 2 } } }, caneca: { quantity: 3 } },
      paymentMethod: "credit_card",
      installments: 3,
    })
  ).json();
  // 2×16000 + 3×4000 = 44000
  assert.equal(body.subtotalCents, 44000);
  assert.equal(body.cartao.installments, 3);
  assert.equal(body.cartao.totalCents, feesMod.grossUpCents(44000, 960));
  assert.ok(Array.isArray(body.opcoes) && body.opcoes.length >= 5);
});

await test("/quote ignora produto inexistente e recusa carrinho vazio/esgotado", async () => {
  const inexistente = await post("/api/loja/checkout/quote", {
    selection: { "produto-fantasma": { quantity: 5 } },
    paymentMethod: "credit_card",
    installments: 1,
  });
  assert.equal(inexistente.status, 400);

  const esgotado = await post("/api/loja/checkout/quote", {
    selection: { "mochila-listras": { quantity: 2 } },
    paymentMethod: "credit_card",
    installments: 1,
  });
  assert.equal(esgotado.status, 400);
});

await test("/quote aplica preço de custo com cupom válido", async () => {
  const semCupom = await (
    await post("/api/loja/checkout/quote", { selection: selecaoMoletom, paymentMethod: "pix" })
  ).json();
  const comCupom = await (
    await post("/api/loja/checkout/quote", {
      selection: selecaoMoletom,
      paymentMethod: "pix",
      cupom: "Gabriela Minuzzi",
    })
  ).json();
  assert.equal(comCupom.cupomAplicado, true);
  assert.ok(comCupom.subtotalCents < semCupom.subtotalCents, "cupom não baixou o subtotal");
});

/* ── Checkout com cartão ── */

await test("cartão aprovado: cria a linha, cobra o total certo e grava Pago", async () => {
  resetSheet();
  const { res, body, attemptId } = await checkoutCartao({ installments: 3 });
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.paid, true);
  assert.equal(body.status, "pago");
  assert.equal(body.installments, 3);
  assert.equal(body.subtotalCents, 32000);

  const totalEsperado = feesMod.grossUpCents(32000, 960);
  assert.equal(body.totalCents, totalEsperado);

  const [criacao] = requisicoesPara("POST", "/v1/orders");
  assert.equal(criacao.body.total_amount, (totalEsperado / 100).toFixed(2));
  assert.equal(criacao.body.transactions.payments[0].payment_method.installments, 3);
  assert.equal(criacao.body.transactions.payments[0].payment_method.token, "a".repeat(32));
  assert.equal(criacao.body.external_reference, orderIdDeTentativa(attemptId));
  assert.equal(criacao.body.metadata.source, "ecommerce");
  assert.match(criacao.body.notification_url, /\/api\/loja\/webhook\/mercadopago$/);
  assert.ok(criacao.headers["X-Idempotency-Key"], "X-Idempotency-Key ausente");

  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0][12], "Pago"); // coluna M — Status
});

await test("o navegador não decide preço, taxa nem total", async () => {
  resetSheet();
  const { body } = await checkoutCartao({
    installments: 1,
    subtotalCents: 1,
    subtotal: 1,
    feeBps: 0,
    paymentFeeCents: 0,
    totalCents: 1,
    total: 1,
    price: 1,
  });
  assert.equal(body.subtotalCents, 32000, "subtotal veio do navegador");
  const totalEsperado = feesMod.grossUpCents(32000, 498);
  assert.equal(body.totalCents, totalEsperado);
  const criacao = requisicoesPara("POST", "/v1/orders").at(-1);
  assert.equal(criacao.body.total_amount, (totalEsperado / 100).toFixed(2));
});

await test("apertar Pagar duas vezes (mesmo attemptId) não gera duas cobranças", async () => {
  resetSheet();
  mp.requisicoes = [];
  const attemptId = novoAttempt();
  const [a, b] = await Promise.all([
    checkoutCartao({ attemptId }),
    checkoutCartao({ attemptId }),
  ]);
  assert.equal(a.body.orderId, b.body.orderId);
  assert.equal(requisicoesPara("POST", "/v1/orders").length, 1, "criou duas orders");
  assert.equal(sheet.rows.length, 1, "criou duas linhas");
});

await test("cartão recusado: status Falhou, nada é dado como pago", async () => {
  resetSheet();
  mp.falha = "recusar_cartao";
  const { body } = await checkoutCartao();
  assert.equal(body.paid, false);
  assert.equal(body.status, "falhou");
  assert.equal(sheet.rows[0][12], "Falhou");
});

await test("retry da criação: falha 500 marca erro; nova tentativa deliberada conclui", async () => {
  resetSheet();
  mp.falha = "erro_500";
  const primeira = await checkoutCartao();
  assert.ok(primeira.res.status >= 500, `esperava 5xx, veio ${primeira.res.status}`);
  assert.equal(sheet.rows[0][12], "Erro");

  const segunda = await checkoutCartao(); // attemptId novo
  assert.equal(segunda.body.paid, true);
});

/* ── Checkout com Pix ── */

await test("Pix: devolve QR e fica pendente; webhook aprovado confirma", async () => {
  resetSheet();
  const attemptId = novoAttempt();
  const criado = await (
    await post("/api/loja/checkout", {
      attemptId,
      customer: clienteValido,
      selection: selecaoMoletom,
      paymentMethod: "pix",
    })
  ).json();
  assert.equal(criado.status, "pendente");
  assert.ok(criado.pix?.qrCode, "sem copia e cola");
  assert.equal(criado.paymentMethod, "pix");

  const orderId = orderIdDeTentativa(attemptId);
  const orderMp = [...mp.orders.values()].find((o) => o.external_reference === orderId);

  // Banco liquidou o Pix.
  Object.assign(orderMp, { status: "processed", status_detail: "accredited" });
  Object.assign(orderMp.transactions.payments[0], { status: "processed", status_detail: "accredited" });

  assert.equal((await notificar(orderMp.id)).status, 200);
  const status = await (
    await get(`/api/loja/pedidos/${orderId}/status`, { "X-Pedido-Token": pedidoToken(orderId) })
  ).json();
  assert.equal(status.paid, true);
});

/* ── Webhook ── */

await test("webhook duplicado e pagamento aprovado duas vezes não reprocessam", async () => {
  resetSheet();
  const attemptId = novoAttempt();
  await checkoutCartao({ attemptId }); // já aprovado
  const orderId = orderIdDeTentativa(attemptId);
  const orderMp = [...mp.orders.values()].find((o) => o.external_reference === orderId);
  const updatesAntes = sheet.calls.update;

  assert.equal((await notificar(orderMp.id)).status, 200);
  assert.equal((await notificar(orderMp.id)).status, 200);
  assert.equal(sheet.calls.update, updatesAntes, "webhook reenviado regravou a linha");
  const pago = await (
    await get(`/api/loja/pedidos/${orderId}/status`, { "X-Pedido-Token": pedidoToken(orderId) })
  ).json();
  assert.equal(pago.status, "pago");
});

await test("webhook do churrasco nunca toca um pedido da loja", async () => {
  resetSheet();
  await checkoutCartao();
  const linhasAntes = JSON.stringify(sheet.rows);

  mp.orders.set("ORDCHURRASCO", {
    id: "ORDCHURRASCO",
    status: "processed",
    status_detail: "accredited",
    external_reference: "CHURRASCO-2026-ABCDEFGH",
    total_amount: "35.00",
    transactions: { payments: [{ id: "P", amount: "35.00", status: "processed", status_detail: "accredited", payment_method: { id: "pix", type: "bank_transfer" } }] },
  });
  const res = await notificar("ORDCHURRASCO");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ignorado, "referencia");
  assert.equal(JSON.stringify(sheet.rows), linhasAntes, "a loja mexeu numa linha alheia");
});

await test("webhook sem assinatura válida responde 401", async () => {
  const res = await notificar("ORD01LOJA1", { headers: {} });
  assert.equal(res.status, 401);
  const forjada = await notificar("ORD01LOJA1", {
    headers: { "x-signature": "ts=1,v1=" + "a".repeat(64), "x-request-id": "x" },
  });
  assert.equal(forjada.status, 401);
});

await test("valor divergente entre a order e o pedido vira revisão manual", async () => {
  resetSheet();
  const attemptId = novoAttempt();
  await post("/api/loja/checkout", {
    attemptId,
    customer: clienteValido,
    selection: selecaoMoletom,
    paymentMethod: "pix",
  });
  const orderId = orderIdDeTentativa(attemptId);
  const orderMp = [...mp.orders.values()].find((o) => o.external_reference === orderId);

  // A order fica creditada, mas por um valor que não bate com o pedido.
  Object.assign(orderMp, { status: "processed", status_detail: "accredited", total_amount: "1.00" });
  Object.assign(orderMp.transactions.payments[0], {
    status: "processed",
    status_detail: "accredited",
    amount: "1.00",
  });

  await notificar(orderMp.id);
  const status = await (
    await get(`/api/loja/pedidos/${orderId}/status`, { "X-Pedido-Token": pedidoToken(orderId) })
  ).json();
  assert.equal(status.status, "revisao_manual");
});

/* ── Consulta de status ── */

await test("status com token errado responde 404", async () => {
  const res = await get("/api/loja/pedidos/LOJA-2026-ABCDEFGH/status", { "X-Pedido-Token": "errado" });
  assert.equal(res.status, 404);
});

await test("/api/loja/config não vaza o Access Token", async () => {
  const cfg = await (await get("/api/loja/config")).json();
  assert.equal(cfg.publicKey, "TEST-public-key");
  assert.ok(!JSON.stringify(cfg).includes(ACCESS_TOKEN));
  assert.deepEqual(cfg.parcelasCartao, [1, 3, 4, 5, 6]);
});

server.close();
console.log(`\n${passed} teste(s) passaram, ${failures.length} falharam.\n`);
if (failures.length) {
  for (const { nome, err } of failures) console.error(`FALHOU: ${nome}\n${err.stack}\n`);
  process.exit(1);
}
process.exit(0);
