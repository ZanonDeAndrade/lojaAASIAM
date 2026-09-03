/**
 * Loja da AASIAM — checkout pago por cartão ou Pix no Checkout Transparente do
 * Mercado Pago (API de Orders).
 *
 * Rotas registradas aqui:
 *   POST /api/loja/checkout/quote            simula a cobrança (não cria nada)
 *   POST /api/loja/checkout                  cria o pedido e a cobrança
 *   GET  /api/loja/pedidos/:orderId/status   consulta o status (token)
 *   POST /api/loja/webhook/mercadopago       notificação do Mercado Pago
 *   GET  /api/loja/config                    o que o checkout precisa saber
 *
 * Princípios (os mesmos do churrasco):
 *  - o valor é SEMPRE reconstruído no servidor a partir do catálogo e da tabela
 *    de taxas; preço, subtotal, taxa, parcela ou total enviados pelo navegador
 *    são ignorados;
 *  - nada é dado como pago pelo corpo do webhook nem pelo navegador: o status
 *    vem de `GET /v1/orders/{id}`;
 *  - a planilha guarda uma linha por pedido, criada antes da cobrança e
 *    atualizada no lugar, com o snapshot financeiro congelado;
 *  - o número do cartão e o CVV nunca chegam aqui — só o `token` opaco gerado
 *    pelo MercadoPago.js no navegador;
 *  - respostas de erro são genéricas: nada de credencial, env ou stack.
 *
 * Compartilha com o churrasco apenas o cliente HTTP (`mercadopago.js`) e a
 * validação de assinatura do webhook. O prefixo da referência (`LOJA-`) e o
 * webhook próprio garantem que um pagamento do churrasco nunca toque um pedido
 * da loja e vice-versa.
 */
import crypto from "node:crypto";

import { apiBaseUrl } from "./infinitepay.js";
import { checkCoupon, marcarCupomUsado, aplicarPrecoCusto } from "./cupons.js";
import { clientIp, rateLimit } from "./rate-limit.js";
import { formatDateTime } from "./google-sheets.js";
import { calculateOrder, sanitizeSelection, validateSelection } from "./shared/order.js";
import {
  FeeError,
  METODO_CARTAO,
  METODO_PIX,
  opcoesDeParcelamento,
  simularCobranca,
  tabelaDeTaxas,
} from "./loja-fees.js";
import {
  LOJA_SHEET_NAME,
  atualizarPedido,
  criarPedidoPendente,
  findPedido,
  isLojaSheetConfigured,
} from "./loja-pedidos.js";
import {
  MercadoPagoError,
  ambienteMercadoPago,
  consultarOrder,
  criarOrder,
  isMercadoPagoConfigured,
  isWebhookSecretConfigured,
  lerOrder,
  validarAssinaturaWebhook,
} from "./mercadopago.js";
import {
  PIX_EXPIRACAO,
  PIX_EXPIRACAO_MINUTOS,
  STATUS_CANCELADO,
  STATUS_ERRO,
  STATUS_FALHOU,
  STATUS_PAGO,
  STATUS_PENDENTE,
  STATUS_PROCESSANDO,
  STATUS_REEMBOLSADO,
  STATUS_REVISAO,
  formatBRL,
  isStatusFinal,
  maskEmail,
  statusFromMercadoPago,
  statusLabel,
} from "./shared/churrasco.js";

/** Prefixo da referência externa — é o que separa a loja do churrasco. */
export const ORDER_PREFIX = "LOJA-";
export const LOJA_WEBHOOK_PATH = "/api/loja/webhook/mercadopago";
export { LOJA_SHEET_NAME };

/** Meio do pagamento no metadata da order. */
const SOURCE = "ecommerce";

/** O Mercado Pago só aceita `notification_url` HTTPS. Em dev (localhost) a
 *  confirmação vem pelo polling do navegador — a order é criada sem webhook. */
function notificationUrl() {
  const url = `${apiBaseUrl()}${LOJA_WEBHOOK_PATH}`;
  return url.startsWith("https://") ? url : undefined;
}

/* ─── Segredo (mesma cadeia de fallback do churrasco) ─────────────────── */

function segredo() {
  return (
    process.env.CHURRASCO_TOKEN_SECRET ||
    process.env.MERCADO_PAGO_WEBHOOK_SECRET ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 ||
    ""
  );
}

/* ─── Referência, token e idempotência ───────────────────────────────────
   Tudo é derivado do `attemptId` que o navegador manda: a MESMA tentativa
   (duplo clique, retry após timeout, restart do backend) recai sobre o mesmo
   pedido, a mesma linha da planilha e a mesma chave de idempotência do
   Mercado Pago — nunca vira uma segunda cobrança. Uma tentativa nova e
   deliberada (depois de um cartão recusado) usa um `attemptId` novo. */

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I

function anoSaoPaulo(now = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(now);
}

/** `LOJA-2026-A7F9K2M4` — determinístico a partir do attemptId. */
export function orderIdDeTentativa(attemptId) {
  const digest = crypto
    .createHmac("sha256", `loja-order:${segredo()}`)
    .update(String(attemptId))
    .digest();
  let sufixo = "";
  for (let i = 0; i < 8; i += 1) sufixo += ALFABETO[digest[i] % ALFABETO.length];
  return `${ORDER_PREFIX}${anoSaoPaulo()}-${sufixo}`;
}

export function isLojaOrder(orderId) {
  return String(orderId || "").startsWith(ORDER_PREFIX);
}

/** Token público de consulta do pedido, derivado da referência por HMAC. */
export function pedidoToken(orderId) {
  return crypto
    .createHmac("sha256", `loja-token:${segredo()}`)
    .update(String(orderId))
    .digest("base64url")
    .slice(0, 32);
}

function tokenConfere(orderId, candidato) {
  const esperado = Buffer.from(pedidoToken(orderId));
  const recebido = Buffer.from(String(candidato || ""));
  if (esperado.length !== recebido.length) return false;
  return crypto.timingSafeEqual(esperado, recebido);
}

/** Chave de idempotência da criação da order (≤ 64 chars, [A-Za-z0-9-]). */
export function chaveIdempotencia(orderId) {
  return crypto
    .createHmac("sha256", `loja-idem:${segredo()}`)
    .update(String(orderId))
    .digest("hex")
    .slice(0, 48);
}

/* ─── Validação da entrada ───────────────────────────────────────────── */

function limpar(texto, max) {
  return String(texto || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Devolve `{ error }` ou `{ data }`. Nenhum valor financeiro é lido daqui. */
export function parseCliente(body) {
  const nome = limpar(body?.name, 120);
  const email = limpar(body?.email, 120).toLowerCase();
  const telefone = limpar(body?.phone, 30);

  if (nome.split(" ").filter(Boolean).length < 2) {
    return { error: "Informe nome e sobrenome.", field: "name" };
  }
  if (!EMAIL_RE.test(email)) {
    return { error: "E-mail inválido — confira o endereço.", field: "email" };
  }
  if (telefone.replace(/\D/g, "").length < 10) {
    return { error: "Telefone incompleto — inclua o DDD.", field: "phone" };
  }

  const [primeiro, ...resto] = nome.split(" ");
  return {
    data: { nome, email, telefone, primeiroNome: primeiro, sobrenome: resto.join(" ") },
  };
}

/** Só cartão e Pix. Token/paymentMethodId só quando cartão. */
export function parsePagamento(body) {
  const metodo = String(body?.paymentMethod || "").trim();

  if (metodo === METODO_PIX) return { data: { metodo: METODO_PIX, installments: 1 } };

  if (metodo === METODO_CARTAO) {
    const token = limpar(body?.cardToken, 64);
    const paymentMethodId = limpar(body?.paymentMethodId, 40).toLowerCase();
    const installments = Math.trunc(Number(body?.installments) || 0);

    if (!/^[a-f0-9]{16,64}$/i.test(token)) {
      return { error: "Não foi possível ler os dados do cartão. Tente de novo.", field: "cardToken" };
    }
    if (!/^[a-z0-9_-]{2,40}$/.test(paymentMethodId)) {
      return { error: "Cartão não reconhecido.", field: "paymentMethodId" };
    }
    if (installments < 1) {
      return { error: "Selecione o número de parcelas.", field: "installments" };
    }
    return { data: { metodo: METODO_CARTAO, token, paymentMethodId, installments } };
  }

  return { error: "Selecione uma forma de pagamento.", field: "paymentMethod" };
}

/**
 * Reconstrói o pedido a partir da seleção: preços reais do catálogo, cupom
 * revalidado no servidor. Devolve `{ error }` ou `{ order, cupom, resumoItens }`.
 */
function reconstruirPedido(body) {
  const validation = validateSelection(body?.selection);
  if (validation) return validation;

  const selection = sanitizeSelection(body?.selection);
  const order = calculateOrder(selection);

  if (order.lines.length === 0) {
    return { error: "Selecione pelo menos um produto disponível.", field: "selection" };
  }

  const cupomBruto = limpar(body?.cupom, 60);
  const cupomValido = cupomBruto ? checkCoupon(cupomBruto).valido : false;
  if (cupomValido) aplicarPrecoCusto(order);

  const resumoItens = order.lines
    .map(
      (line) =>
        `${line.quantity}x ${line.productName}${line.variant ? ` (${line.variant})` : ""} — ` +
        `${formatBRL(line.unitPriceCents)} un.`
    )
    .join(" · ");

  const shirtSizes = order.lines
    .filter((line) => line.shirtSize || line.size)
    .map((line) => `${line.quantity}x ${line.productName}: ${line.shirtSize || line.size}`)
    .join(" · ");
  const shortsSizes = order.lines
    .filter((line) => line.shortsSize)
    .map((line) => `${line.quantity}x ${line.productName}: ${line.shortsSize}`)
    .join(" · ");

  return {
    order,
    cupom: cupomValido ? cupomBruto : null,
    resumoItens,
    shirtSizes,
    shortsSizes,
  };
}

/* ─── Leitura da order ───────────────────────────────────────────────── */

const ORDER_TTL_MS = 4000;
const orderCache = new Map();

async function buscarOrder(orderMpId, { fresh = false } = {}) {
  if (!fresh) {
    const guardada = orderCache.get(orderMpId);
    if (guardada && Date.now() - guardada.at < ORDER_TTL_MS) return guardada.order;
  }
  const order = await consultarOrder(orderMpId);
  orderCache.set(orderMpId, { at: Date.now(), order });
  if (orderCache.size > 500) {
    for (const [chave, valor] of orderCache) {
      if (Date.now() - valor.at > ORDER_TTL_MS) orderCache.delete(chave);
    }
  }
  return order;
}

/**
 * Transforma a order lida no Mercado Pago em mudanças para a linha do pedido.
 * Única função que traduz a resposta oficial — usada pelo webhook e pela
 * consulta, para que as duas cheguem à mesma conclusão.
 */
export function avaliarOrder(pedido, leitura) {
  const base = {
    orderMpId: leitura.orderId || pedido.orderMpId,
    paymentMpId: leitura.paymentId || pedido.paymentMpId,
    statusMp: [leitura.status, leitura.statusDetail].filter(Boolean).join(" / "),
  };

  const status = statusFromMercadoPago(leitura.status, leitura.statusDetail);

  // O cartão recusado chega como pagamento "rejected" antes de a order virar
  // "failed" — tratamos os dois como falha, sem cobrança.
  const recusado = leitura.paymentStatus === "rejected" || status === STATUS_FALHOU;

  // Comparação em centavos inteiros contra o total CONGELADO no pedido.
  const esperado = pedido.totalChargedCents;
  const daOrder = leitura.totalAmountCents;
  const pago = leitura.paidAmountCents;
  const divergente =
    Number.isInteger(esperado) &&
    ((Number.isInteger(daOrder) && daOrder !== esperado) ||
      (status === STATUS_PAGO && Number.isInteger(pago) && pago !== esperado));

  if (divergente) {
    return {
      ...base,
      status: STATUS_REVISAO,
      observacoes:
        `Valor da cobrança (${formatBRL(daOrder ?? 0)}) ou pago (${formatBRL(pago ?? 0)}) ` +
        `diferente do total do pedido (${formatBRL(esperado ?? 0)}).`,
    };
  }

  if (recusado) return { ...base, status: STATUS_FALHOU };

  if (status === STATUS_PAGO) {
    const transacaoOk =
      leitura.paymentStatus === "processed" && leitura.paymentStatusDetail === "accredited";
    if (!transacaoOk) return { ...base, status: STATUS_PROCESSANDO };
    return { ...base, status: STATUS_PAGO, pagoEm: pedido.pagoEm || formatDateTime() };
  }

  if (status === STATUS_REEMBOLSADO) return { ...base, status: STATUS_REEMBOLSADO };
  if (status === STATUS_CANCELADO) return { ...base, status: STATUS_CANCELADO };
  if (status === STATUS_REVISAO) return { ...base, status: STATUS_REVISAO };

  return { ...base, status };
}

async function aplicarOrder(pedido, leitura, origem) {
  const mudancas = avaliarOrder(pedido, leitura);
  const { pedido: atualizado, gravou } = await atualizarPedido(pedido.id, mudancas);
  const resultado = atualizado || { ...pedido, ...mudancas };

  if (gravou && resultado.status === STATUS_PAGO && pedido.status !== STATUS_PAGO) {
    console.log(
      `[Loja/${origem}] ${pedido.id} pago (${resultado.paymentMethod}, ${resultado.installments}x, ` +
        `${formatBRL(resultado.totalChargedCents)}, order ${resultado.orderMpId}).`
    );
    if (pedido.cupom) marcarCupomUsado(pedido.cupom, pedido.id);
  }
  if (gravou && resultado.status === STATUS_REVISAO && pedido.status !== STATUS_REVISAO) {
    console.warn(`[Loja/${origem}] ${pedido.id} marcado para revisão manual.`);
  }
  return resultado;
}

/* ─── Projeção pública ───────────────────────────────────────────────── */

function pedidoView(pedido, leitura = null) {
  const pendente = pedido.status === STATUS_PENDENTE;
  const pix =
    leitura && pendente && (leitura.qrCode || leitura.qrCodeBase64)
      ? {
          qrCode: leitura.qrCode || "",
          qrCodeBase64: leitura.qrCodeBase64 || "",
          mimeType: "image/png",
          expiraEm: leitura.expiraEm || "",
        }
      : null;

  return {
    ok: true,
    orderId: pedido.id,
    status: pedido.status,
    statusLabel: statusLabel(pedido.status),
    paid: pedido.status === STATUS_PAGO,
    final: isStatusFinal(pedido.status),
    paymentMethod: pedido.paymentMethod,
    installments: pedido.installments,
    itens: pedido.itens,
    subtotalCents: pedido.subtotalCents,
    subtotal: formatBRL(pedido.subtotalCents),
    paymentFeeCents: pedido.paymentFeeCents,
    paymentFee: formatBRL(pedido.paymentFeeCents),
    feeBps: pedido.feeBps,
    totalCents: pedido.totalChargedCents,
    total: formatBRL(pedido.totalChargedCents),
    receiptUrl: leitura?.ticketUrl || null,
    pagoEm: pedido.pagoEm || null,
    pix,
  };
}

/* ─── Rate limits ────────────────────────────────────────────────────── */

const quoteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 300,
  message: "Muitas simulações seguidas. Aguarde um instante.",
  keyFrom: clientIp,
});
const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: "Muitas tentativas de pagamento seguidas. Aguarde alguns minutos.",
  keyFrom: clientIp,
});
const statusPorPedidoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 400,
  message: "Muitas consultas seguidas. Aguarde um instante.",
  keyFrom: (req) => `loja-pedido:${req.params.orderId}`,
});
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 600, message: "too many requests" });

/* ─── Trava lógica em processo (duplo clique) ────────────────────────── */

const emAndamento = new Map();
function comTravaLogica(chave, trabalho) {
  const anterior = emAndamento.get(chave);
  if (anterior) return anterior;
  const atual = trabalho().finally(() => {
    if (emAndamento.get(chave) === atual) emAndamento.delete(chave);
  });
  emAndamento.set(chave, atual);
  return atual;
}

/* ─── Erros ──────────────────────────────────────────────────────────── */

function indisponivel(res, motivo) {
  console.error(`[Loja] indisponível: ${motivo}`);
  return res.status(503).json({
    ok: false,
    error: "O pagamento está temporariamente indisponível. Tente novamente em instantes.",
  });
}

function respostaDeErroMp(res, err) {
  const codigo = err instanceof MercadoPagoError ? err.code : "erro";
  if (codigo === "rate_limit") {
    if (err.retryAfterSeconds) res.setHeader("Retry-After", String(err.retryAfterSeconds));
    return res.status(429).json({ ok: false, error: "Muitas cobranças ao mesmo tempo. Aguarde e tente de novo." });
  }
  if (codigo === "sem_credencial" || codigo === "credencial_invalida") {
    return indisponivel(res, `credencial do Mercado Pago recusada (${codigo})`);
  }
  if (codigo === "requisicao_invalida") {
    return res.status(422).json({
      ok: false,
      error: "O pagamento foi recusado. Confira os dados do cartão e tente novamente.",
    });
  }
  return res.status(502).json({
    ok: false,
    error: "Não foi possível concluir o pagamento agora. Tente novamente em instantes.",
  });
}

/* ─── Rotas ──────────────────────────────────────────────────────────── */

export function registerLojaRoutes(app) {
  /** O que o checkout precisa antes de montar o formulário. */
  app.get("/api/loja/config", (_req, res) => {
    res.json({
      pagamentoDisponivel: isMercadoPagoConfigured() && isLojaSheetConfigured(),
      publicKey: process.env.MERCADO_PAGO_PUBLIC_KEY || "",
      ambiente: ambienteMercadoPago(),
      parcelasCartao: tabelaDeTaxas().parcelasCartao,
      pixHabilitado: true,
      pixExpiracaoMinutos: PIX_EXPIRACAO_MINUTOS,
      webhookConfigurado: isWebhookSecretConfigured(),
    });
  });

  /**
   * Simulação — não cria pedido nem cobrança. Reconstrói o subtotal do
   * catálogo, aplica a taxa da tabela do servidor e devolve os números que o
   * checkout mostra ANTES de pagar.
   */
  app.post("/api/loja/checkout/quote", quoteLimiter, (req, res) => {
    const reconstruido = reconstruirPedido(req.body);
    if (reconstruido.error) {
      return res.status(400).json({ ok: false, error: reconstruido.error, field: reconstruido.field });
    }

    const subtotalCents = reconstruido.order.totalCents;
    const metodo = String(req.body?.paymentMethod || METODO_CARTAO);

    try {
      if (metodo === METODO_PIX) {
        const pix = simularCobranca({ subtotalCents, paymentMethod: METODO_PIX });
        return res.json({ ok: true, subtotalCents, cupomAplicado: Boolean(reconstruido.cupom), pix, cartao: null });
      }

      const installments = Math.trunc(Number(req.body?.installments) || 1);
      const cartao = simularCobranca({ subtotalCents, paymentMethod: METODO_CARTAO, installments });
      return res.json({
        ok: true,
        subtotalCents,
        cupomAplicado: Boolean(reconstruido.cupom),
        cartao,
        opcoes: opcoesDeParcelamento(subtotalCents),
      });
    } catch (err) {
      if (err instanceof FeeError) {
        return res.status(400).json({ ok: false, error: err.message, code: err.code });
      }
      console.error("[Loja/Quote] erro:", err?.message || err);
      return res.status(500).json({ ok: false, error: "Não foi possível simular o pagamento." });
    }
  });

  /**
   * Cria o pedido e a cobrança. O `attemptId` do navegador torna a operação
   * idempotente: o mesmo attemptId sempre recai sobre o mesmo pedido e a mesma
   * cobrança.
   */
  app.post("/api/loja/checkout", checkoutLimiter, async (req, res) => {
    if (!isMercadoPagoConfigured()) return indisponivel(res, "MERCADO_PAGO_ACCESS_TOKEN ausente");
    if (!isLojaSheetConfigured()) return indisponivel(res, "Google Sheets não configurado");

    const attemptId = limpar(req.body?.attemptId, 80);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(attemptId)) {
      return res.status(400).json({ ok: false, error: "Requisição inválida.", field: "attemptId" });
    }

    const cliente = parseCliente(req.body?.customer);
    if (cliente.error) return res.status(400).json({ ok: false, error: cliente.error, field: cliente.field });

    const pagamento = parsePagamento(req.body);
    if (pagamento.error) return res.status(400).json({ ok: false, error: pagamento.error, field: pagamento.field });

    const reconstruido = reconstruirPedido(req.body);
    if (reconstruido.error) {
      return res.status(400).json({ ok: false, error: reconstruido.error, field: reconstruido.field });
    }

    const subtotalCents = reconstruido.order.totalCents;

    let cobranca;
    try {
      cobranca = simularCobranca({
        subtotalCents,
        paymentMethod: pagamento.data.metodo,
        installments: pagamento.data.installments,
      });
    } catch (err) {
      if (err instanceof FeeError) {
        return res.status(400).json({ ok: false, error: err.message, code: err.code });
      }
      throw err;
    }

    const orderId = orderIdDeTentativa(attemptId);

    try {
      const resultado = await comTravaLogica(attemptId, async () => {
        // Linha pendente ANTES da cobrança — o webhook sempre tem onde escrever.
        // Se o attemptId repetir, a linha já existe e é reaproveitada.
        const existentePlanilha = await criarPedidoPendente({
          id: orderId,
          nome: cliente.data.nome,
          telefone: cliente.data.telefone,
          email: cliente.data.email,
          itens: reconstruido.resumoItens,
          shirtSizes: reconstruido.shirtSizes,
          shortsSizes: reconstruido.shortsSizes,
          subtotalCents,
          paymentMethod: cobranca.paymentMethod,
          installments: cobranca.installments,
          feeBps: cobranca.feeBps,
          paymentFeeCents: cobranca.paymentFeeCents,
          totalChargedCents: cobranca.totalCents,
        });
        const pedido = { ...existentePlanilha, cupom: reconstruido.cupom };

        // Já resolvido numa tentativa anterior com o mesmo attemptId.
        if (pedido.orderMpId && isStatusFinal(pedido.status)) {
          const leitura = lerOrder(await buscarOrder(pedido.orderMpId, { fresh: true }));
          return { pedido: await aplicarOrder(pedido, leitura, "Checkout"), leitura };
        }

        const payments =
          pagamento.data.metodo === METODO_PIX
            ? [
                {
                  amountCents: cobranca.totalCents,
                  payment_method: { id: "pix", type: "bank_transfer" },
                  expiration_time: PIX_EXPIRACAO,
                },
              ]
            : [
                {
                  amountCents: cobranca.totalCents,
                  payment_method: {
                    id: pagamento.data.paymentMethodId,
                    type: "credit_card",
                    token: pagamento.data.token,
                    installments: cobranca.installments,
                  },
                },
              ];

        const order = await criarOrder({
          externalReference: orderId,
          totalAmountCents: cobranca.totalCents,
          payments,
          payer: {
            email: cliente.data.email,
            first_name: cliente.data.primeiroNome,
            last_name: cliente.data.sobrenome || cliente.data.primeiroNome,
          },
          metadata: { source: SOURCE, order_id: orderId },
          notificationUrl: notificationUrl(),
          idempotencyKey: chaveIdempotencia(orderId),
        });

        let leitura = lerOrder(order);

        // Pix pode nascer sem QR (processamento assíncrono); uma segunda leitura
        // costuma resolver, e a tela continua consultando se não vier.
        if (
          pagamento.data.metodo === METODO_PIX &&
          !leitura.qrCode &&
          !leitura.qrCodeBase64 &&
          leitura.orderId
        ) {
          await new Promise((r) => setTimeout(r, 900));
          try {
            leitura = lerOrder(await buscarOrder(leitura.orderId, { fresh: true }));
          } catch {
            /* mantém a primeira leitura */
          }
        }

        return { pedido: await aplicarOrder(pedido, leitura, "Checkout"), leitura };
      });

      const view = pedidoView(resultado.pedido, resultado.leitura);
      return res.status(201).json({
        ...view,
        token: pedidoToken(orderId),
        gerandoPix:
          pagamento.data.metodo === METODO_PIX &&
          resultado.pedido.status === STATUS_PENDENTE &&
          !view.pix,
      });
    } catch (err) {
      if (err instanceof MercadoPagoError) {
        console.error(`[Loja] Mercado Pago recusou a cobrança: ${err.code} (${err.status}).`);
        await findPedido(orderId, { fresh: true })
          .then((pedido) =>
            pedido && pedido.status === STATUS_PENDENTE && !pedido.orderMpId
              ? atualizarPedido(orderId, {
                  status: STATUS_ERRO,
                  observacoes: "Falha ao criar a cobrança no Mercado Pago.",
                })
              : null
          )
          .catch(() => {});
        return respostaDeErroMp(res, err);
      }
      if (err?.code === "sheets_not_configured") return indisponivel(res, "Google Sheets não configurado");
      console.error(`[Loja] falha no checkout de ${maskEmail(cliente.data?.email)}:`, err?.message || err);
      return res.status(502).json({
        ok: false,
        error: "Não foi possível concluir o pagamento. Verifique sua conexão e tente novamente.",
      });
    }
  });

  /** Status do pedido — exige o token derivado da própria referência. */
  app.get("/api/loja/pedidos/:orderId/status", statusPorPedidoLimiter, async (req, res) => {
    const orderId = String(req.params.orderId || "").slice(0, 60);
    const token = req.get("X-Pedido-Token") || String(req.query.token || "");

    if (!isLojaOrder(orderId) || !tokenConfere(orderId, token)) {
      return res.status(404).json({ ok: false, error: "Pedido não encontrado." });
    }

    try {
      const pedido = await findPedido(orderId);
      if (!pedido) return res.status(404).json({ ok: false, error: "Pedido não encontrado." });

      if (isStatusFinal(pedido.status) || !pedido.orderMpId) {
        return res.json(pedidoView(pedido));
      }

      const leitura = lerOrder(await buscarOrder(pedido.orderMpId));
      const atualizado = await aplicarOrder(pedido, leitura, "Status");
      return res.json(pedidoView(atualizado, leitura));
    } catch (err) {
      if (err instanceof MercadoPagoError) {
        console.error(`[Loja] consulta ao Mercado Pago falhou: ${err.code}.`);
      } else {
        console.error("[Loja] falha ao consultar o status:", err?.message || err);
      }
      return res.status(502).json({
        ok: false,
        error: "Não foi possível verificar o pagamento agora. Tentaremos de novo em instantes.",
      });
    }
  });

  /**
   * Webhook do Mercado Pago — evento `order`.
   *
   * O corpo é só um aviso: o status vem de `GET /v1/orders/{id}`. Notificações
   * do churrasco, de outro sistema ou de uma order sem o prefixo `LOJA-` são
   * ignoradas com 200, sem tocar nada.
   */
  app.post(LOJA_WEBHOOK_PATH, webhookLimiter, async (req, res) => {
    const body = req.body || {};
    const dataId = String(body?.data?.id || body?.id || "").slice(0, 80);

    const assinatura = validarAssinaturaWebhook({
      xSignature: req.get("x-signature"),
      xRequestId: req.get("x-request-id"),
      dataId,
    });
    if (!assinatura.ok) {
      console.warn(`[Loja/Webhook] assinatura recusada (${assinatura.motivo}).`);
      return res.status(401).json({ ok: false });
    }

    const topico = String(body.type || body.topic || body.action || "").toLowerCase();
    if (!topico.includes("order")) return res.status(200).json({ ok: true, ignorado: "topico" });
    if (!dataId) return res.status(200).json({ ok: true, ignorado: "sem_id" });

    try {
      const leitura = lerOrder(await buscarOrder(dataId, { fresh: true }));
      const referencia = leitura.externalReference;

      if (!isLojaOrder(referencia)) {
        console.log("[Loja/Webhook] referência fora da loja — ignorada.");
        return res.status(200).json({ ok: true, ignorado: "referencia" });
      }

      const pedido = await findPedido(referencia, { fresh: true });
      if (!pedido) {
        console.warn(`[Loja/Webhook] ${referencia} não está na planilha — ignorado.`);
        return res.status(200).json({ ok: true, ignorado: "desconhecido" });
      }

      if (pedido.orderMpId && leitura.orderId && pedido.orderMpId !== leitura.orderId) {
        console.warn(`[Loja/Webhook] ${referencia} aponta para outra order — ignorado.`);
        return res.status(200).json({ ok: true, ignorado: "order_divergente" });
      }

      await aplicarOrder(pedido, leitura, "Webhook");
      return res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof MercadoPagoError && err.code === "nao_encontrado") {
        return res.status(200).json({ ok: true, ignorado: "order_inexistente" });
      }
      const motivo = err instanceof MercadoPagoError ? err.code : "planilha";
      console.error(`[Loja/Webhook] erro ao processar (${motivo}).`);
      return res.status(500).json({ ok: false });
    }
  });
}
