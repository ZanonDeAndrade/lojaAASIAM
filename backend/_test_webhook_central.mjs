/**
 * Webhook central do Mercado Pago — `POST /api/mercadopago/webhook`.
 *
 * Sobe o `index.js` de verdade e confere que o endpoint único despacha pelo
 * prefixo do `external_reference` OFICIAL (lido de `GET /v1/orders/{id}`):
 * LOJA- → loja, CHURRASCO- → churrasco, e um nunca toca o outro.
 *
 * A planilha é um dublê em memória; a rede é um `fetch` falso que responde
 * como api.mercadopago.com. Nenhuma credencial, nenhuma chamada externa.
 *
 * Rodar: node backend/_test_webhook_central.mjs
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = (name) => pathToFileURL(path.join(here, "_test_churrasco_fakes", name)).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/google-sheets.js")) {
      return { url: fake("google-sheets.js"), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const PORT = 3606;
const WEBHOOK_SECRET = "segredo-de-webhook-central";

process.env.PORT = String(PORT);
process.env.APP_URL = "https://loja.exemplo.com";
process.env.API_URL = "https://api.exemplo.com";
process.env.INFINITEPAY_HANDLE = "loja-de-teste";
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "planilha-de-teste";
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "conta@exemplo.iam.gserviceaccount.com";
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n";
process.env.MERCADO_PAGO_ACCESS_TOKEN = "TEST-nunca-vaza";
process.env.MERCADO_PAGO_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.CHURRASCO_TOKEN_SECRET = "segredo-de-teste";

/* ─── Mercado Pago falso ─────────────────────────────────────────────── */

const mp = { orders: new Map(), seq: 0 };
const QR_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function novaOrder(payload) {
  const n = ++mp.seq;
  const id = `ORD01WH${n}`;
  return {
    id,
    type: "online",
    status: "action_required",
    status_detail: "waiting_transfer",
    external_reference: payload.external_reference,
    total_amount: payload.total_amount,
    processing_mode: payload.processing_mode,
    transactions: {
      payments: [
        {
          id: `PAY${n}`,
          amount: payload.total_amount,
          status: "action_required",
          status_detail: "waiting_transfer",
          payment_method: {
            id: "pix",
            type: "bank_transfer",
            qr_code: `PIX${id}`,
            qr_code_base64: QR_B64,
            ticket_url: `https://mp/${id}`,
            expiration_date: new Date(Date.now() + 30 * 60_000).toISOString(),
          },
        },
      ],
    },
  };
}

function acreditar(id) {
  const o = mp.orders.get(id);
  Object.assign(o, { status: "processed", status_detail: "accredited" });
  Object.assign(o.transactions.payments[0], { status: "processed", status_detail: "accredited" });
}

function resp(status, corpo, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
    text: async () => JSON.stringify(corpo),
  };
}

const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return fetchReal(url, init);
  if (u.hostname !== "api.mercadopago.com") throw new Error(`externa bloqueada: ${u.hostname}`);

  const method = init.method || "GET";
  if (method === "POST" && u.pathname === "/v1/orders") {
    const order = novaOrder(JSON.parse(init.body));
    mp.orders.set(order.id, order);
    return resp(201, order);
  }
  const m = u.pathname.match(/^\/v1\/orders\/(.+)$/);
  if (method === "GET" && m) {
    const o = mp.orders.get(decodeURIComponent(m[1]));
    return o ? resp(200, o) : resp(404, { message: "not found" });
  }
  return resp(404, { message: "?" });
};

/* ─── Boot ───────────────────────────────────────────────────────────── */

const logOriginal = console.log;
console.log = () => {};
const { sheet, resetSheet } = await import(fake("google-sheets.js"));
await import("./index.js");
await new Promise((r) => setTimeout(r, 400));
console.log = logOriginal;

const base = `http://127.0.0.1:${PORT}`;
const post = (rota, corpo, headers = {}) =>
  fetch(base + rota, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(corpo) });

function assinar(dataId, ts = String(Date.now())) {
  const v1 = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(`id:${dataId};request-id:r;ts:${ts};`)
    .digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "r" };
}
const central = (dataId, headers) =>
  post("/api/mercadopago/webhook", { type: "order", action: "order.updated", data: { id: dataId } }, headers ?? assinar(dataId));

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

console.log("\nWebhook central do Mercado Pago\n");

const idColuna = (ref) => sheet.rows.findIndex((r) => r[1] === ref);

await test("assinatura inválida → 401", async () => {
  assert.equal((await central("ORD01WH1", {})).status, 401);
  assert.equal((await central("ORD01WH1", { "x-signature": "ts=1,v1=" + "a".repeat(64), "x-request-id": "r" })).status, 401);
});

await test("referência de outro sistema → 200 ignorado, nada gravado", async () => {
  const order = novaOrder({ external_reference: "OUTRO-999", total_amount: "10.00", processing_mode: "automatic" });
  mp.orders.set(order.id, order);
  const antes = JSON.stringify(sheet.rows);
  const res = await central(order.id);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ignorado, "referencia");
  assert.equal(JSON.stringify(sheet.rows), antes);
});

let lojaRef;
let lojaOrderId;
await test("pedido da loja: central despacha para a loja e confirma", async () => {
  resetSheet();
  const criado = await (
    await post("/api/loja/checkout", {
      attemptId: `wh-loja-${Date.now()}`,
      customer: { name: "Ana Souza", email: "ana@exemplo.com", phone: "(51) 99999-9999" },
      selection: { "moletom-verde": { variants: { verde: { M: 1 } } } },
      paymentMethod: "pix",
    })
  ).json();
  lojaRef = criado.orderId;
  assert.match(lojaRef, /^LOJA-/);
  lojaOrderId = [...mp.orders.values()].find((o) => o.external_reference === lojaRef).id;

  acreditar(lojaOrderId);
  const res = await central(lojaOrderId);
  assert.equal(res.status, 200);

  const linha = sheet.rows[idColuna(lojaRef)];
  assert.equal(linha[12], "Pago", "status da linha da loja não virou Pago");
});

await test("pedido da loja no webhook do churrasco: ignorado, loja intacta", async () => {
  const linhaAntes = JSON.stringify(sheet.rows[idColuna(lojaRef)]);
  const res = await post(
    "/api/churrasco/webhook/mercadopago",
    { type: "order", data: { id: lojaOrderId } },
    assinar(lojaOrderId)
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ignorado, "referencia");
  assert.equal(JSON.stringify(sheet.rows[idColuna(lojaRef)]), linhaAntes);
});

await test("inscrição do churrasco: central despacha para o churrasco e confirma", async () => {
  const criado = await (
    await post("/api/churrasco/checkout", {
      name: "Bruno Lima",
      phone: "(51) 98888-7777",
      email: "bruno@exemplo.com",
      course: "Direito",
    })
  ).json();
  const ref = criado.orderId;
  assert.match(ref, /^CHURRASCO-/);
  const orderId = [...mp.orders.values()].find((o) => o.external_reference === ref).id;

  acreditar(orderId);
  assert.equal((await central(orderId)).status, 200);

  const linha = sheet.rows[idColuna(ref)];
  assert.equal(linha[7], "Pago", "status da inscrição não virou Pago");

  // E o webhook da loja não faz nada com essa referência.
  const antes = JSON.stringify(sheet.rows[idColuna(ref)]);
  await post("/api/loja/webhook/mercadopago", { type: "order", data: { id: orderId } }, assinar(orderId));
  assert.equal(JSON.stringify(sheet.rows[idColuna(ref)]), antes);
});

await test("webhook central duplicado é idempotente", async () => {
  acreditar(lojaOrderId);
  const updatesAntes = sheet.calls.update;
  await central(lojaOrderId);
  await central(lojaOrderId);
  assert.equal(sheet.calls.update, updatesAntes, "reprocessou a linha");
});

console.log(`\n${passed} teste(s) passaram, ${failures.length} falharam.\n`);
if (failures.length) {
  for (const { nome, err } of failures) console.error(`FALHOU: ${nome}\n${err.stack}\n`);
  process.exit(1);
}
process.exit(0);
