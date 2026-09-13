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
process.env.CUPONS_CACHE_MS = "0"; // cupons: sempre relê a aba falsa

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
    // Contrato oficial da API de Orders: só estas propriedades raiz existem.
    // Qualquer outra (notification_url, metadata, ...) devolve 400.
    const RAIZ_OK = new Set([
      "type", "total_amount", "external_reference", "processing_mode",
      "transactions", "payer", "description", "config", "items",
      "marketplace", "integration_data",
    ]);
    const naoSuportadas = Object.keys(registro.body || {}).filter((k) => !RAIZ_OK.has(k));
    if (naoSuportadas.length) {
      return resposta(400, {
        error: "bad_request",
        message: `The following properties are not supported: ${naoSuportadas.join(", ")}`,
        status: 400,
        cause: [
          {
            code: "unsupported_properties",
            description: `unsupported properties: ${naoSuportadas.join(", ")}`,
          },
        ],
      }, { "x-request-id": "req-mock-400" });
    }

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
const cuponsStore = await import("./cupons-store.js");
const { resetCuponsStoreForTests } = cuponsStore;
const { __resetRateLimits } = await import("./rate-limit.js");

/** Zera a planilha falsa, o store de cupons e os contadores de rate limit. */
function resetTudo() {
  resetSheet();
  resetCuponsStoreForTests();
  __resetRateLimits();
}

/** Linha VIVA da aba "Cupons" pelo código (para ler contador e editar `Ativo`). */
function cupomRow(codigo) {
  const alvo = String(codigo).trim().toLowerCase();
  return (sheet.byTab[cuponsStore.CUPONS_SHEET_NAME] || []).find(
    (r) => String(r[0] || "").trim().toLowerCase() === alvo
  );
}
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
const selecaoNovosUniformes = {
  "conjunto-chumbo": {
    configurations: {
      a: { quantity: 1, shirtSize: "M", shortsSize: "G" },
      b: { quantity: 1, shirtSize: "M", shortsSize: "M" },
    },
  },
  "conjunto-verde": { configurations: { a: { quantity: 1, shirtSize: "G", shortsSize: "M" } } },
  jersey: { configurations: { a: { quantity: 1, color: "branca", size: "G" } } },
};
const selecaoComboWolf = {
  "combo-wolf": {
    configurations: {
      "verde-m": {
        quantity: 1,
        hoodieColor: "verde", hoodieSize: "M",
        shirtColor: "chumbo", shirtSize: "G",
        jerseyColor: "preta", jerseySize: "GG",
      },
    },
  },
};

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
  resetTudo();
  const semCupom = await (
    await post("/api/loja/checkout/quote", { selection: selecaoMoletom, paymentMethod: "pix" })
  ).json();
  const comCupom = await (
    await post("/api/loja/checkout/quote", {
      selection: selecaoMoletom,
      paymentMethod: "pix",
      cupom: "Zanon",
    })
  ).json();
  assert.equal(comCupom.cupomAplicado, true);
  assert.equal(comCupom.cupom, "Zanon");
  assert.equal(comCupom.subtotalOriginalCents, semCupom.subtotalCents);
  assert.equal(comCupom.descontoCents, semCupom.subtotalCents - comCupom.subtotalCents);
  assert.ok(comCupom.subtotalCents < semCupom.subtotalCents, "cupom não baixou o subtotal");
});

/* ── Cupom programador5 (5% sobre o subtotal) ── */

await test("cupons.js: aplicarDescontoPercentual arredonda para o centavo mais próximo", async () => {
  const { aplicarDescontoPercentual } = await import("./cupons.js");

  // R$ 3,33 × 5% = R$ 0,1665 → arredonda para R$ 0,17 (17 centavos).
  const pedido = { totalCents: 333, totalAmount: 3.33 };
  aplicarDescontoPercentual(pedido, 5);
  assert.equal(pedido.totalCents, 316);
  assert.equal(pedido.totalAmount, 3.16);

  // Nunca fica negativo.
  const zerado = { totalCents: 0, totalAmount: 0 };
  aplicarDescontoPercentual(zerado, 5);
  assert.equal(zerado.totalCents, 0);
});

await test("/quote: programador5 desconta exatamente 5% do subtotal, nunca do acréscimo do pagamento", async () => {
  resetTudo();
  const semCupom = await (
    await post("/api/loja/checkout/quote", { selection: selecaoMoletom, paymentMethod: "pix" })
  ).json();
  // 2x moletom-verde = R$ 320,00 → 5% = R$ 16,00.
  assert.equal(semCupom.subtotalCents, 32000);

  for (const variacao of ["programador5", "PROGRAMADOR5", "  Programador5  "]) {
    const comCupom = await (
      await post("/api/loja/checkout/quote", {
        selection: selecaoMoletom,
        paymentMethod: "pix",
        cupom: variacao,
      })
    ).json();
    assert.equal(comCupom.cupomAplicado, true);
    assert.equal(comCupom.cupom, "programador5");
    assert.equal(comCupom.subtotalOriginalCents, 32000);
    assert.equal(comCupom.descontoCents, 1600, "5% de R$ 320,00 deveria ser R$ 16,00");
    assert.equal(comCupom.subtotalCents, 30400);
    // O acréscimo do pagamento (Pix) incide sobre o subtotal JÁ com desconto.
    assert.equal(comCupom.pix.totalCents, feesMod.grossUpCents(30400, 99));
  }
});

await test("/quote: programador5 recalcula sozinho quando quantidade/produtos mudam", async () => {
  resetTudo();
  const umMoletom = await (
    await post("/api/loja/checkout/quote", {
      selection: { "moletom-verde": { variants: { verde: { M: 1 } } } },
      paymentMethod: "pix",
      cupom: "programador5",
    })
  ).json();
  assert.equal(umMoletom.subtotalOriginalCents, 16000);
  assert.equal(umMoletom.descontoCents, 800);

  const doisProdutos = await (
    await post("/api/loja/checkout/quote", {
      selection: { "moletom-verde": { variants: { verde: { M: 2 } } }, caneca: { quantity: 3 } },
      paymentMethod: "pix",
      cupom: "programador5",
    })
  ).json();
  // (2×16000 + 3×4000) = 44000 → 5% = 2200.
  assert.equal(doisProdutos.subtotalOriginalCents, 44000);
  assert.equal(doisProdutos.descontoCents, 2200);
  assert.equal(doisProdutos.subtotalCents, 41800);
});

await test("/quote: carrinho vazio ou só com quantidade inválida recusa antes de aplicar o cupom", async () => {
  resetTudo();
  const vazio = await post("/api/loja/checkout/quote", {
    selection: {},
    paymentMethod: "pix",
    cupom: "programador5",
  });
  assert.equal(vazio.status, 400);

  const quantidadeInvalida = await post("/api/loja/checkout/quote", {
    selection: { "moletom-verde": { variants: { verde: { M: -5 } } } },
    paymentMethod: "pix",
    cupom: "programador5",
  });
  assert.equal(quantidadeInvalida.status, 400);
});

await test("programador5: cliente não altera percentual/desconto/total manipulando o corpo da requisição", async () => {
  resetTudo();
  const body = await (
    await post("/api/loja/checkout/quote", {
      selection: selecaoMoletom,
      paymentMethod: "pix",
      cupom: "programador5",
      // Campos forjados — nenhum é lido pelo backend.
      percentual: 90,
      descontoCents: 1,
      subtotalCents: 1,
      totalCents: 1,
    })
  ).json();
  assert.equal(body.subtotalOriginalCents, 32000);
  assert.equal(body.descontoCents, 1600);
  assert.equal(body.subtotalCents, 30400);
});

await test("checkout com programador5: pedido guarda cupom, subtotal original e desconto; MP cobra o valor já descontado", async () => {
  resetTudo();
  const { res, body } = await checkoutCartao({ cupom: "  PROGRAMADOR5 ", paymentMethod: "pix" });
  assert.equal(res.status, 201);
  assert.equal(body.cupom, "programador5");
  assert.equal(body.subtotalOriginalCents, 32000);
  assert.equal(body.descontoCents, 1600);
  assert.equal(body.subtotalCents, 30400);

  // A order criada no Mercado Pago cobrou o gross-up do subtotal JÁ com desconto.
  const chamada = requisicoesPara("POST", "/v1/orders").at(-1);
  assert.equal(chamada.body.transactions.payments[0].amount, (body.totalCents / 100).toFixed(2));

  assert.equal(sheet.rows[0][23], "programador5"); // X — Cupom
  assert.match(sheet.rows[0][24], /R\$ 320,00/); // Y — Subtotal sem cupom
  assert.match(sheet.rows[0][25], /R\$ 16,00/); // Z — Desconto do cupom
});

await test("programador5 não é cumulativo: um único campo `cupom`, dois códigos juntos são recusados", async () => {
  resetTudo();
  // A API só lê um campo `cupom` (string única) por requisição — não existe
  // como somar dois cupons na mesma compra. Tentar embutir dois códigos no
  // mesmo campo não bate com nenhum cupom cadastrado: é recusado como
  // inválido, nunca soma os dois descontos.
  const combinado = await post("/api/loja/checkout/quote", {
    selection: selecaoMoletom,
    paymentMethod: "pix",
    cupom: "programador5,Zanon",
  });
  assert.equal(combinado.status, 400);

  const soProgramador5 = await (
    await post("/api/loja/checkout/quote", {
      selection: selecaoMoletom,
      paymentMethod: "pix",
      cupom: "programador5",
    })
  ).json();
  assert.equal(soProgramador5.descontoCents, 1600, "só o desconto de 5% — nada somado");
});

await test("cupom de teste GabiMinuzzi100 deixa cada item por R$ 1,00, no quote e no pedido", async () => {
  resetTudo();

  const { checkCoupon } = await import("./cupons.js");
  assert.deepEqual(await checkCoupon("GabiMinuzzi100"), {
    valido: true,
    tipo: "teste",
    codigo: "GabiMinuzzi100",
  });
  assert.deepEqual(await checkCoupon("  gabiminuzzi100 "), {
    valido: true,
    tipo: "teste",
    codigo: "GabiMinuzzi100",
  });
  assert.equal((await checkCoupon("Zanon")).tipo, "custo", "cupom pessoal mudou de tipo");

  // 2x moletom (R$ 320) + 1x Jersey (R$ 150) = 3 unidades → R$ 3,00.
  const selection = {
    "moletom-verde": { variants: { verde: { M: 2 } } },
    jersey: { configurations: { a: { quantity: 1, color: "preta", size: "M", personalizationName: "ARTHUR" } } },
  };
  const quote = await (
    await post("/api/loja/checkout/quote", { selection, paymentMethod: "pix", cupom: "GabiMinuzzi100" })
  ).json();
  assert.equal(quote.subtotalCents, 300, "cupom de teste não zerou para R$ 1,00/unidade");
  assert.equal(quote.cupomAplicado, true);

  const criado = await (
    await post("/api/loja/checkout", {
      attemptId: novoAttempt(),
      customer: clienteValido,
      selection,
      cupom: "GabiMinuzzi100",
      paymentMethod: "pix",
    })
  ).json();
  assert.equal(criado.subtotalCents, 300);
  assert.match(sheet.rows[0][6], /R\$ 3,00/); // coluna G — subtotal
  assert.match(sheet.rows[0][5], /Jersey AASIAM \(Preta · Tam\. M · Nome: ARTHUR\).*R\$ 1,00 un\./);
});

await test("Combo Wolf mantém configurações, preço base e snapshot completo na planilha", async () => {
  resetSheet();
  const quote = await (
    await post("/api/loja/checkout/quote", {
      selection: selecaoComboWolf,
      paymentMethod: "pix",
      price: 1,
      subtotal: 1,
      total: 1,
    })
  ).json();
  assert.equal(quote.subtotalCents, 41500, "o backend aceitou preço enviado pelo navegador");

  resetCuponsStoreForTests();
  const cupom = await (
    await post("/api/loja/checkout/quote", {
      selection: selecaoComboWolf,
      paymentMethod: "pix",
      cupom: "Zanon",
    })
  ).json();
  // Combo Wolf tem custo próprio (13000 + 8000 + 14000 + 2800 = 37800).
  assert.equal(cupom.subtotalCents, 37800, "Combo Wolf não pegou o próprio preço de custo");

  for (const [field, value] of [
    ["hoodieColor", "hack"], ["hoodieSize", "XXXX"],
    ["shirtColor", "hack"], ["shirtColor", "off-white"], ["shirtColor", "preta"], ["shirtSize", "XXXX"],
    ["jerseyColor", "hack"], ["jerseyColor", "bicolor"], ["jerseySize", "XXXX"],
  ]) {
    const selection = structuredClone(selecaoComboWolf);
    selection["combo-wolf"].configurations["verde-m"][field] = value;
    const invalid = await post("/api/loja/checkout/quote", { selection, paymentMethod: "pix" });
    assert.equal(invalid.status, 400, `${field} inválido foi aceito`);
  }

  const criado = await (
    await post("/api/loja/checkout", {
      attemptId: novoAttempt(),
      customer: clienteValido,
      selection: selecaoComboWolf,
      paymentMethod: "pix",
    })
  ).json();
  assert.equal(criado.subtotalCents, 41500);
  assert.equal(sheet.rows.length, 1);
  const itens = sheet.rows[0][5];
  for (const detalhe of [
    "Combo Wolf", "Moletom: Verde / M", "Camiseta: Chumbo / G",
    "Jersey: Preta / GG", "Caneca com tirante: 1 unidade", "415,00",
  ]) {
    assert.match(itens, new RegExp(detalhe.replace(/[()]/g, "\\$&")));
  }
});

await test("uniformes novos validam tamanhos e congelam o snapshot completo na planilha", async () => {
  resetSheet();
  const quote = await (
    await post("/api/loja/checkout/quote", {
      selection: selecaoNovosUniformes,
      paymentMethod: "pix",
    })
  ).json();
  // 2x Conjunto Chumbo + 1x Conjunto Verde + 1x Jersey = R$ 570,00.
  assert.equal(quote.subtotalCents, 57000);

  const invalidas = [
    { "conjunto-chumbo": { configurations: { a: { quantity: 1, shortsSize: "G" } } } }, // sem camiseta
    { "conjunto-chumbo": { configurations: { a: { quantity: 1, shirtSize: "M" } } } }, // sem calção
    { jersey: { configurations: { a: { quantity: 1, color: "azul", size: "M" } } } }, // cor inválida
    { jersey: { configurations: { a: { quantity: 1, color: "branca", size: "XXXXXX" } } } }, // tamanho inválido
    { jersey: { configurations: { a: { quantity: 1, color: "branca", size: "M", personalizationNumber: "999" } } } }, // número inválido
  ];
  for (const selection of invalidas) {
    const res = await post("/api/loja/checkout/quote", { selection, paymentMethod: "pix" });
    assert.equal(res.status, 400, `deveria recusar: ${JSON.stringify(selection)}`);
  }

  const attemptId = novoAttempt();
  const criado = await (
    await post("/api/loja/checkout", {
      attemptId,
      customer: clienteValido,
      selection: selecaoNovosUniformes,
      paymentMethod: "pix",
    })
  ).json();
  assert.equal(criado.subtotalCents, 57000);
  assert.equal(sheet.rows.length, 1);
  const linha = sheet.rows[0];
  assert.match(linha[5], /Conjunto Chumbo/);
  assert.match(linha[5], /Conjunto Verde/);
  assert.match(linha[5], /Jersey/);
  assert.match(linha[5], /140,00/);
  assert.match(linha[5], /150,00/);
  assert.match(linha[19], /Conjunto Chumbo[^:]*: M/); // coluna T — tamanho da camiseta
  assert.match(linha[19], /Conjunto Verde[^:]*: G/);
  assert.match(linha[19], /Jersey[^:]*: G/);
  assert.match(linha[20], /Conjunto Chumbo[^:]*: G/); // coluna U — tamanho do calção
  assert.match(linha[20], /Conjunto Verde[^:]*: M/);
});

await test("Jersey avulsa: cor + tamanho + nome + número distintos, e tudo na planilha", async () => {
  resetSheet();
  const criado = await (
    await post("/api/loja/checkout", {
      attemptId: novoAttempt(),
      customer: clienteValido,
      selection: {
        jersey: {
          configurations: {
            a: { quantity: 1, color: "preta", size: "M", personalizationName: "ARTHUR", personalizationNumber: "23" },
            b: { quantity: 1, color: "preta", size: "M", personalizationName: "PEDRO", personalizationNumber: "23" },
            c: { quantity: 1, color: "branca", size: "M" },
          },
        },
      },
      paymentMethod: "pix",
    })
  ).json();
  assert.equal(criado.subtotalCents, 45000, "3x Jersey deveriam somar R$ 450,00 (personalização não cobra)");
  assert.equal(sheet.rows.length, 1);

  const linha = sheet.rows[0];
  assert.match(linha[5], /Jersey AASIAM \(Preta · Tam\. M · Nome: ARTHUR · Número: 23\)/);
  assert.match(linha[5], /Jersey AASIAM \(Preta · Tam\. M · Nome: PEDRO · Número: 23\)/);
  assert.match(linha[5], /Jersey AASIAM \(Branca · Tam\. M\)/);
  assert.match(linha[19], /Jersey AASIAM: M/); // coluna T
  assert.match(linha[21], /Jersey AASIAM: ARTHUR/); // coluna V — nome
  assert.match(linha[21], /Jersey AASIAM: PEDRO/);
  assert.match(linha[22], /Jersey AASIAM: 23/); // coluna W — número
  assert.ok(!/undefined|null|\[object/.test(linha[21] + linha[22]));
});

await test("Conjunto: nome/número da camiseta na planilha; calção sem personalização", async () => {
  resetSheet();
  await post("/api/loja/checkout", {
    attemptId: novoAttempt(),
    customer: clienteValido,
    selection: {
      "conjunto-verde": {
        configurations: {
          a: { quantity: 1, shirtSize: "M", shortsSize: "G", personalizationName: "ARTHUR", personalizationNumber: "23" },
          b: { quantity: 1, shirtSize: "M", shortsSize: "G", personalizationName: "PEDRO", personalizationNumber: "10" },
        },
      },
    },
    paymentMethod: "pix",
  });
  const linha = sheet.rows[0];
  assert.match(linha[5], /Conjunto Verde AASIAM \(Camiseta M · Calção G · Nome: ARTHUR · Número: 23\)/);
  assert.match(linha[19], /Conjunto Verde AASIAM: M/); // T — camiseta
  assert.match(linha[20], /Conjunto Verde AASIAM: G/); // U — calção
  assert.match(linha[21], /Conjunto Verde AASIAM: ARTHUR/); // V — nome (da camiseta)
  assert.match(linha[22], /Conjunto Verde AASIAM: 23/); // W — número
});

await test("Combo Wolf: personalização SÓ da camiseta, na chave, no resumo e na planilha", async () => {
  resetSheet();
  const attemptId = novoAttempt();
  const criado = await (
    await post("/api/loja/checkout", {
      attemptId,
      customer: clienteValido,
      selection: {
        "combo-wolf": {
          configurations: {
            a: {
              quantity: 1,
              hoodieColor: "verde", hoodieSize: "G",
              shirtColor: "chumbo", shirtSize: "M",
              jerseyColor: "preta", jerseySize: "GG",
              shirtPersonalizationName: "ARTHUR", shirtPersonalizationNumber: "23",
            },
            b: {
              quantity: 1,
              hoodieColor: "verde", hoodieSize: "G",
              shirtColor: "chumbo", shirtSize: "M",
              jerseyColor: "preta", jerseySize: "GG",
              shirtPersonalizationName: "PEDRO", shirtPersonalizationNumber: "10",
            },
          },
        },
      },
      paymentMethod: "pix",
    })
  ).json();
  // Mesmas cores/tamanhos, personalização diferente → NÃO agrupa. Preço base intacto.
  assert.equal(criado.subtotalCents, 2 * 41500);
  const linha = sheet.rows[0];
  assert.match(linha[5], /Camiseta: Chumbo \/ M · Nome: ARTHUR · Número: 23/);
  assert.match(linha[5], /Camiseta: Chumbo \/ M · Nome: PEDRO · Número: 10/);
  // A personalização não aparece grudada no moletom nem na jersey.
  assert.ok(!/Moletom:[^·]*Nome:/.test(linha[5]), "personalização vazou para o moletom");
  assert.ok(!/Jersey:[^·]*Nome:/.test(linha[5]), "personalização vazou para a jersey");
  assert.match(linha[21], /Combo Wolf: ARTHUR/); // V — nome da camiseta
  assert.match(linha[22], /Combo Wolf: 10/); // W — número da camiseta
});

await test("Combo Wolf sem personalização continua funcionando e custa R$ 415", async () => {
  resetSheet();
  const criado = await (
    await post("/api/loja/checkout", {
      attemptId: novoAttempt(),
      customer: clienteValido,
      selection: { "combo-wolf": { configurations: { a: {
        quantity: 1,
        hoodieColor: "verde", hoodieSize: "G",
        shirtColor: "chumbo", shirtSize: "M",
        jerseyColor: "preta", jerseySize: "GG",
      } } } },
      paymentMethod: "pix",
    })
  ).json();
  assert.equal(criado.subtotalCents, 41500);
  assert.equal(sheet.rows[0][21], "", "coluna Nome deveria estar vazia");
  assert.equal(sheet.rows[0][22], "", "coluna Número deveria estar vazia");
});

await test("Combos novos: preço reconstruído, cores validadas e snapshot completo na planilha", async () => {
  // ── Signature: preço fixo mesmo com valores forjados; as duas camisetas na planilha.
  resetSheet();
  const sigForjado = {
    "combo-signature": {
      configurations: {
        a: {
          quantity: 1,
          greenShirtColor: "chumbo", // tentativa de trocar a cor fixa — ignorada
          greenShirtSize: "M", greenShirtPersonalizationName: "ARTHUR", greenShirtPersonalizationNumber: "23",
          charcoalShirtSize: "G", charcoalShirtPersonalizationName: "PEDRO", charcoalShirtPersonalizationNumber: "10",
        },
      },
    },
  };
  const sigQuote = await (
    await post("/api/loja/checkout/quote", { selection: sigForjado, paymentMethod: "pix", price: 1, total: 1 })
  ).json();
  assert.equal(sigQuote.subtotalCents, 16000, "Signature aceitou preço do navegador");

  await post("/api/loja/checkout", {
    attemptId: novoAttempt(),
    customer: clienteValido,
    selection: sigForjado,
    paymentMethod: "pix",
  });
  let linha = sheet.rows[0];
  assert.match(linha[5], /Combo Signature/);
  assert.match(linha[5], /Camiseta Verde: Verde \/ M · Nome: ARTHUR · Número: 23/);
  assert.match(linha[5], /Camiseta Chumbo: Chumbo \/ G · Nome: PEDRO · Número: 10/);
  assert.match(linha[5], /R\$ 160,00 un\./);
  assert.match(linha[21], /Combo Signature: ARTHUR \/ PEDRO/); // V — nomes das duas camisetas
  assert.match(linha[22], /Combo Signature: 23 \/ 10/); // W — números das duas
  assert.ok(!/undefined|null|\[object/.test(linha[21] + linha[22]));

  for (const [campo, valor] of [["greenShirtSize", "XXXX"], ["charcoalShirtSize", ""]]) {
    const s = structuredClone(sigForjado);
    s["combo-signature"].configurations.a[campo] = valor;
    const r = await post("/api/loja/checkout/quote", { selection: s, paymentMethod: "pix" });
    assert.equal(r.status, 400, `${campo}=${valor} foi aceito`);
  }

  // ── Território: Jersey + caneca; cor inválida barrada; personalização opcional na planilha.
  resetSheet();
  await post("/api/loja/checkout", {
    attemptId: novoAttempt(),
    customer: clienteValido,
    selection: {
      "combo-territorio": {
        configurations: { a: { quantity: 1, jerseyColor: "preta", jerseySize: "M", jerseyPersonalizationName: "ARTHUR", jerseyPersonalizationNumber: "23" } },
      },
    },
    paymentMethod: "pix",
  });
  linha = sheet.rows[0];
  assert.match(linha[5], /Combo Território \(Jersey: Preta \/ M · Nome: ARTHUR · Número: 23 · Caneca com tirante: 1 unidade\).*R\$ 180,00 un\./);
  assert.match(linha[21], /Combo Território: ARTHUR/);
  assert.match(linha[22], /Combo Território: 23/);

  for (const [campo, valor] of [["jerseyColor", "azul"], ["jerseySize", "XXXX"], ["jerseyPersonalizationNumber", "999"]]) {
    const r = await post("/api/loja/checkout/quote", {
      selection: { "combo-territorio": { configurations: { a: { quantity: 1, jerseyColor: "preta", jerseySize: "M", [campo]: valor } } } },
      paymentMethod: "pix",
    });
    assert.equal(r.status, 400, `Território ${campo}=${valor} foi aceito`);
  }

  // ── Domínio: moletom + camiseta; só a camiseta personaliza; cor de camiseta fora da lista barrada.
  resetSheet();
  await post("/api/loja/checkout", {
    attemptId: novoAttempt(),
    customer: clienteValido,
    selection: {
      "combo-dominio": {
        configurations: { a: { quantity: 1, hoodieColor: "bege", hoodieSize: "G", shirtColor: "chumbo", shirtSize: "M", shirtPersonalizationName: "ARTHUR", shirtPersonalizationNumber: "23" } },
      },
    },
    paymentMethod: "pix",
  });
  linha = sheet.rows[0];
  assert.match(linha[5], /Combo Domínio \(Moletom: Off-white \/ G · Camiseta: Chumbo \/ M · Nome: ARTHUR · Número: 23\).*R\$ 230,00 un\./);
  assert.match(linha[21], /Combo Domínio: ARTHUR/);
  assert.match(linha[22], /Combo Domínio: 23/);
  assert.ok(!/Moletom:[^·]*Nome:/.test(linha[5]), "personalização vazou para o moletom");

  for (const [campo, valor] of [["shirtColor", "rosa"], ["shirtColor", "bege"], ["hoodieColor", "chumbo"], ["hoodieSize", "XXXX"]]) {
    const r = await post("/api/loja/checkout/quote", {
      selection: { "combo-dominio": { configurations: { a: { quantity: 1, hoodieColor: "bege", hoodieSize: "G", shirtColor: "chumbo", shirtSize: "M", [campo]: valor } } } },
      paymentMethod: "pix",
    });
    assert.equal(r.status, 400, `Domínio ${campo}=${valor} foi aceito`);
  }

  // Configurações diferentes não se agrupam.
  resetSheet();
  const dominioDuplo = await (
    await post("/api/loja/checkout", {
      attemptId: novoAttempt(),
      customer: clienteValido,
      selection: {
        "combo-dominio": {
          configurations: {
            a: { quantity: 1, hoodieColor: "bege", hoodieSize: "G", shirtColor: "chumbo", shirtSize: "M" },
            b: { quantity: 1, hoodieColor: "verde", hoodieSize: "G", shirtColor: "chumbo", shirtSize: "M" },
          },
        },
      },
      paymentMethod: "pix",
    })
  ).json();
  assert.equal(dominioDuplo.subtotalCents, 46000, "Domínio agrupou cores de moletom diferentes");
});

await test("Camiseta personalizada: tamanho, nome e número chegam à planilha (e vazios ficam vazios)", async () => {
  resetSheet();

  // Duas camisetas com personalizações diferentes + uma sem nada = 3 linhas de pedido.
  const selection = {
    "camiseta-aasiam": {
      configurations: {
        a: { quantity: 1, size: "M", personalizationName: "ARTHUR", personalizationNumber: "23" },
        b: { quantity: 1, size: "M", personalizationName: "PEDRO", personalizationNumber: "10" },
      },
    },
    "camiseta-goleiro-aasiam": {
      configurations: { c: { quantity: 2, size: "GG" } },
    },
  };

  const quote = await (
    await post("/api/loja/checkout/quote", { selection, paymentMethod: "pix" })
  ).json();
  assert.equal(quote.subtotalCents, 4 * 9000, "personalização mexeu no preço");

  const criado = await (
    await post("/api/loja/checkout", {
      attemptId: novoAttempt(),
      customer: clienteValido,
      selection,
      paymentMethod: "pix",
    })
  ).json();
  assert.equal(criado.subtotalCents, 36000);
  assert.equal(sheet.rows.length, 1);

  const linha = sheet.rows[0];
  // Coluna F "Itens" carrega a descrição legível.
  assert.match(linha[5], /Camiseta AASIAM 2026 \(Tam\. M · Nome: ARTHUR · Número: 23\)/);
  assert.match(linha[5], /Camiseta AASIAM 2026 \(Tam\. M · Nome: PEDRO · Número: 10\)/);
  assert.match(linha[5], /2x Camiseta Goleiro AASIAM 2026 \(Tam\. GG\)/);
  // Coluna T "Tamanho da camiseta".
  assert.match(linha[19], /Camiseta AASIAM 2026: M/);
  assert.match(linha[19], /2x Camiseta Goleiro AASIAM 2026: GG/);
  // Coluna V "Nome na camiseta" e W "Número na camiseta".
  assert.match(linha[21], /Camiseta AASIAM 2026: ARTHUR/);
  assert.match(linha[21], /Camiseta AASIAM 2026: PEDRO/);
  assert.match(linha[22], /Camiseta AASIAM 2026: 23/);
  assert.match(linha[22], /Camiseta AASIAM 2026: 10/);
  // A goleiro sem personalização não polui as colunas V/W.
  assert.ok(!linha[21].includes("Goleiro"), "goleiro sem nome apareceu na coluna Nome");
  assert.ok(!linha[22].includes("Goleiro"), "goleiro sem número apareceu na coluna Número");
  assert.ok(!/undefined|null|\[object/.test(linha[21] + linha[22]));
});

await test("Camiseta sem personalização deixa as colunas Nome/Número vazias", async () => {
  resetSheet();
  await post("/api/loja/checkout", {
    attemptId: novoAttempt(),
    customer: clienteValido,
    selection: { "camiseta-aasiam": { configurations: { a: { quantity: 1, size: "P" } } } },
    paymentMethod: "pix",
  });
  const linha = sheet.rows[0];
  assert.match(linha[19], /Camiseta AASIAM 2026: P/);
  assert.equal(linha[21], "", "coluna Nome deveria estar vazia");
  assert.equal(linha[22], "", "coluna Número deveria estar vazia");
});

await test("Camiseta sem tamanho é recusada no checkout", async () => {
  resetSheet();
  const res = await post("/api/loja/checkout", {
    attemptId: novoAttempt(),
    customer: clienteValido,
    selection: { "camiseta-aasiam": { configurations: { a: { quantity: 1, personalizationName: "ARTHUR" } } } },
    paymentMethod: "pix",
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /tamanho|produto/i);
  assert.equal(sheet.rows.length, 0, "criou linha para camiseta sem tamanho");
});

await test("Camiseta: frontend não força preço nem personalização inválida", async () => {
  resetSheet();
  // Nome gigante e número fora do formato — o backend recusa.
  const res = await post("/api/loja/checkout", {
    attemptId: novoAttempt(),
    customer: clienteValido,
    selection: {
      "camiseta-aasiam": {
        configurations: { a: { quantity: 1, size: "M", personalizationName: "N".repeat(40), personalizationNumber: "999" } },
      },
    },
    paymentMethod: "pix",
    subtotalCents: 1,
  });
  assert.equal(res.status, 400);
});

/* ── Checkout com cartão ── */

await test("cartão aprovado: cria a linha, cobra o total certo e grava Pago", async () => {
  resetSheet();
  mp.requisicoes = [];
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
  assert.ok(criacao.headers["X-Idempotency-Key"], "X-Idempotency-Key ausente");

  // A API de Orders não aceita estas propriedades no corpo — o payload não as envia.
  assert.equal(Object.hasOwn(criacao.body, "notification_url"), false, "notification_url não pode ir no corpo");
  assert.equal(Object.hasOwn(criacao.body, "metadata"), false, "metadata não pode ir no corpo");
  assert.deepEqual(Object.keys(criacao.body.payer), ["email"], "payer só carrega email");

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

await test("payload Pix da loja é o mínimo do contrato oficial (sem 400)", async () => {
  resetSheet();
  mp.requisicoes = [];
  const attemptId = novoAttempt();
  const res = await post("/api/loja/checkout", {
    attemptId,
    customer: clienteValido,
    selection: selecaoMoletom,
    paymentMethod: "pix",
  });
  assert.equal(res.status, 201, "o Mercado Pago recusou o payload Pix");
  const corpo = await res.json();
  assert.ok(corpo.pix?.qrCodeBase64, "sem QR Code");

  const [criacao] = requisicoesPara("POST", "/v1/orders");
  assert.equal(criacao.body.type, "online");
  assert.equal(criacao.body.total_amount, (corpo.totalCents / 100).toFixed(2));
  assert.match(criacao.body.external_reference, /^LOJA-/);
  assert.equal(criacao.body.processing_mode, "automatic");
  const pgto = criacao.body.transactions.payments[0];
  assert.equal(pgto.payment_method.id, "pix");
  assert.equal(pgto.payment_method.type, "bank_transfer");
  assert.ok(pgto.expiration_time, "sem expiration_time");
  assert.deepEqual(Object.keys(criacao.body.payer), ["email"]);
  assert.ok(criacao.headers["X-Idempotency-Key"]);
  // Nenhuma propriedade fora do contrato.
  const RAIZ_OK = new Set(["type", "total_amount", "external_reference", "processing_mode", "transactions", "payer"]);
  assert.deepEqual(Object.keys(criacao.body).filter((k) => !RAIZ_OK.has(k)), []);
});

await test("mesmo attemptId no Pix não gera duas orders", async () => {
  resetSheet();
  mp.requisicoes = [];
  const attemptId = novoAttempt();
  const corpo = { attemptId, customer: clienteValido, selection: selecaoMoletom, paymentMethod: "pix" };
  const [a, b] = await Promise.all([post("/api/loja/checkout", corpo), post("/api/loja/checkout", corpo)]);
  const ja = await a.json();
  const jb = await b.json();
  assert.equal(ja.orderId, jb.orderId);
  assert.equal(requisicoesPara("POST", "/v1/orders").length, 1, "criou duas orders");
  assert.equal(sheet.rows.length, 1);
});

await test("Mercado Pago 400 unsupported_properties: diagnóstico sanitizado, sem PII", async () => {
  const mpMod = await import("./mercadopago.js");
  mp.requisicoes = [];
  let capturado = null;
  try {
    // O cliente real não envia props inválidas; forçamos uma pelo transporte.
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("/v1/orders") && init?.method === "POST") {
        const body = JSON.parse(init.body);
        body.notification_url = "https://x";
        return original(url, { ...init, body: JSON.stringify(body) });
      }
      return original(url, init);
    };
    try {
      await mpMod.criarOrder({
        externalReference: "LOJA-2026-TESTE400",
        totalAmountCents: 10000,
        payerEmail: "quem@exemplo.com",
        idempotencyKey: "k".repeat(10),
        payments: [{ amountCents: 10000, payment_method: { id: "pix", type: "bank_transfer" } }],
      });
    } finally {
      globalThis.fetch = original;
    }
  } catch (err) {
    capturado = err;
  }
  assert.ok(capturado, "deveria ter lançado");
  assert.equal(capturado.code, "requisicao_invalida");
  assert.equal(capturado.status, 400);
  assert.equal(capturado.mpCauses.includes("unsupported_properties"), true);
  assert.equal(capturado.mpFields.includes("notification_url"), true);
  const diag = capturado.diagnostico;
  assert.ok(!diag.includes("quem@exemplo.com"), "e-mail vazou no diagnóstico");
  assert.ok(!diag.includes("TEST-"), "token vazou no diagnóstico");
});

await test("mensagem de erro do Pix não menciona cartão", async () => {
  resetSheet();
  // Força um 400 do Mercado Pago só nesta chamada.
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/v1/orders") && init?.method === "POST") {
      globalThis.fetch = original;
      return resposta(400, { error: "bad_request", cause: [{ code: "property_value", description: "amount" }] });
    }
    return original(url, init);
  };
  const res = await post("/api/loja/checkout", {
    attemptId: novoAttempt(),
    customer: clienteValido,
    selection: selecaoMoletom,
    paymentMethod: "pix",
  });
  globalThis.fetch = original;
  const corpo = await res.json();
  assert.ok(!/cart[ãa]o/i.test(corpo.error), `mensagem cita cartão: "${corpo.error}"`);
  assert.match(corpo.error, /pix/i);
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

/* ── Cupons pessoais de preço de custo ──
   As rotas /api/validar-cupom e /api/usar-cupom vivem em index.js; aqui o teste
   exercita a REGRA (`checkCoupon`) e o store direto, mais o caminho HTTP real do
   checkout (/api/loja/checkout[/quote]). O teste HTTP das rotas de validação
   está em _test_loja.mjs. */
const { checkCoupon } = await import("./cupons.js");

await test("cupom pessoal válido: tipo custo, nome canônico, contador zerado", async () => {
  resetTudo();
  assert.deepEqual(await checkCoupon("Zanon"), {
    valido: true,
    tipo: "custo",
    codigo: "Zanon",
    usos: 0,
    max: 2,
  });
});

await test("cupom inexistente → invalido; case-insensitive e trim identificam o mesmo cupom", async () => {
  resetTudo();
  assert.deepEqual(await checkCoupon("ninguem aqui"), { valido: false, motivo: "invalido" });
  for (const variante of ["zanon", "ZANON", "  Zanon  ", " zAnOn "]) {
    const j = await checkCoupon(variante);
    assert.equal(j.valido, true, `"${variante}" não validou`);
    assert.equal(j.codigo, "Zanon");
  }
});

await test("cupom desativado na planilha → recusado como 'inativo'", async () => {
  resetTudo();
  await cuponsStore.seedCupons(); // cria a aba
  cupomRow("Milton")[3] = "Não"; // coluna D — Ativo, editado "na mão"
  resetCuponsStoreForTests(); // limpa só o cache; a linha alterada permanece
  assert.deepEqual(await checkCoupon("milton"), { valido: false, motivo: "inativo" });
});

await test("primeiro e segundo uso passam; terceiro é bloqueado e o contador para em 2", async () => {
  resetTudo();
  const s = cuponsStore;
  assert.equal((await s.checkCupomCusto("Samuel")).valido, true);
  assert.equal((await s.contabilizarUsoCupom("Samuel", "PED-1")).contabilizado, true);
  assert.equal((await s.checkCupomCusto("Samuel")).valido, true);
  assert.equal((await s.contabilizarUsoCupom("Samuel", "PED-2")).contabilizado, true);
  assert.deepEqual(
    [(await s.checkCupomCusto("Samuel")).valido, (await s.checkCupomCusto("Samuel")).motivo],
    [false, "esgotado"]
  );
  const terceiro = await s.contabilizarUsoCupom("Samuel", "PED-3");
  assert.deepEqual([terceiro.ok, terceiro.motivo], [false, "esgotado"]);
  assert.equal(Number(cupomRow("Samuel")[2]), 2); // coluna C — usos
});

await test("webhook duplicado (mesmo pedido) não consome duas utilizações", async () => {
  resetTudo();
  const a = await cuponsStore.contabilizarUsoCupom("Amanda", "PED-X");
  const b = await cuponsStore.contabilizarUsoCupom("Amanda", "PED-X");
  const c = await cuponsStore.contabilizarUsoCupom("Amanda", "PED-X");
  assert.equal(a.contabilizado, true);
  assert.equal(b.jaContava, true);
  assert.equal(c.jaContava, true);
  assert.equal(Number(cupomRow("Amanda")[2]), 1);
});

await test("concorrência: duas contabilizações simultâneas na última utilização não passam de max", async () => {
  resetTudo();
  const s = cuponsStore;
  await s.contabilizarUsoCupom("Gabriel", "PED-1"); // usos = 1 (falta 1)
  const [r1, r2] = await Promise.all([
    s.contabilizarUsoCupom("Gabriel", "PED-2"),
    s.contabilizarUsoCupom("Gabriel", "PED-3"),
  ]);
  assert.equal([r1, r2].filter((r) => r.contabilizado).length, 1, "as duas contaram");
  assert.equal([r1, r2].filter((r) => r.ok === false && r.motivo === "esgotado").length, 1);
  assert.equal(Number(cupomRow("Gabriel")[2]), 2, "contador passou de 2");
});

await test("cupom recalcula custo de vários produtos e quantidade > 1; ignora números do navegador", async () => {
  resetTudo();
  const selection = {
    "moletom-verde": { variants: { verde: { M: 2 } } }, // 2 × custo 13000
    caneca: { quantity: 3 }, // 3 × custo 2800
  };
  const q = await (
    await post("/api/loja/checkout/quote", {
      selection,
      paymentMethod: "pix",
      cupom: "Marcelo",
      price: 1,
      subtotal: 1,
      subtotalCents: 1,
      descontoCents: 999999,
    })
  ).json();
  assert.equal(q.subtotalOriginalCents, 2 * 16000 + 3 * 4000); // 44000
  assert.equal(q.subtotalCents, 2 * 13000 + 3 * 2800); // 34400
  assert.equal(q.descontoCents, 44000 - 34400); // 9600
});

await test("checkout com cupom: total ao Mercado Pago = grossUp(custo), planilha congela X/Y/Z, uso contabilizado só ao aprovar", async () => {
  resetTudo();
  mp.requisicoes = [];
  const criado = await (
    await post("/api/loja/checkout", {
      attemptId: novoAttempt(),
      customer: clienteValido,
      selection: selecaoMoletom, // 2× moletom-verde → orig 32000, custo 26000
      cupom: "  jessika ",
      paymentMethod: "credit_card",
      cardToken: "a".repeat(32),
      paymentMethodId: "master",
      installments: 1,
    })
  ).json();

  const totalEsperado = feesMod.grossUpCents(26000, 498);
  assert.equal(criado.subtotalCents, 26000);
  assert.equal(criado.totalCents, totalEsperado);
  assert.equal(criado.cupom, "Jessika");

  const [criacao] = requisicoesPara("POST", "/v1/orders");
  assert.equal(criacao.body.total_amount, (totalEsperado / 100).toFixed(2));

  const linha = sheet.rows[0];
  assert.equal(linha[23], "Jessika"); // X — Cupom
  assert.match(linha[24], /R\$ 320,00/); // Y — Subtotal sem cupom
  assert.match(linha[25], /R\$ 60,00/); // Z — Desconto do cupom
  assert.equal(linha[12], "Pago"); // M — Status

  assert.equal(Number(cupomRow("Jessika")[2]), 1, "cupom não contabilizado após aprovação");
});

await test("Pix com cupom: contabiliza só quando o webhook aprova, e webhook reenviado não conta de novo", async () => {
  resetTudo();
  const attemptId = novoAttempt();
  await post("/api/loja/checkout", {
    attemptId,
    customer: clienteValido,
    selection: selecaoMoletom,
    cupom: "Guilherme",
    paymentMethod: "pix",
  });
  // Antes de qualquer webhook: nada contabilizado.
  assert.equal(Number(cupomRow("Guilherme")[2]), 0);

  const orderId = orderIdDeTentativa(attemptId);
  const orderMp = [...mp.orders.values()].find((o) => o.external_reference === orderId);
  Object.assign(orderMp, { status: "processed", status_detail: "accredited" });
  Object.assign(orderMp.transactions.payments[0], { status: "processed", status_detail: "accredited" });

  await notificar(orderMp.id);
  await notificar(orderMp.id);
  await notificar(orderMp.id);
  assert.equal(Number(cupomRow("Guilherme")[2]), 1);

  // A planilha do pedido guardou o cupom mesmo o pagamento sendo assíncrono.
  assert.equal(sheet.rows[0][23], "Guilherme");
});

await test("produto sem preço de custo BLOQUEIA o checkout com cupom (sem fallback silencioso)", async () => {
  resetTudo();
  const { PRODUCT_BY_ID } = await import("./shared/products.js");
  const original = PRODUCT_BY_ID["caneca"].costCents;
  delete PRODUCT_BY_ID["caneca"].costCents;
  try {
    const q = await post("/api/loja/checkout/quote", {
      selection: { caneca: { quantity: 1 } },
      paymentMethod: "pix",
      cupom: "Dotto",
    });
    assert.equal(q.status, 400);
    const jq = await q.json();
    assert.equal(jq.field, "cupom");
    assert.match(jq.error, /não foi poss[ií]vel aplicar o cupom/i);

    const chk = await post("/api/loja/checkout", {
      attemptId: novoAttempt(),
      customer: clienteValido,
      selection: { caneca: { quantity: 1 } },
      cupom: "Dotto",
      paymentMethod: "pix",
    });
    assert.equal(chk.status, 400);
    assert.equal(sheet.rows.length, 0, "criou linha para um checkout bloqueado");
    // Cupom intacto — nada foi contabilizado.
    assert.equal(Number(cupomRow("Dotto")[2]), 0);
  } finally {
    PRODUCT_BY_ID["caneca"].costCents = original;
  }
});

await test("cupom esgotado é recusado no /quote com a mensagem de limite", async () => {
  resetTudo();
  await cuponsStore.contabilizarUsoCupom("Sofia", "PED-A");
  await cuponsStore.contabilizarUsoCupom("Sofia", "PED-B");
  resetCuponsStoreForTests();
  const q = await post("/api/loja/checkout/quote", {
    selection: selecaoMoletom,
    paymentMethod: "pix",
    cupom: "Sofia",
  });
  assert.equal(q.status, 400);
  const jq = await q.json();
  assert.match(jq.error, /limite de utiliza/i);
  assert.equal(jq.cupomInvalido, true);
});

await test("checkout SEM cupom continua idêntico (colunas X/Y/Z vazias)", async () => {
  resetTudo();
  const criado = await (
    await post("/api/loja/checkout", {
      attemptId: novoAttempt(),
      customer: clienteValido,
      selection: selecaoMoletom,
      paymentMethod: "pix",
    })
  ).json();
  assert.equal(criado.subtotalCents, 32000);
  assert.equal(criado.cupom, null);
  const linha = sheet.rows[0];
  assert.equal(linha[23], "");
  assert.equal(linha[24], "");
  assert.equal(linha[25], "");
});

server.close();
console.log(`\n${passed} teste(s) passaram, ${failures.length} falharam.\n`);
if (failures.length) {
  for (const { nome, err } of failures) console.error(`FALHOU: ${nome}\n${err.stack}\n`);
  process.exit(1);
}
process.exit(0);
