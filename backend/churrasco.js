/**
 * Churrasco da Alcateia — inscrição paga por Pix no Checkout Transparente do
 * Mercado Pago (API de Orders). A loja continua na InfinitePay; nada deste
 * arquivo é importado pelo checkout do e-commerce.
 *
 * Rotas registradas aqui:
 *   POST /api/churrasco/checkout                    cria a cobrança Pix
 *   GET  /api/churrasco/pagamentos/:orderId/status  consulta o status (token)
 *   POST /api/churrasco/webhook/mercadopago         notificação do Mercado Pago
 *   GET  /api/churrasco/config                      o que a página precisa saber
 *
 * Princípios que valem para todas elas:
 *  - o valor é SEMPRE recalculado a partir do curso; preço, status ou ID
 *    enviados pelo navegador são ignorados;
 *  - nenhuma confirmação vem do corpo do webhook nem do navegador: o pagamento
 *    só é dado como pago depois de consultar `GET /v1/orders/{id}`;
 *  - a planilha guarda uma linha por inscrição, criada antes da cobrança e
 *    atualizada no lugar — o `orderCache` da loja não é usado aqui, porque ele
 *    some quando o Render reinicia;
 *  - as respostas de erro são genéricas: nada de credencial, env ou stack.
 */
import crypto from "node:crypto";

import { formatDateTime } from "./google-sheets.js";
import { clientIp, rateLimit } from "./rate-limit.js";
import {
  CHURRASCO_SHEET_NAME,
  atualizarInscricao,
  criarInscricaoPendente,
  findInscricao,
  findInscricaoPorPessoa,
  isChurrascoSheetConfigured,
} from "./churrasco-inscricoes.js";
import {
  gerarComprovantePdf,
  isComprovanteSecretConfigured,
  lerTokenVerificacao,
  nomeArquivoComprovante,
  podeEmitirComprovante,
  validacaoView,
} from "./comprovante.js";
import {
  MercadoPagoError,
  ambienteMercadoPago,
  consultarOrder,
  criarOrderPix,
  isMercadoPagoConfigured,
  isWebhookSecretConfigured,
  lerOrder,
  validarAssinaturaWebhook,
} from "./mercadopago.js";
import {
  METODO_PERMITIDO,
  PIX_EXPIRACAO_MINUTOS,
  PROVEDOR,
  STATUS_ERRO,
  STATUS_PAGO,
  STATUS_PENDENTE,
  STATUS_PROCESSANDO,
  STATUS_REEMBOLSADO,
  STATUS_REVISAO,
  TIPO_METODO_PERMITIDO,
  categoryForCourse,
  formatBRL,
  isStatusFinal,
  maskEmail,
  normalizeCourse,
  normalizeEmail,
  normalizeFullName,
  normalizePhoneDigits,
  podeGerarNovoPix,
  priceCentsForCourse,
  statusFromMercadoPago,
  statusLabel,
  validateEmail,
  validateFullName,
  validatePhone,
} from "./shared/churrasco.js";

/** Prefixo da referência externa — é o que separa o churrasco da loja. */
export const ORDER_PREFIX = "CHURRASCO-";

export const CHURRASCO_WEBHOOK_PATH = "/api/churrasco/webhook/mercadopago";

export { CHURRASCO_SHEET_NAME };

/* ─── Referência e token da inscrição ────────────────────────────────── */

/** CHURRASCO-2026-A7F9K2M4 — prefixo, ano de São Paulo e 8 caracteres sorteados. */
export function createOrderNsu(now = new Date()) {
  const year = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).format(now);

  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I
  let suffix = "";
  for (const byte of crypto.randomBytes(8)) suffix += ALPHABET[byte % ALPHABET.length];

  return `${ORDER_PREFIX}${year}-${suffix}`;
}

export function isChurrascoOrder(orderId) {
  return String(orderId || "").startsWith(ORDER_PREFIX);
}

/**
 * Token público de consulta, derivado da referência por HMAC.
 *
 * A referência já é sorteada, então o HMAC é tão imprevisível quanto um token
 * aleatório — e, por não precisar ser guardado, continua valendo depois de um
 * restart do backend, sem ocupar coluna na planilha.
 */
function tokenSecret() {
  return (
    process.env.CHURRASCO_TOKEN_SECRET ||
    process.env.MERCADO_PAGO_WEBHOOK_SECRET ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 ||
    ""
  );
}

export function inscricaoToken(orderId) {
  return crypto
    .createHmac("sha256", `churrasco-token:${tokenSecret()}`)
    .update(String(orderId))
    .digest("base64url")
    .slice(0, 32);
}

function tokenConfere(orderId, candidato) {
  const esperado = Buffer.from(inscricaoToken(orderId));
  const recebido = Buffer.from(String(candidato || ""));
  if (esperado.length !== recebido.length) return false;
  return crypto.timingSafeEqual(esperado, recebido);
}

/**
 * Chave de idempotência da criação da order.
 *
 * Estável para a mesma tentativa lógica: enquanto a inscrição estiver
 * apontando para a mesma order (ou para nenhuma), a chave não muda — um duplo
 * clique, um retry após timeout ou um restart do backend recaem sobre ela e o
 * Mercado Pago devolve a MESMA cobrança em vez de criar outra. Ela só muda
 * quando o Pix anterior morre e a pessoa pede um novo, que é exatamente
 * quando uma cobrança nova é desejada.
 */
export function chaveIdempotencia(referencia, orderAnterior = "") {
  return crypto
    .createHmac("sha256", `churrasco-idem:${tokenSecret()}`)
    .update(`${referencia}:${orderAnterior || "primeira"}`)
    .digest("hex")
    .slice(0, 48);
}

/* ─── Validação da entrada ───────────────────────────────────────────── */

/**
 * Valida o corpo do POST. Devolve `{ error, field }` ou `{ data }`.
 * Qualquer valor financeiro, status ou ID enviado pelo navegador é ignorado
 * de propósito: o objeto devolvido é montado só com campos calculados aqui.
 */
export function parseInscricao(body) {
  const nameError = validateFullName(body?.name);
  if (nameError) return { error: nameError, field: "name" };

  const phoneError = validatePhone(body?.phone);
  if (phoneError) return { error: phoneError, field: "phone" };

  const emailError = validateEmail(body?.email);
  if (emailError) return { error: emailError, field: "email" };

  const curso = normalizeCourse(body?.course);
  if (!curso) return { error: "Selecione um curso da lista.", field: "course" };

  return {
    data: {
      nome: normalizeFullName(body.name),
      telefone: normalizePhoneDigits(body.phone),
      email: normalizeEmail(body.email),
      curso,
      categoria: categoryForCourse(curso),
      valorCents: priceCentsForCourse(curso), // recalculado no servidor
    },
  };
}

/** Telefone em log vira "(55) *****-4321" — nunca o número inteiro. */
function telefoneMascarado(digits) {
  const d = String(digits || "");
  if (d.length < 4) return "***";
  return `(${d.slice(0, 2)}) *****-${d.slice(-4)}`;
}

/* ─── Leitura da order ───────────────────────────────────────────────── */

/* Uma aba aberta consulta a cada 7s. Sem esta janela curta, cada consulta
   viraria uma chamada à API do Mercado Pago. O webhook nunca usa o cache: ele
   é a notificação de que algo mudou. */
const ORDER_TTL_MS = 4000;
const orderCache = new Map(); // orderMpId → { at, order }

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

function rotuloMetodo(metodoId) {
  if (!metodoId) return "";
  return metodoId === METODO_PERMITIDO ? "Pix" : metodoId;
}

/**
 * Decide o que gravar na linha a partir da order lida no Mercado Pago.
 *
 * É a única função que transforma a resposta oficial em status da inscrição —
 * usada tanto pelo webhook quanto pela consulta do navegador, para que as duas
 * cheguem exatamente à mesma conclusão.
 */
export function avaliarOrder(inscricao, leitura) {
  const base = {
    orderMpId: leitura.orderId || inscricao.orderMpId,
    paymentMpId: leitura.paymentId || inscricao.paymentMpId,
    metodo: rotuloMetodo(leitura.metodoId) || inscricao.metodo,
    statusMp: [leitura.status, leitura.statusDetail].filter(Boolean).join(" / "),
    ticketUrl: leitura.ticketUrl || inscricao.ticketUrl,
    expiraEm: leitura.expiraEm || inscricao.expiraEm,
  };

  const status = statusFromMercadoPago(leitura.status, leitura.statusDetail);

  /* Pagou por um meio que a inscrição não aceita. Não confirmamos nem
     ignoramos: alguém precisa olhar — e não há estorno automático. */
  if (
    leitura.metodoId &&
    (leitura.metodoId !== METODO_PERMITIDO || leitura.metodoTipo !== TIPO_METODO_PERMITIDO)
  ) {
    return {
      ...base,
      status: STATUS_REVISAO,
      observacoes:
        `Pagamento por "${leitura.metodoId}/${leitura.metodoTipo || "?"}", fora do Pix. ` +
        `Conferir no painel do Mercado Pago.`,
    };
  }

  // Comparação em centavos inteiros: o decimal da API nunca vira float.
  const esperado = inscricao.valorCents;
  const daOrder = leitura.totalAmountCents;
  const pago = leitura.paidAmountCents;

  const divergente =
    (Number.isInteger(daOrder) && daOrder !== esperado) ||
    (status === STATUS_PAGO && Number.isInteger(pago) && pago !== esperado);

  if (divergente) {
    return {
      ...base,
      status: STATUS_REVISAO,
      valorPagoCents: Number.isInteger(pago) ? pago : null,
      observacoes:
        `Valor da cobrança (${formatBRL(daOrder ?? 0)}) ou do pagamento ` +
        `(${formatBRL(pago ?? 0)}) diferente do valor do curso (${formatBRL(esperado)}).`,
    };
  }

  if (status === STATUS_PAGO) {
    // A order pode estar processada com a transação Pix ainda em trânsito.
    const transacaoOk =
      leitura.paymentStatus === "processed" && leitura.paymentStatusDetail === "accredited";
    if (!transacaoOk) return { ...base, status: STATUS_PROCESSANDO };

    return {
      ...base,
      status: STATUS_PAGO,
      valorPagoCents: Number.isInteger(pago) ? pago : esperado,
      pagoEm: inscricao.pagoEm || formatDateTime(),
    };
  }

  return { ...base, status };
}

/** Aplica a order na linha da planilha. Devolve a inscrição já atualizada. */
async function aplicarOrder(inscricao, leitura, origem) {
  const mudancas = avaliarOrder(inscricao, leitura);
  const { inscricao: atualizada, gravou } = await atualizarInscricao(inscricao.id, mudancas);
  const resultado = atualizada || { ...inscricao, ...mudancas };

  if (gravou && resultado.status === STATUS_PAGO && inscricao.status !== STATUS_PAGO) {
    console.log(`[Churrasco/${origem}] ${inscricao.id} confirmado por Pix.`);
  }
  if (gravou && resultado.status === STATUS_REVISAO && inscricao.status !== STATUS_REVISAO) {
    console.warn(`[Churrasco/${origem}] ${inscricao.id} marcado para revisão manual.`);
  }
  return resultado;
}

/* ─── Projeção pública ───────────────────────────────────────────────── */

/**
 * Só o que a tela mostra. Sem telefone, sem e-mail, sem credencial, sem o
 * corpo da resposta do Mercado Pago e sem nada de outras inscrições.
 */
function statusView(inscricao, leitura = null) {
  const pendente = inscricao.status === STATUS_PENDENTE;
  const pix =
    leitura && pendente && (leitura.qrCode || leitura.qrCodeBase64)
      ? {
          qrCode: leitura.qrCode || "",
          qrCodeBase64: leitura.qrCodeBase64 || "",
          mimeType: "image/png",
          expiraEm: leitura.expiraEm || inscricao.expiraEm || "",
        }
      : null;

  return {
    ok: true,
    orderId: inscricao.id,
    nome: inscricao.nome,
    curso: inscricao.curso,
    categoria: inscricao.categoria,
    status: inscricao.status,
    statusLabel: statusLabel(inscricao.status),
    paid: inscricao.status === STATUS_PAGO,
    final: isStatusFinal(inscricao.status),
    podeRenovar: podeGerarNovoPix(inscricao.status),
    metodo: inscricao.metodo || null,
    paymentId: inscricao.paymentMpId || null,
    amountCents: inscricao.valorCents,
    amount: formatBRL(inscricao.valorCents),
    receiptUrl: inscricao.ticketUrl || null,
    pagoEm: inscricao.pagoEm || null,
    expiraEm: inscricao.expiraEm || null,
    pix,
  };
}

/* ─── Rotas ──────────────────────────────────────────────────────────── */

/* O evento é de uma atlética: dezenas de pessoas se inscrevem do mesmo wi-fi
   do campus e chegam aqui com um único IP público. Por isso os limites por IP
   são largos e o freio fino fica por inscrição. */
const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
});

// Uma aba aberta consulta a cada 7s — cerca de 90 chamadas em 10 minutos.
const statusPorPedidoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 400,
  message: "Muitas consultas seguidas. Aguarde um instante.",
  keyFrom: (req) => `pedido:${req.params.orderId}`,
});

const statusPorIpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3000,
  message: "Muitas consultas seguidas. Aguarde um instante.",
  keyFrom: clientIp,
});

/* Gerar o PDF custa CPU e desenha um QR: o freio é mais apertado que o da
   consulta de status, mas largo o bastante para quem baixa de novo na fila. */
const comprovantePorPedidoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: "Muitos downloads seguidos. Aguarde um instante e tente de novo.",
  keyFrom: (req) => `comprovante:${req.params.orderId}`,
});

const comprovantePorIpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  message: "Muitos downloads seguidos. Aguarde um instante e tente de novo.",
  keyFrom: clientIp,
});

/* Na portaria, várias pessoas validam do mesmo wi-fi: o limite é por IP e
   largo, porque a rota é só leitura e nunca altera a inscrição. */
const validacaoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 600,
  message: "Muitas consultas seguidas. Aguarde um instante.",
  keyFrom: clientIp,
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: "too many requests",
});

/** Erros de infraestrutura viram uma mensagem única, sem detalhe técnico. */
function indisponivel(res, motivo) {
  console.error(`[Churrasco] indisponível: ${motivo}`);
  return res.status(503).json({
    ok: false,
    error: "As inscrições estão temporariamente indisponíveis. Tente novamente em instantes.",
  });
}

/** Erro do Mercado Pago → mensagem amigável + status HTTP nosso. */
function respostaDeErroMp(res, err) {
  const codigo = err instanceof MercadoPagoError ? err.code : "erro";

  if (codigo === "rate_limit") {
    if (err.retryAfterSeconds) res.setHeader("Retry-After", String(err.retryAfterSeconds));
    return res.status(429).json({
      ok: false,
      error: "Muitas cobranças ao mesmo tempo. Aguarde alguns segundos e tente de novo.",
    });
  }
  if (codigo === "sem_credencial" || codigo === "credencial_invalida") {
    return indisponivel(res, `credencial do Mercado Pago recusada (${codigo})`);
  }
  if (codigo === "timeout" || codigo === "rede" || codigo === "indisponivel") {
    return res.status(502).json({
      ok: false,
      error: "O Mercado Pago não respondeu a tempo. Tente novamente em instantes.",
    });
  }
  return res.status(502).json({
    ok: false,
    error: "Não foi possível gerar o Pix agora. Tente novamente em instantes.",
  });
}

/* Duplo clique: duas requisições idênticas chegam antes de a primeira gravar
   qualquer coisa. A trava faz a segunda esperar e reaproveitar o resultado da
   primeira. Vale só dentro deste processo — a proteção que sobrevive a um
   restart é a busca da inscrição pela pessoa, logo abaixo. */
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

/** Estados em que uma nova cobrança seria um erro: o dinheiro já andou. */
const SEM_NOVA_COBRANCA = new Set([STATUS_PAGO, STATUS_REVISAO, STATUS_REEMBOLSADO]);

/** Sobra tempo suficiente no Pix atual para valer a pena reaproveitá-lo? */
function pixAindaValido(inscricao) {
  if (!inscricao.expiraEm) return true; // sem data conhecida, quem decide é o MP
  const instante = Date.parse(inscricao.expiraEm);
  if (Number.isNaN(instante)) return true;
  return instante > Date.now() + 30_000;
}

export function registerChurrascoRoutes(app) {
  /**
   * Cria (ou recupera) a cobrança Pix da inscrição.
   *
   * Nunca cria uma segunda cobrança para a mesma pessoa no mesmo curso: se já
   * houver uma linha com um Pix vivo, ela é devolvida como está.
   */
  app.post("/api/churrasco/checkout", checkoutLimiter, async (req, res) => {
    const parsed = parseInscricao(req.body);
    if (parsed.error) {
      return res.status(400).json({ ok: false, error: parsed.error, field: parsed.field });
    }
    const dados = parsed.data;

    if (!isMercadoPagoConfigured()) {
      return indisponivel(res, "MERCADO_PAGO_ACCESS_TOKEN ausente");
    }
    if (!isChurrascoSheetConfigured()) {
      return indisponivel(res, "Google Sheets não configurado");
    }

    /** Cria a order no Mercado Pago e grava os IDs na linha que já existe. */
    async function cobrar(inscricao) {
      const chave = chaveIdempotencia(inscricao.id, inscricao.orderMpId);

      let order = await criarOrderPix({
        externalReference: inscricao.id,
        amountCents: inscricao.valorCents,
        payerEmail: inscricao.email,
        idempotencyKey: chave,
      });
      let leitura = lerOrder(order);

      // A order pode nascer sem o QR quando o Mercado Pago a processa de forma
      // assíncrona. Uma segunda leitura costuma resolver; se não resolver, a
      // tela continua consultando o status até o QR aparecer.
      if (!leitura.qrCode && !leitura.qrCodeBase64 && leitura.orderId) {
        await new Promise((r) => setTimeout(r, 900));
        try {
          order = await buscarOrder(leitura.orderId, { fresh: true });
          leitura = lerOrder(order);
        } catch {
          /* mantém a primeira leitura */
        }
      }

      const atualizada = await aplicarOrder(inscricao, leitura, "Checkout");
      return { inscricao: atualizada, leitura };
    }

    try {
      const resultado = await comTravaLogica(`${dados.email}|${dados.curso}`, async () => {
        const existente = await findInscricaoPorPessoa(dados.email, dados.curso, { fresh: true });

        if (existente) {
          // Já pago, reembolsado ou em conferência: nunca cobramos de novo.
          if (SEM_NOVA_COBRANCA.has(existente.status)) {
            return { inscricao: existente, leitura: null };
          }

          // Mesma tentativa lógica, Pix ainda vivo: devolve o que já existe.
          if (existente.orderMpId && !podeGerarNovoPix(existente.status) && pixAindaValido(existente)) {
            try {
              const leitura = lerOrder(await buscarOrder(existente.orderMpId, { fresh: true }));
              const atualizada = await aplicarOrder(existente, leitura, "Checkout");
              if (leitura.qrCode || leitura.qrCodeBase64 || isStatusFinal(atualizada.status)) {
                return { inscricao: atualizada, leitura };
              }
            } catch (err) {
              if (!(err instanceof MercadoPagoError) || err.code !== "nao_encontrado") throw err;
            }
          }

          // Pix vencido, cancelado ou perdido: nova cobrança na MESMA linha.
          return cobrar(existente);
        }

        // Inscrição nova: a linha pendente nasce ANTES da cobrança, para que o
        // webhook sempre tenha onde escrever.
        const id = createOrderNsu();
        await criarInscricaoPendente({ ...dados, id });

        console.log(
          `[Churrasco] ${id} criado (${dados.categoria}, ${formatBRL(dados.valorCents)}, ` +
            `${telefoneMascarado(dados.telefone)}, ${maskEmail(dados.email)}).`
        );

        return cobrar({
          ...dados,
          id,
          status: STATUS_PENDENTE,
          orderMpId: "",
          paymentMpId: "",
          ticketUrl: "",
          pagoEm: "",
          expiraEm: "",
          metodo: "",
        });
      });

      const { inscricao, leitura } = resultado;
      const view = statusView(inscricao, leitura);

      return res.status(201).json({
        ...view,
        token: inscricaoToken(inscricao.id),
        // Sem `pix` a tela mostra "Gerando seu Pix..." e continua consultando.
        gerandoPix: inscricao.status === STATUS_PENDENTE && !view.pix,
      });
    } catch (err) {
      if (err?.code === "sheets_not_configured") {
        return indisponivel(res, "Google Sheets não configurado");
      }

      if (err instanceof MercadoPagoError) {
        console.error(`[Churrasco] Mercado Pago recusou a cobrança: ${err.code} (${err.status}).`);
        // A linha pode já existir: marca o erro para a organização enxergar.
        await findInscricaoPorPessoa(dados.email, dados.curso, { fresh: true })
          .then((inscricao) =>
            inscricao && inscricao.status === STATUS_PENDENTE && !inscricao.orderMpId
              ? atualizarInscricao(inscricao.id, {
                  status: STATUS_ERRO,
                  observacoes: "Falha ao criar a cobrança Pix no Mercado Pago.",
                })
              : null
          )
          .catch(() => {});
        return respostaDeErroMp(res, err);
      }

      console.error("[Churrasco] falha no checkout:", err?.message || err);
      return res.status(502).json({
        ok: false,
        error: "Não foi possível registrar sua inscrição. Verifique sua conexão e tente novamente.",
      });
    }
  });

  /**
   * Status da inscrição.
   *
   * Exige o token derivado da própria referência: o token de uma inscrição não
   * abre outra. Enquanto o pagamento não fecha, cada consulta vai à order no
   * Mercado Pago — o navegador não confirma nada sozinho.
   */
  app.get(
    "/api/churrasco/pagamentos/:orderId/status",
    statusPorIpLimiter,
    statusPorPedidoLimiter,
    async (req, res) => {
      const orderId = String(req.params.orderId || "").slice(0, 60);
      const token = req.get("X-Inscricao-Token") || String(req.query.token || "");

      // Token errado responde 404: nem confirma nem nega que o pedido existe.
      if (!isChurrascoOrder(orderId) || !tokenConfere(orderId, token)) {
        return res.status(404).json({ ok: false, error: "Inscrição não encontrada." });
      }

      try {
        const inscricao = await findInscricao(orderId);
        if (!inscricao) {
          return res.status(404).json({ ok: false, error: "Inscrição não encontrada." });
        }

        // Estado final: não reprocessa nem consulta o Mercado Pago de novo.
        if (isStatusFinal(inscricao.status) || !inscricao.orderMpId) {
          return res.json(statusView(inscricao));
        }

        const leitura = lerOrder(await buscarOrder(inscricao.orderMpId));
        const atualizada = await aplicarOrder(inscricao, leitura, "Status");
        return res.json(statusView(atualizada, leitura));
      } catch (err) {
        if (err instanceof MercadoPagoError) {
          console.error(`[Churrasco] consulta ao Mercado Pago falhou: ${err.code}.`);
        } else {
          console.error("[Churrasco] falha ao consultar o status:", err?.message || err);
        }
        return res.status(502).json({
          ok: false,
          error: "Não foi possível verificar o pagamento agora. Tentaremos de novo em instantes.",
        });
      }
    }
  );

  /**
   * Webhook do Mercado Pago — evento `order`.
   *
   * O corpo é só um aviso de que algo mudou: o status vem sempre de
   * `GET /v1/orders/{id}`. Notificações da loja, de outro sistema ou de uma
   * order desconhecida são ignoradas sem criar nada.
   */
  app.post(CHURRASCO_WEBHOOK_PATH, webhookLimiter, async (req, res) => {
    const body = req.body || {};
    const dataId = String(body?.data?.id || body?.id || "").slice(0, 80);

    const assinatura = validarAssinaturaWebhook({
      xSignature: req.get("x-signature"),
      xRequestId: req.get("x-request-id"),
      dataId,
    });

    if (!assinatura.ok) {
      console.warn(`[Churrasco/Webhook] assinatura recusada (${assinatura.motivo}).`);
      return res.status(401).json({ ok: false });
    }

    // Só o tópico de orders. `payment`, `merchant_order` e afins não são nossos.
    const topico = String(body.type || body.topic || body.action || "").toLowerCase();
    if (!topico.includes("order")) {
      return res.status(200).json({ ok: true, ignorado: "topico" });
    }
    if (!dataId) {
      return res.status(200).json({ ok: true, ignorado: "sem_id" });
    }

    try {
      const leitura = lerOrder(await buscarOrder(dataId, { fresh: true }));
      const referencia = leitura.externalReference;

      // Pedidos da loja chegam no webhook dela; aqui só entra o churrasco.
      if (!isChurrascoOrder(referencia)) {
        console.log(`[Churrasco/Webhook] referência fora do churrasco — ignorada.`);
        return res.status(200).json({ ok: true, ignorado: "referencia" });
      }

      const inscricao = await findInscricao(referencia, { fresh: true });
      if (!inscricao) {
        console.warn(`[Churrasco/Webhook] ${referencia} não está na planilha — ignorada.`);
        return res.status(200).json({ ok: true, ignorado: "desconhecida" });
      }

      // A order precisa ser a que a inscrição conhece. Uma notificação sobre
      // outra order com a mesma referência não altera esta linha.
      if (inscricao.orderMpId && leitura.orderId && inscricao.orderMpId !== leitura.orderId) {
        console.warn(`[Churrasco/Webhook] ${referencia} aponta para outra order — ignorada.`);
        return res.status(200).json({ ok: true, ignorado: "order_divergente" });
      }

      await aplicarOrder(inscricao, leitura, "Webhook");
      return res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof MercadoPagoError && err.code === "nao_encontrado") {
        console.warn("[Churrasco/Webhook] order desconhecida — ignorada.");
        return res.status(200).json({ ok: true, ignorado: "order_inexistente" });
      }
      // Falha transitória: 500 faz o Mercado Pago reenviar a notificação.
      const motivo = err instanceof MercadoPagoError ? err.code : "planilha";
      console.error(`[Churrasco/Webhook] erro ao processar (${motivo}).`);
      return res.status(500).json({ ok: false });
    }
  });

  /**
   * Validação pública do comprovante — é o que o QR Code abre na entrada.
   *
   * O QR carrega só a referência assinada; nada do que vem nele é usado como
   * verdade. A situação sai da linha da planilha, lida na hora, e a rota
   * NUNCA escreve: não confirma pagamento, não marca presença.
   *
   * Registrada antes da rota do PDF porque "validar" ocuparia o lugar de
   * `:orderId` se a ordem fosse a inversa.
   */
  app.get("/api/churrasco/comprovantes/validar/:token", validacaoLimiter, async (req, res) => {
    const referencia = lerTokenVerificacao(String(req.params.token || "").slice(0, 200));

    // Assinatura inválida ou adulterada: nem chegamos a consultar nada.
    if (!referencia || !isChurrascoOrder(referencia)) {
      return res.json(validacaoView(null, { valido: false }));
    }

    try {
      const inscricao = await findInscricao(referencia);
      if (!inscricao) return res.json(validacaoView(null, { valido: false }));
      return res.json(validacaoView(inscricao, { valido: true }));
    } catch (err) {
      console.error("[Churrasco/Validação] falha ao consultar:", err?.message || err);
      return res.status(503).json({
        ok: false,
        error: "Não foi possível validar agora. Tente novamente em instantes.",
      });
    }
  });

  /**
   * Download do comprovante em PDF.
   *
   * Exige o mesmo `X-Inscricao-Token` da consulta de status, e o documento é
   * montado a partir da linha oficial — o navegador não envia nenhum dado que
   * vá para dentro do PDF.
   *
   * Aqui o token errado responde 401/403, e não o 404 discreto da consulta de
   * status: quem chega nesta rota já tem uma inscrição em mãos, e a mensagem
   * precisa dizer o que houve.
   */
  app.get(
    "/api/churrasco/comprovantes/:orderId/pdf",
    comprovantePorIpLimiter,
    comprovantePorPedidoLimiter,
    async (req, res) => {
      const orderId = String(req.params.orderId || "").slice(0, 60);
      const token = req.get("X-Inscricao-Token") || "";

      // O token tem forma fixa: o que não tem essa forma é inválido, não alheio.
      if (!/^[A-Za-z0-9_-]{32}$/.test(token)) {
        return res.status(401).json({ ok: false, error: "Inscrição não identificada." });
      }
      if (!isChurrascoOrder(orderId)) {
        return res.status(404).json({ ok: false, error: "Inscrição não encontrada." });
      }
      if (!tokenConfere(orderId, token)) {
        return res.status(403).json({ ok: false, error: "Este código é de outra inscrição." });
      }

      try {
        const inscricao = await findInscricao(orderId);
        const permissao = podeEmitirComprovante(inscricao);
        if (!permissao.ok) {
          return res.status(permissao.status).json({ ok: false, error: permissao.error });
        }

        const pdf = await gerarComprovantePdf(inscricao);
        const arquivo = nomeArquivoComprovante(inscricao.id);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${arquivo}"`);
        res.setHeader("Content-Length", String(pdf.length));
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.status(200).end(pdf);
      } catch (err) {
        console.error("[Churrasco/Comprovante] falha ao gerar:", err?.message || err);
        return res.status(503).json({
          ok: false,
          error: "Não foi possível gerar o comprovante agora. Tente novamente em instantes.",
        });
      }
    }
  );

  /* ── Configuração pública da página ──────────────────────────────── */
  app.get("/api/churrasco/config", (_req, res) => {
    res.json({
      // Nunca expõe o Access Token, o segredo do webhook nem qualquer env.
      inscricoesDisponiveis: isMercadoPagoConfigured() && isChurrascoSheetConfigured(),
      pagamento: "pix",
      provedor: PROVEDOR,
      webhookConfigurado: isWebhookSecretConfigured(),
      ambiente: ambienteMercadoPago(),
      expiracaoMinutos: PIX_EXPIRACAO_MINUTOS,
      comprovanteAssinado: isComprovanteSecretConfigured(),
      abaPlanilha: CHURRASCO_SHEET_NAME,
    });
  });
}
