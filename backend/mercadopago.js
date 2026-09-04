/**
 * Mercado Pago — API de Orders (Checkout Transparente), só Pix.
 *
 * Usada exclusivamente pelas inscrições do churrasco. A loja continua na
 * InfinitePay (`infinitepay.js`) e nada deste arquivo é importado por ela.
 *
 * Endpoints oficiais:
 *   POST https://api.mercadopago.com/v1/orders
 *   GET  https://api.mercadopago.com/v1/orders/{id}
 *
 * Três coisas nunca saem daqui: o Access Token, o segredo do webhook e o
 * corpo cru da resposta. Os erros são traduzidos para um `code` estável, e
 * quem chama decide a mensagem que o participante vê.
 */
import crypto from "node:crypto";

import {
  METODO_PERMITIDO,
  PIX_EXPIRACAO,
  TIPO_METODO_PERMITIDO,
  amountToCents,
  centsToAmountString,
} from "./shared/churrasco.js";

const BASE_URL = "https://api.mercadopago.com";
const TIMEOUT_MS = 12_000;

/* ─── Credenciais ────────────────────────────────────────────────────── */

/** Só no backend. Nunca com prefixo VITE_, nunca em resposta de API. */
function accessToken() {
  return String(process.env.MERCADO_PAGO_ACCESS_TOKEN || "").trim();
}

function webhookSecret() {
  return String(process.env.MERCADO_PAGO_WEBHOOK_SECRET || "").trim();
}

export function isMercadoPagoConfigured() {
  return Boolean(accessToken());
}

export function isWebhookSecretConfigured() {
  return Boolean(webhookSecret());
}

/** "TEST-..." é credencial de sandbox; "APP_USR-..." é produção. */
export function ambienteMercadoPago() {
  const token = accessToken();
  if (!token) return "ausente";
  if (token.startsWith("TEST-")) return "teste";
  return "producao";
}

/* ─── Erros ──────────────────────────────────────────────────────────── */

/**
 * Erro de integração já sanitizado. `code` é o que o resto do sistema lê;
 * `message` fica curta e sem nada do corpo devolvido pelo Mercado Pago.
 *
 * Os campos `mp*` carregam só diagnóstico seguro extraído da resposta de erro
 * (códigos oficiais, nomes de propriedade recusada, id da requisição) — nunca
 * valor de campo, dado do pagador ou o corpo cru.
 */
export class MercadoPagoError extends Error {
  constructor(
    code,
    message,
    { status = 0, retryAfterSeconds = null, mpCode = "", mpCauses = [], mpFields = [], mpRequestId = "" } = {}
  ) {
    super(message);
    this.name = "MercadoPagoError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    /** Código oficial do erro do Mercado Pago (ex: "unsupported_properties"). */
    this.mpCode = mpCode;
    /** Códigos das causas (ex: [2067, "invalid_param"]). */
    this.mpCauses = mpCauses;
    /** Nomes de propriedade citados na recusa (ex: ["notification_url"]). */
    this.mpFields = mpFields;
    /** x-request-id do Mercado Pago, para rastrear no painel. */
    this.mpRequestId = mpRequestId;
  }

  /** Resumo de uma linha, sem PII, para log. */
  get diagnostico() {
    const partes = [`status=${this.status || "?"}`, `code=${this.mpCode || this.code}`];
    if (this.mpCauses.length) partes.push(`causes=${this.mpCauses.join(",")}`);
    if (this.mpFields.length) partes.push(`fields=${this.mpFields.join(",")}`);
    if (this.mpRequestId) partes.push(`request-id=${this.mpRequestId}`);
    return partes.join(" ");
  }
}

/* Propriedades conhecidas da API de Orders. Um nome citado na descrição de um
   erro que esteja nesta lista é seguro de logar; qualquer outra coisa (valor
   de campo, e-mail, nome) não casa com o padrão e fica de fora. */
const CAMPOS_ORDERS = new Set([
  "type", "total_amount", "external_reference", "processing_mode", "description",
  "transactions", "payments", "payment_method", "id", "token", "installments",
  "amount", "expiration_time", "payer", "email", "first_name", "last_name",
  "identification", "items", "notification_url", "metadata", "config",
  "marketplace", "integration_data",
]);

/**
 * Extrai diagnóstico seguro do corpo de erro do Mercado Pago.
 * Formato observado: { message, error, status, cause: [{ code, description }] }
 * ou { errors: [{ code, message }] }.
 */
function lerErroMp(dados) {
  if (!dados || typeof dados !== "object") return { mpCode: "", mpCauses: [], mpFields: [] };

  const mpCode = String(dados.error || dados.code || dados.name || "").slice(0, 60);

  const causas = Array.isArray(dados.cause)
    ? dados.cause
    : Array.isArray(dados.errors)
      ? dados.errors
      : [];

  const mpCauses = [];
  const mpFields = new Set();
  for (const causa of causas.slice(0, 10)) {
    if (causa == null) continue;
    const c = causa.code ?? causa.error;
    if (c != null) mpCauses.push(String(c).slice(0, 40));
    const texto = String(causa.description || causa.message || "");
    for (const token of texto.match(/[a-z_][a-z0-9_]{2,40}/gi) || []) {
      if (CAMPOS_ORDERS.has(token.toLowerCase())) mpFields.add(token.toLowerCase());
    }
  }
  // A mensagem de topo às vezes cita a propriedade recusada.
  for (const token of String(dados.message || "").match(/[a-z_][a-z0-9_]{2,40}/gi) || []) {
    if (CAMPOS_ORDERS.has(token.toLowerCase())) mpFields.add(token.toLowerCase());
  }

  return { mpCode, mpCauses, mpFields: [...mpFields] };
}

function codeParaStatus(status) {
  if (status === 401 || status === 403) return "credencial_invalida";
  if (status === 404) return "nao_encontrado";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 422) return "requisicao_invalida";
  if (status >= 500) return "indisponivel";
  return "erro";
}

/** `Retry-After` pode vir em segundos ou como data HTTP. */
function lerRetryAfter(headerValue) {
  const bruto = String(headerValue || "").trim();
  if (!bruto) return null;
  if (/^\d+$/.test(bruto)) return Math.min(300, Number(bruto));
  const data = Date.parse(bruto);
  if (Number.isNaN(data)) return null;
  return Math.max(0, Math.min(300, Math.ceil((data - Date.now()) / 1000)));
}

/* ─── Transporte ─────────────────────────────────────────────────────── */

async function chamar(caminho, { method = "GET", body = null, idempotencyKey = "" } = {}) {
  const token = accessToken();
  if (!token) {
    throw new MercadoPagoError("sem_credencial", "MERCADO_PAGO_ACCESS_TOKEN não configurado.");
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resposta;
  try {
    resposta = await fetch(`${BASE_URL}${caminho}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new MercadoPagoError("timeout", "O Mercado Pago demorou demais para responder.");
    }
    throw new MercadoPagoError("rede", "Não foi possível falar com o Mercado Pago.");
  } finally {
    clearTimeout(timer);
  }

  const texto = await resposta.text().catch(() => "");
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    // O corpo do erro pode trazer dado do pagador — nada dele vai para a
    // resposta da nossa API. Só diagnóstico seguro (códigos, nomes de
    // propriedade, request-id) é extraído e logado.
    const { mpCode, mpCauses, mpFields } = lerErroMp(dados);
    const mpRequestId = String(resposta.headers.get("x-request-id") || "").slice(0, 60);

    const erro = new MercadoPagoError(
      codeParaStatus(resposta.status),
      `Mercado Pago respondeu ${resposta.status}.`,
      {
        status: resposta.status,
        retryAfterSeconds: lerRetryAfter(resposta.headers.get("retry-after")),
        mpCode,
        mpCauses,
        mpFields,
        mpRequestId,
      }
    );
    console.warn(`[MercadoPago] ${method} ${caminho} recusado ${erro.diagnostico}`);
    throw erro;
  }

  if (!dados || typeof dados !== "object") {
    throw new MercadoPagoError("resposta_invalida", "Resposta inesperada do Mercado Pago.");
  }
  return dados;
}

/* ─── Orders ─────────────────────────────────────────────────────────── */

/**
 * Cria uma order na API de Orders (Checkout Transparente).
 *
 * O payload é o mínimo documentado — os mesmos campos que a cobrança Pix do
 * churrasco já usa em produção: `type`, `total_amount`, `external_reference`,
 * `processing_mode`, `transactions.payments` e `payer.email`. Nada mais.
 *
 * `notification_url` e `metadata` NÃO existem no corpo da API de Orders (a
 * notificação é configurada na aplicação, no tópico "Order"). Enviá-los
 * devolve 400 `unsupported_properties` — por isso não há como passá-los daqui.
 * O módulo é identificado pelo prefixo do `external_reference` (CHURRASCO- /
 * LOJA-), não por metadata.
 *
 * @param {object}   params
 * @param {string}   params.externalReference  - referência imutável (com prefixo do módulo)
 * @param {number}   params.totalAmountCents   - inteiro, calculado no servidor
 * @param {Array}    params.payments           - [{ amountCents, payment_method, expiration_time? }]
 * @param {string}   params.payerEmail         - e-mail do pagador (obrigatório)
 * @param {string}   params.idempotencyKey     - estável para a mesma tentativa
 * @param {string}   [params.processingMode]   - "automatic" por padrão
 */
export async function criarOrder({
  externalReference,
  totalAmountCents,
  payments,
  payerEmail,
  idempotencyKey,
  processingMode = "automatic",
}) {
  const payload = {
    type: "online",
    total_amount: centsToAmountString(totalAmountCents),
    external_reference: externalReference,
    processing_mode: processingMode,
    transactions: {
      payments: (payments || []).map((pagamento) => {
        const item = {
          amount: centsToAmountString(pagamento.amountCents),
          payment_method: pagamento.payment_method,
        };
        if (pagamento.expiration_time) item.expiration_time = pagamento.expiration_time;
        return item;
      }),
    },
    payer: { email: payerEmail },
  };

  return chamar("/v1/orders", { method: "POST", body: payload, idempotencyKey });
}

/**
 * Cria a order Pix do churrasco. Só existe um pagamento, e ele é sempre
 * `pix` / `bank_transfer` — não há caminho de código que produza cartão,
 * boleto ou parcelamento a partir daqui.
 *
 * @param {object}  params
 * @param {string}  params.externalReference - CHURRASCO-...
 * @param {number}  params.amountCents       - inteiro, calculado no servidor
 * @param {string}  params.payerEmail        - obrigatório no Pix
 * @param {string}  params.idempotencyKey    - estável para a mesma tentativa
 */
export async function criarOrderPix({
  externalReference,
  amountCents,
  payerEmail,
  idempotencyKey,
  expiracao = PIX_EXPIRACAO,
}) {
  return criarOrder({
    externalReference,
    totalAmountCents: amountCents,
    payerEmail,
    idempotencyKey,
    payments: [
      {
        amountCents,
        payment_method: {
          id: METODO_PERMITIDO,
          type: TIPO_METODO_PERMITIDO,
        },
        expiration_time: expiracao,
      },
    ],
  });
}

/** Consulta a order. É a única fonte de verdade sobre o pagamento. */
export async function consultarOrder(orderId) {
  const id = String(orderId || "").trim();
  if (!id) throw new MercadoPagoError("nao_encontrado", "Order sem identificador.");
  return chamar(`/v1/orders/${encodeURIComponent(id)}`);
}

/* ─── Leitura da resposta ────────────────────────────────────────────── */

/** O primeiro (e único) pagamento da order. */
export function primeiroPagamento(order) {
  const pagamentos = order?.transactions?.payments;
  return Array.isArray(pagamentos) && pagamentos.length ? pagamentos[0] : null;
}

/**
 * Extrai só os campos que o resto do sistema usa. O corpo cru morre aqui.
 *
 * A validade pode chegar em nomes diferentes conforme o meio; lemos os
 * candidatos conhecidos e ficamos com a primeira data ISO válida.
 */
export function lerOrder(order) {
  const pagamento = primeiroPagamento(order) || {};
  const metodo = pagamento.payment_method || {};

  const expiraEm = [
    metodo.expiration_date,
    metodo.date_of_expiration,
    pagamento.expiration_date,
    pagamento.date_of_expiration,
    order?.expiration_time,
  ].find((valor) => typeof valor === "string" && !Number.isNaN(Date.parse(valor)));

  const parcelas = Number(metodo.installments ?? pagamento.installments);

  return {
    orderId: order?.id ? String(order.id) : "",
    externalReference: order?.external_reference ? String(order.external_reference) : "",
    status: String(order?.status || ""),
    statusDetail: String(order?.status_detail || ""),
    totalAmountCents: amountToCents(order?.total_amount),

    paymentId: pagamento.id ? String(pagamento.id) : "",
    paymentStatus: String(pagamento.status || ""),
    paymentStatusDetail: String(pagamento.status_detail || ""),
    paymentAmountCents: amountToCents(pagamento.amount),
    paidAmountCents: amountToCents(pagamento.paid_amount ?? pagamento.amount),

    metodoId: String(metodo.id || "").toLowerCase(),
    metodoTipo: String(metodo.type || "").toLowerCase(),
    installments: Number.isInteger(parcelas) && parcelas > 0 ? parcelas : null,
    qrCode: typeof metodo.qr_code === "string" ? metodo.qr_code : "",
    qrCodeBase64: typeof metodo.qr_code_base64 === "string" ? metodo.qr_code_base64 : "",
    ticketUrl: /^https:\/\//i.test(metodo.ticket_url || "") ? String(metodo.ticket_url) : "",
    expiraEm: expiraEm || "",
  };
}

/* ─── Assinatura do webhook ──────────────────────────────────────────── */

function comparaSegura(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/** "ts=123,v1=abc" → { ts: "123", v1: "abc" } */
function partesDaAssinatura(xSignature) {
  const partes = {};
  for (const pedaco of String(xSignature || "").split(",")) {
    const igual = pedaco.indexOf("=");
    if (igual === -1) continue;
    const chave = pedaco.slice(0, igual).trim();
    const valor = pedaco.slice(igual + 1).trim();
    if (chave) partes[chave] = valor;
  }
  return partes;
}

/**
 * Valida `x-signature` conforme a documentação de notificações.
 *
 * Manifesto: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, com as partes
 * ausentes omitidas. IDs alfanuméricos entram em minúsculas — aceitamos as
 * duas grafias porque ambas exigem o mesmo segredo para serem forjadas.
 *
 * @returns {{ ok: boolean, motivo?: string }}
 */
export function validarAssinaturaWebhook({ xSignature, xRequestId, dataId }) {
  const segredo = webhookSecret();
  if (!segredo) return { ok: false, motivo: "segredo_ausente" };

  const { ts, v1 } = partesDaAssinatura(xSignature);
  if (!ts || !v1) return { ok: false, motivo: "assinatura_malformada" };
  if (!/^[0-9a-f]{64}$/i.test(v1)) return { ok: false, motivo: "assinatura_malformada" };

  const id = String(dataId || "");
  const requestId = String(xRequestId || "");

  const candidatos = new Set();
  for (const idUsado of [id, /^[a-z0-9]+$/i.test(id) ? id.toLowerCase() : id]) {
    let manifesto = "";
    if (idUsado) manifesto += `id:${idUsado};`;
    if (requestId) manifesto += `request-id:${requestId};`;
    manifesto += `ts:${ts};`;
    candidatos.add(manifesto);
  }

  for (const manifesto of candidatos) {
    const esperado = crypto.createHmac("sha256", segredo).update(manifesto).digest("hex");
    if (comparaSegura(esperado, v1.toLowerCase())) return { ok: true };
  }
  return { ok: false, motivo: "assinatura_invalida" };
}
