import https from "node:https";
import { constants } from "node:crypto";

const BASE_URL = "https://api.checkout.infinitepay.io";

// Node 18+/OpenSSL 3 rejeita cipher suites legados usados pela InfinitePay.
// SSL_OP_LEGACY_SERVER_CONNECT permite o handshake sem afetar o restante da aplicação.
const tlsAgent = new https.Agent({
  secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
});

/**
 * Faz um POST HTTPS usando node:https (com agente TLS permissivo).
 * @returns {{ status: number, body: object|string }}
 */
function httpsPost(url, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(payload);

    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        agent: tlsAgent,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          resolve({ status: res.statusCode, body });
        });
      }
    );

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/** URLs base, sem barra final. Usadas pela loja e pelo churrasco. */
export function appBaseUrl() {
  return (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

export function apiBaseUrl() {
  return (process.env.API_URL || "http://localhost:3333").replace(/\/$/, "");
}

/* Os dois padrões do checkout da loja. Ficam nomeados aqui para que um teste
   consiga afirmar que eles não mudaram quando o churrasco passou a reusar
   `criarLinkPagamento`. */
export function defaultRedirectUrl(orderId) {
  return `${appBaseUrl()}/pagamento-concluido?pedido=${orderId}&status=concluido`;
}

export function defaultWebhookUrl() {
  return `${apiBaseUrl()}/api/webhooks/infinitepay`;
}

/**
 * Cria um link de pagamento no Checkout Integrado da InfinitePay.
 *
 * Os quatro últimos parâmetros são opcionais e existem para que outros fluxos
 * (hoje, as inscrições do churrasco) usem a mesma integração com uma
 * InfiniteTag, um retorno e um webhook próprios. Sem eles, o comportamento é
 * exatamente o da loja — nada muda para o checkout existente.
 *
 * @param {object} params
 * @param {string} params.orderId       - ID único do pedido (order_nsu)
 * @param {Array}  params.items         - [{ quantity, price (centavos, inteiro), description }]
 * @param {object} params.cliente       - { nome, telefone, email? }
 * @param {string} [params.handle]      - InfiniteTag; padrão INFINITEPAY_HANDLE
 * @param {string} [params.redirectUrl] - para onde a pessoa volta após pagar
 * @param {string} [params.webhookUrl]  - para onde a InfinitePay notifica
 * @param {string} [params.evento]      - rótulo usado só nos logs
 * @returns {Promise<{ url: string }>}
 */
export async function criarLinkPagamento({
  orderId,
  items,
  cliente,
  handle,
  redirectUrl,
  webhookUrl,
  evento = "Loja",
}) {
  const tag = handle || process.env.INFINITEPAY_HANDLE;
  if (!tag) throw new Error("INFINITEPAY_HANDLE não configurado no .env");

  const redirect = redirectUrl || defaultRedirectUrl(orderId);
  const webhook = webhookUrl || defaultWebhookUrl();

  // Log de diagnóstico — confirma o destino do webhook enviado à InfinitePay
  console.log(`[InfinitePay/${evento}] webhook_url:`, webhook);
  if (!process.env.API_URL) {
    console.warn(
      "[InfinitePay] ⚠ API_URL não está definida — webhook aponta para localhost e a InfinitePay NÃO conseguirá notificar o pagamento em produção. Configure API_URL no Render."
    );
  }

  const payload = {
    handle: tag,
    order_nsu: orderId,
    redirect_url: redirect,
    webhook_url: webhook,
    items: items.map((item) => ({
      quantity: item.quantity,           // inteiro
      price: item.price,                 // centavos, inteiro
      description: String(item.description).slice(0, 255),
    })),
    customer: {
      name: cliente.nome,
      phone_number: cliente.telefone,
    },
  };

  if (cliente.email) {
    payload.customer.email = cliente.email;
  }

  const { status, body } = await httpsPost(`${BASE_URL}/links`, payload);

  if (status < 200 || status >= 300) {
    const msg = body?.message || body?.error || "InfinitePay recusou a criação do link.";
    const err = new Error(msg);
    err.status = status;
    throw err;
  }

  if (!body.url) {
    throw new Error("InfinitePay não retornou a URL de pagamento.");
  }

  return { url: body.url };
}

/**
 * Verifica o status de um pagamento na InfinitePay via payment_check.
 *
 * @param {object} params
 * @param {string} params.orderId        - order_nsu do pedido
 * @param {string} params.transactionNsu - transaction_nsu do webhook
 * @param {string} params.slug           - invoice_slug do webhook
 * @param {string} [params.handle]       - InfiniteTag; padrão INFINITEPAY_HANDLE
 */
export async function verificarPagamento({ orderId, transactionNsu, slug, handle }) {
  const tag = handle || process.env.INFINITEPAY_HANDLE;
  if (!tag) throw new Error("INFINITEPAY_HANDLE não configurado no .env");

  const { status, body } = await httpsPost(`${BASE_URL}/payment_check`, {
    handle: tag,
    order_nsu: orderId,
    transaction_nsu: transactionNsu,
    slug,
  });

  if (status < 200 || status >= 300) {
    const msg = body?.message || body?.error || "Erro ao verificar pagamento.";
    const err = new Error(msg);
    err.status = status;
    throw err;
  }

  return body;
}
