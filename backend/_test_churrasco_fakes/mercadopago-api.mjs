/**
 * API do Mercado Pago falsa — usada só pelos testes.
 *
 * Em vez de trocar `mercadopago.js` por um dublê, trocamos o `fetch` global:
 * assim o cliente REAL é exercitado, e o teste consegue afirmar coisas sobre o
 * que de fato sai pela rede — o corpo enviado a `POST /v1/orders`, o header
 * `X-Idempotency-Key`, o tratamento de 429 com `Retry-After`.
 *
 * Nenhuma chamada sai da máquina e nenhum pagamento real acontece.
 */

export const mp = {
  /** orderId → order, no formato da API de Orders. */
  orders: new Map(),
  /** X-Idempotency-Key → orderId, como o Mercado Pago faz. */
  porChave: new Map(),
  /** Toda requisição vista: { method, path, headers, body }. */
  requisicoes: [],
  /** Próxima resposta forçada: { status, retryAfter } ou "abort". Uso único. */
  falha: null,
  seq: 0,
};

export function resetMercadoPago() {
  mp.orders.clear();
  mp.porChave.clear();
  mp.requisicoes = [];
  mp.falha = null;
}

/** Um QR PNG mínimo, só para o front ter um Base64 de verdade para renderizar. */
const QR_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function novaOrder(payload) {
  const n = ++mp.seq;
  const id = `ORD01TEST${n}`;
  const pagamento = payload.transactions.payments[0];

  return {
    id,
    type: payload.type,
    status: "action_required",
    status_detail: "waiting_transfer",
    external_reference: payload.external_reference,
    total_amount: payload.total_amount,
    processing_mode: payload.processing_mode,
    transactions: {
      payments: [
        {
          id: `PAY01TEST${n}`,
          amount: pagamento.amount,
          status: "action_required",
          status_detail: "waiting_transfer",
          payment_method: {
            id: pagamento.payment_method.id,
            type: pagamento.payment_method.type,
            qr_code: `00020126580014BR.GOV.BCB.PIX${id}5204000053039865802BR`,
            qr_code_base64: QR_BASE64,
            ticket_url: `https://www.mercadopago.com.br/payments/${id}/ticket`,
            expiration_date: new Date(Date.now() + 30 * 60_000).toISOString(),
          },
        },
      ],
    },
  };
}

/** Move o estado da order como o banco moveria. */
export function moverOrder(orderId, { order = {}, payment = {}, metodo = {} } = {}) {
  const alvo = mp.orders.get(orderId);
  if (!alvo) throw new Error(`order ${orderId} não existe no dublê`);
  Object.assign(alvo, order);
  Object.assign(alvo.transactions.payments[0], payment);
  Object.assign(alvo.transactions.payments[0].payment_method, metodo);
  return alvo;
}

/** Pagamento aprovado e creditado — o único caminho que confirma. */
export function creditar(orderId, extra = {}) {
  return moverOrder(orderId, {
    order: { status: "processed", status_detail: "accredited" },
    payment: { status: "processed", status_detail: "accredited" },
    ...extra,
  });
}

/** A order criada para uma referência (a última, quando houver várias). */
export function orderDe(referencia) {
  let achada = null;
  for (const order of mp.orders.values()) {
    if (order.external_reference === referencia) achada = order;
  }
  return achada;
}

/** Cria uma order que o churrasco não pediu — usada nos testes de webhook. */
export function plantarOrder(order) {
  mp.orders.set(order.id, order);
  return order;
}

export function requisicoesPara(metodo, prefixo) {
  return mp.requisicoes.filter(
    (r) => r.method === metodo && r.path.startsWith(prefixo)
  );
}

function resposta(status, corpo, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (nome) => headers[String(nome).toLowerCase()] ?? null },
    text: async () => JSON.stringify(corpo),
  };
}

/**
 * Instala o `fetch` falso. Só intercepta api.mercadopago.com; o resto do
 * teste (que fala com o Express local) continua usando o fetch de verdade.
 */
export function instalarFetchFalso() {
  const original = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    const alvo = new URL(String(url));
    if (alvo.hostname !== "api.mercadopago.com") return original(url, init);

    const registro = {
      method: init.method || "GET",
      path: alvo.pathname,
      headers: { ...(init.headers || {}) },
      body: init.body ? JSON.parse(init.body) : null,
    };
    mp.requisicoes.push(registro);

    if (mp.falha) {
      const falha = mp.falha;
      mp.falha = null;
      if (falha === "abort") {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        throw err;
      }
      return resposta(
        falha.status,
        { message: "erro simulado", cause: [{ code: "x" }] },
        falha.retryAfter ? { "retry-after": String(falha.retryAfter) } : {}
      );
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
      if (!order) return resposta(404, { message: "not found" });
      return resposta(200, order);
    }

    return resposta(404, { message: "rota não simulada" });
  };

  return () => {
    globalThis.fetch = original;
  };
}
