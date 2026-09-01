/**
 * Servidor local de ENSAIO — só para testar a página /churrasco no navegador.
 *
 * Sobe as rotas reais do churrasco com as mesmas duas fronteiras trocadas que
 * os testes automatizados usam: a planilha vira memória e `api.mercadopago.com`
 * vira um dublê. Nenhuma credencial é lida, nenhuma chamada sai da máquina e
 * nenhum pagamento real acontece.
 *
 * Este arquivo NUNCA é carregado por `index.js` — ele existe só para o ensaio.
 *
 *   node backend/_test_servidor_falso.mjs        (porta 3333)
 *
 * Depois, em outro terminal, `cd frontend && npm run dev` e abra
 * http://localhost:5173/churrasco.
 *
 * Para mover um pagamento sem banco nenhum:
 *   GET /__ensaio/estado                    o que existe agora
 *   GET /__ensaio/pagar/:referencia         credita o Pix (como o webhook veria)
 *   GET /__ensaio/expirar/:referencia       vence o Pix
 *   GET /__ensaio/falhar/:referencia        recusa o pagamento
 *   GET /__ensaio/divergir/:referencia      paga com valor errado
 *   GET /__ensaio/cartao/:referencia        paga fora do Pix
 * Cada uma dispara o webhook assinado, exatamente como o Mercado Pago faria.
 */
import crypto from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

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

const PORT = Number(process.env.PORT || 3333);
const WEBHOOK_SECRET = "segredo-de-ensaio";

process.env.MERCADO_PAGO_ACCESS_TOKEN = "TEST-token-de-ensaio";
process.env.MERCADO_PAGO_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "planilha-de-ensaio";
process.env.CHURRASCO_TOKEN_SECRET = "segredo-de-ensaio";
process.env.APP_URL = "http://localhost:5173";
process.env.API_URL = `http://localhost:${PORT}`;

const express = (await import("express")).default;
const { sheet } = await import(fake("google-sheets.js"));
const { creditar, instalarFetchFalso, moverOrder, mp, orderDe } = await import(
  fake("mercadopago-api.mjs")
);

instalarFetchFalso();

const { registerChurrascoRoutes, CHURRASCO_WEBHOOK_PATH } = await import("./churrasco.js");

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Inscricao-Token");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));
registerChurrascoRoutes(app);

/* ─── Gatilhos do ensaio ─────────────────────────────────────────────── */

const REFERENCIA_RE = /^CHURRASCO-\d{4}-[A-Z2-9]{8}$/;

/** Dispara o webhook assinado, como o Mercado Pago faria. */
async function notificar(orderId) {
  const ts = String(Date.now());
  const manifesto = `id:${orderId};request-id:ensaio;ts:${ts};`;
  const v1 = crypto.createHmac("sha256", WEBHOOK_SECRET).update(manifesto).digest("hex");

  const resposta = await fetch(`http://127.0.0.1:${PORT}${CHURRASCO_WEBHOOK_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": "ensaio",
    },
    body: JSON.stringify({ type: "order", action: "order.updated", data: { id: orderId } }),
  });
  return resposta.status;
}

function localizar(req, res) {
  const referencia = String(req.params.referencia || "");
  if (!REFERENCIA_RE.test(referencia)) {
    res.status(400).json({ ok: false, error: "referência fora do formato" });
    return null;
  }
  const order = orderDe(referencia);
  if (!order) {
    res.status(404).json({ ok: false, error: "nenhuma cobrança para esta referência" });
    return null;
  }
  return order;
}

function gatilho(nome, aplicar) {
  app.get(`/__ensaio/${nome}/:referencia`, async (req, res) => {
    const order = localizar(req, res);
    if (!order) return undefined;

    aplicar(order.id);
    const webhook = await notificar(order.id);
    return res.json({ ok: true, gatilho: nome, orderId: order.id, webhook });
  });
}

gatilho("pagar", (id) => creditar(id));
gatilho("expirar", (id) =>
  moverOrder(id, {
    order: { status: "expired", status_detail: "expired" },
    payment: { status: "expired", status_detail: "expired" },
  })
);
gatilho("falhar", (id) =>
  moverOrder(id, {
    order: { status: "failed", status_detail: "rejected" },
    payment: { status: "failed", status_detail: "rejected" },
  })
);
gatilho("cancelar", (id) =>
  moverOrder(id, {
    order: { status: "canceled", status_detail: "canceled" },
    payment: { status: "canceled", status_detail: "canceled" },
  })
);
gatilho("divergir", (id) => {
  creditar(id);
  moverOrder(id, { order: { total_amount: "1.00" }, payment: { amount: "1.00" } });
});
gatilho("cartao", (id) => {
  creditar(id);
  moverOrder(id, { metodo: { id: "master", type: "credit_card" } });
});

app.get("/__ensaio/estado", (_req, res) => {
  res.json({
    linhas: sheet.rows.map((linha) => ({
      referencia: linha[1],
      nome: linha[2],
      curso: linha[4],
      valor: linha[6],
      status: linha[7],
      metodo: linha[8],
      orderMp: linha[9],
      pagamentoMp: linha[10],
      email: linha[15],
      valorPago: linha[17],
      statusMp: linha[18],
    })),
    gravacoes: sheet.calls,
    cobrancas: mp.orders.size,
  });
});

app.listen(PORT, () => {
  console.log(`\n=== ENSAIO do churrasco na porta ${PORT} ===`);
  console.log("Planilha: memória. Mercado Pago: dublê. Nenhum pagamento real.");
  console.log(`Frontend: cd frontend && npm run dev  →  http://localhost:5173/churrasco`);
  console.log(`Gatilhos: /__ensaio/{pagar,expirar,falhar,cancelar,divergir,cartao}/:referencia`);
  console.log("=".repeat(45) + "\n");
});
