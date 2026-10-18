// IMPORTANTE: deve ser o primeiro import — aplica o fix SSL global antes do
// googleapis carregar (imports ESM executam em ordem).
import "./ssl-legacy.js";

import './env.js';

import express from "express";
import { calculateOrder, sanitizeSelection } from "./shared/order.js";
import { criarLinkPagamento, verificarPagamento } from "./infinitepay.js";
import { getGooglePrivateKey, isGoogleSheetsConfigured } from "./google-sheets.js";
import {
  CHURRASCO_WEBHOOK_PATH,
  isReferenciaDeChurrasco,
  registerChurrascoRoutes,
  aplicarWebhookChurrasco,
} from "./churrasco.js";
import {
  MercadoPagoError,
  ambienteMercadoPago,
  consultarOrder,
  isMercadoPagoConfigured,
  isWebhookSecretConfigured,
  lerOrder,
  validarAssinaturaWebhook,
} from "./mercadopago.js";
import { checkCoupon } from "./cupons.js";
import {
  ORDER_PREFIX as LOJA_PREFIX,
  registerLojaRoutes,
  aplicarWebhookLoja,
} from "./loja-pagamento.js";
import {
  ORDER_PREFIX as ROCKET_PREFIX,
  registerRocketRoutes,
  aplicarWebhookRocket,
} from "./rocket.js";
import { rateLimit, rateLimitDisabled } from "./rate-limit.js";
import { registerSiteAdmin } from './site-admin.js';
import { registerRocketTournament } from './rocket-torneio.js';

const app = express();
const port = process.env.PORT || 3333;

/* ─── PROXY ───
   No Render o IP do cliente chega no X-Forwarded-For, mas só os últimos
   TRUST_PROXY_HOPS endereços foram escritos pela infraestrutura — o resto o
   próprio cliente pode inventar. O Express usa isso para calcular `req.ip`,
   que é a chave de todos os limites de requisições. */
const TRUST_PROXY_HOPS = trustProxyHops(process.env.TRUST_PROXY_HOPS);
app.set("trust proxy", TRUST_PROXY_HOPS);
app.disable("x-powered-by");

function trustProxyHops(valor) {
  if (valor === undefined || String(valor).trim() === "") return 1;
  const saltos = Number(valor);
  return Number.isInteger(saltos) && saltos >= 0 && saltos <= 10 ? saltos : 1;
}
const defaultGoogleSheetName = process.env.GOOGLE_SHEETS_SHEET_NAME || "Pedidos";

// Cache em memória dos pedidos recentes do checkout legado (orderId → { items, totalCents, customer })
// Suficiente para a sessão atual; usado só pela consulta de pedido abaixo.
const orderCache = new Map();

/* ─── CUPONS DE DESCONTO (preço de custo) ───
   A regra e a lista vivem em `cupons.js`, compartilhadas com o checkout do
   Mercado Pago da loja. */

/* ─── CORS ─── */
// Aceita: domínio oficial aasiam.com.br (com e sem www), o domínio da Vercel,
// localhost em dev, APP_URL do .env e qualquer *.vercel.app (preview deploys).
const ALLOWED_ORIGINS = new Set(
  [
    process.env.APP_URL,                       // ex: https://www.aasiam.com.br
    "https://www.aasiam.com.br",
    "https://aasiam.com.br",
    "https://loja-aasiam-tkah.vercel.app",
    "http://localhost:5173",
    "http://localhost:4173",
  ]
    .filter(Boolean)
    .map((o) => o.replace(/\/$/, "")) // remove barra final acidental
);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed =
    !origin || // chamada server-to-server / mesmo domínio
    ALLOWED_ORIGINS.has(origin) ||
    /^https:\/\/[\w-]+\.vercel\.app$/.test(origin);

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    // X-Inscricao-Token: status da inscrição do churrasco.
    // X-Inscricao-Token: status do churrasco e do torneio Rocket League.
    // X-Pedido-Token: status do pedido da loja (polling do Pix pós-pagamento).
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Inscricao-Token, X-Pedido-Token");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use('/api/admin/media', express.json({ limit: '5mb' }));
app.use(express.json({ limit: "1mb" }));
const siteAdmin = registerSiteAdmin(app);
registerRocketTournament(app, { adminRouter: siteAdmin.router });

/* ─── CHURRASCOS (AMF Games e Semana Acadêmica de SI) ─── */
// /api/churrasco/*           Churrasco da Alcateia (AMF Games)
// /api/churrasco-semana-si/* Churrasco da AASIAM — Semana Acadêmica de SI
// Cada um: checkout · pagamentos/:orderId/status · comprovantes · config.
// Cobram por Pix no Checkout Transparente do Mercado Pago (API de Orders),
// cada evento com aba de planilha e prefixo de referência próprios.
registerChurrascoRoutes(app);

/* ─── LOJA — checkout pelo Mercado Pago ─── */
// POST /api/loja/checkout/quote · POST /api/loja/checkout
// GET  /api/loja/pedidos/:orderId/status
// Cobra cartão (com repasse da taxa ao cliente) e Pix no Checkout Transparente
// do Mercado Pago, com aba de planilha própria. Compartilha o cliente HTTP e a
// validação de assinatura com o churrasco.
registerLojaRoutes(app);

/* ─── TORNEIO ROCKET LEAGUE 2x2 ─── */
registerRocketRoutes(app);

/* ─── WEBHOOK CENTRAL DO MERCADO PAGO ───
   A API de Orders usa UM único destino por aplicação, configurado no painel
   (tópico "Order"). Este endpoint recebe tudo, valida a assinatura uma vez,
   consulta a order OFICIAL (`GET /v1/orders/{id}`) e despacha pelo prefixo do
   `external_reference` — nunca confia na referência vinda no corpo.
     LOJA-...       → aplicarWebhookLoja
     CHURRASCO-...  → aplicarWebhookChurrasco (AMF Games)
     SEMANASI-...   → aplicarWebhookChurrasco (Semana Acadêmica de SI)
     ROCKET-...     → aplicarWebhookRocket
     qualquer outro → 200 ignorado
   Os endpoints /api/{loja,churrasco}/webhook/mercadopago seguem funcionando
   para compatibilidade e usam os mesmos handlers. */
const webhookCentralLimiter = rateLimit({ windowMs: 60 * 1000, max: 600, message: "too many requests" });

app.post("/api/mercadopago/webhook", webhookCentralLimiter, async (req, res) => {
  const body = req.body || {};
  const dataId = String(body?.data?.id || body?.id || "").slice(0, 80);

  const assinatura = validarAssinaturaWebhook({
    xSignature: req.get("x-signature"),
    xRequestId: req.get("x-request-id"),
    dataId,
  });
  if (!assinatura.ok) {
    console.warn(`[MercadoPago/Webhook] assinatura recusada (${assinatura.motivo}).`);
    return res.status(401).json({ ok: false });
  }

  const topico = String(body.type || body.topic || body.action || "").toLowerCase();
  if (!topico.includes("order")) return res.status(200).json({ ok: true, ignorado: "topico" });
  if (!dataId) return res.status(200).json({ ok: true, ignorado: "sem_id" });

  try {
    const leitura = lerOrder(await consultarOrder(dataId));
    const referencia = leitura.externalReference || "";

    let resultado;
    if (referencia.startsWith(LOJA_PREFIX)) {
      resultado = await aplicarWebhookLoja(leitura);
    } else if (isReferenciaDeChurrasco(referencia)) {
      resultado = await aplicarWebhookChurrasco(leitura);
    } else if (referencia.startsWith(ROCKET_PREFIX)) {
      resultado = await aplicarWebhookRocket(leitura);
    } else {
      return res.status(200).json({ ok: true, ignorado: "referencia" });
    }
    return res.status(resultado.status).json(resultado.body);
  } catch (err) {
    if (err instanceof MercadoPagoError && err.code === "nao_encontrado") {
      return res.status(200).json({ ok: true, ignorado: "order_inexistente" });
    }
    const motivo = err instanceof MercadoPagoError ? err.code : "processamento";
    console.error(`[MercadoPago/Webhook] erro ao processar (${motivo}).`);
    return res.status(500).json({ ok: false });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    // Diagnóstico do proxy, sem expor endereços: quantos IPs chegaram no
    // X-Forwarded-For e quantos saltos o servidor confia (TRUST_PROXY_HOPS).
    proxy: {
      xffHops: String(req.get("x-forwarded-for") || "").split(",").map((ip) => ip.trim()).filter(Boolean).length,
      trustProxyHops: TRUST_PROXY_HOPS,
    },
    infinitePayConfigured: Boolean(process.env.INFINITEPAY_HANDLE),
    googleSheetsConfigured: isGoogleSheetsConfigured(),
    // Só diz se está configurado — nunca a credencial em si.
    churrascoConfigured: isMercadoPagoConfigured(),
    churrascoWebhookConfigured: isWebhookSecretConfigured(),
    churrascoAmbiente: ambienteMercadoPago(),
    // A loja usa a mesma credencial do Mercado Pago; muda só a Public Key.
    lojaMercadoPagoConfigured: isMercadoPagoConfigured(),
    lojaPublicKeyConfigured: Boolean(process.env.MERCADO_PAGO_PUBLIC_KEY),
    rocketLeagueConfigured: isMercadoPagoConfigured() && isGoogleSheetsConfigured(),
    rocketLeagueWebhookConfigured: isWebhookSecretConfigured(),
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    infinitePayConfigured: Boolean(process.env.INFINITEPAY_HANDLE),
    googleSheetsConfigured: isGoogleSheetsConfigured(),
    googleSheetName: defaultGoogleSheetName
  });
});

/* ─── CUPONS ─── */
// Valida um cupom sem marcá-lo como usado. Não expõe a lista de cupons.
app.post("/api/validar-cupom", async (req, res) => {
  const { codigo } = req.body || {};
  const r = await checkCoupon(codigo);
  // Nunca expõe contadores nem a lista — só o suficiente para a tela.
  return res.json(
    r.valido
      ? { valido: true, tipo: r.tipo, codigo: r.codigo, ...(r.percentual != null ? { percentual: r.percentual } : {}) }
      : { valido: false, motivo: r.motivo }
  );
});

app.post("/api/checkout", async (req, res) => {
  try {
    const customer = sanitizeCustomer(req.body?.customer);
    const selection = sanitizeSelection(req.body?.selection);
    const order = calculateOrder(selection);

    // Checkout LEGADO (InfinitePay). O e-commerce hoje usa /api/loja/checkout,
    // que é onde os cupons valem.

    if (!customer.name) {
      return res.status(400).json({ error: "O campo nome é obrigatório." });
    }

    if (!customer.phone) {
      return res.status(400).json({ error: "O campo telefone é obrigatório." });
    }

    if (order.lines.length === 0) {
      return res.status(400).json({ error: "Selecione pelo menos um produto." });
    }

    const orderId = createOrderId();

    const items = order.lines.map((line) => ({
      quantity: line.quantity,
      price: line.unitPriceCents,
      description: line.variant
        ? `${line.productName} - ${line.variant}`
        : line.productName
    }));

    const { url } = await criarLinkPagamento({
      orderId,
      items,
      cliente: {
        nome: customer.name,
        telefone: customer.phone,
        email: customer.email || undefined
      }
    });

    // Armazena pedido em memória — a planilha só é preenchida após confirmação pelo webhook
    orderCache.set(orderId, {
      items: order.lines.map((line) => ({
        name: line.variant
          ? `${line.productName} - ${line.variant}`
          : line.productName,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      })),
      order,
      customer: { name: customer.name, phone: customer.phone, notes: customer.notes },
      totalCents: order.totalCents,
    });

    console.log(`[Checkout] Pedido ${orderId} criado. Aguardando pagamento.`);

    return res.status(201).json({ orderId, url });
  } catch (err) {
    console.error("Erro em /api/checkout:", err);
    return res.status(err.status || 500).json({
      error: err.message || "Não foi possível criar o link de pagamento."
    });
  }
});

/* ─── CONSULTA DE PEDIDO ─── */

app.get("/api/pedido/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { transaction_nsu, slug } = req.query;

    if (!orderId) {
      return res.status(400).json({ error: "orderId é obrigatório." });
    }

    let paymentData = null;

    if (transaction_nsu && slug) {
      try {
        paymentData = await verificarPagamento({
          orderId,
          transactionNsu: transaction_nsu,
          slug,
        });
      } catch (err) {
        console.error("Erro ao verificar pagamento na InfinitePay:", err.message);
        // Não propaga — retorna o que temos com verified: false
      }
    }

    const paid = paymentData?.paid === true;
    const status = paymentData?.status ?? (req.query.status === "concluido" ? "concluido" : "unknown");

    const cached = orderCache.get(orderId) || {};

    // capture_method e transaction_id vêm da URL de redirect da InfinitePay como fallback
    const captureMethod = paymentData?.capture_method ?? req.query.capture_method ?? null;

    return res.json({
      orderId,
      verified: paymentData !== null,
      paid,
      status,
      amount:         paymentData?.amount      ?? cached.totalCents ?? null,
      paid_amount:    paymentData?.paid_amount  ?? null,
      installments:   paymentData?.installments ?? null,
      capture_method: captureMethod,
      receipt_url:    req.query.receipt_url     || null,
      items:          cached.items    ?? [],
      totalCents:     cached.totalCents ?? null,
      customer:       cached.customer  ?? null,
    });
  } catch (err) {
    console.error("Erro em GET /api/pedido:", err);
    return res.status(err.status || 500).json({
      error:
        "Não foi possível verificar o status do pedido. Guarde o número do pedido e entre em contato com o suporte.",
    });
  }
});

/* ─── VERIFICAÇÃO ATIVA DE STATUS (polling do frontend) ─── */
// Consulta o status atual diretamente na InfinitePay (payment_check).
// Usada pelo frontend a cada 5s para atualizar a tela sem depender só do webhook.
app.get("/api/pedido/:orderId/status", async (req, res) => {
  const { orderId } = req.params;
  const { transaction_nsu, slug } = req.query;

  try {
    let paymentData = null;

    if (transaction_nsu && slug) {
      try {
        paymentData = await verificarPagamento({
          orderId,
          transactionNsu: transaction_nsu,
          slug,
        });
      } catch (err) {
        console.error(`[Status] Erro ao verificar ${orderId} na InfinitePay:`, err.message);
      }
    }

    const rawStatus  = paymentData?.status ?? (paymentData?.paid ? "paid" : "pending");
    const statusLabel = normalizeWebhookStatus(rawStatus);
    const paid = paymentData?.paid === true || statusLabel === "Pago";

    return res.json({
      orderId,
      paid,
      status: statusLabel,          // "Pago" | "Recusado" | "Em análise"
      rawStatus,
      capture_method: paymentData?.capture_method ?? req.query.capture_method ?? null,
      installments:   paymentData?.installments   ?? null,
      verified:       paymentData !== null,
    });
  } catch (err) {
    console.error(`[Status] Erro em GET /api/pedido/${orderId}/status:`, err);
    return res.status(500).json({ error: "Não foi possível verificar o status do pedido." });
  }
});

// Em produção o frontend é servido pela Vercel — o backend é apenas a API.
// Em dev local o frontend é servido pelo Vite (porta 5173).
// Não há catch-all aqui para não interferir com rotas /api/*.

app.listen(port, () => {
  console.log(`\n=== API AASIAM iniciada na porta ${port} ===`);
  console.log(`APP_URL : ${process.env.APP_URL  || "⚠ não definido (fallback localhost)"}`);
  console.log(`API_URL : ${process.env.API_URL  || "⚠ não definido (fallback localhost)"}`);
  console.log(`CORS    : ${[...ALLOWED_ORIGINS].join(", ")} + *.vercel.app`);
  console.log(`InfinitePay handle: ${process.env.INFINITEPAY_HANDLE || "⚠ NÃO CONFIGURADO"}`);
  console.log(`Proxy   : confia em ${TRUST_PROXY_HOPS} salto(s) do X-Forwarded-For (TRUST_PROXY_HOPS)`);
  if (rateLimitDisabled()) console.log("Limites : ⚠ DESLIGADOS (RATE_LIMIT_DISABLED=true)");

  // Diagnóstico do Mercado Pago — churrasco (Pix) + loja (cartão e Pix).
  const apiBase = (process.env.API_URL || "http://localhost:3333").replace(/\/$/, "");
  console.log(
    `Mercado Pago: ${
      isMercadoPagoConfigured()
        ? `✓ credencial de ${ambienteMercadoPago()}`
        : "✗ defina MERCADO_PAGO_ACCESS_TOKEN"
    }`
  );
  console.log(`  → webhook (painel, tópico "Order"): ${apiBase}/api/mercadopago/webhook`);
  console.log(`  → compat: ${apiBase}${CHURRASCO_WEBHOOK_PATH} · ${apiBase}/api/loja/webhook/mercadopago`);
  console.log(
    `  → assinatura do webhook: ${
      isWebhookSecretConfigured() ? "✓ configurada" : "✗ defina MERCADO_PAGO_WEBHOOK_SECRET"
    }`
  );
  console.log(`  → loja: Public Key ${process.env.MERCADO_PAGO_PUBLIC_KEY ? "✓" : "✗ MERCADO_PAGO_PUBLIC_KEY"}`);

  // Diagnóstico do Google Sheets
  const sheetsOk = isGoogleSheetsConfigured();
  console.log(`Google Sheets configurado: ${sheetsOk ? "✓ SIM" : "✗ NÃO"}`);
  if (sheetsOk) {
    console.log(`  → email : ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
    console.log(`  → chave privada: ${getGooglePrivateKey() ? "configurada" : "AUSENTE"}`);
    console.log(`  → sheet : ${process.env.GOOGLE_SHEETS_SPREADSHEET_ID} / aba "${defaultGoogleSheetName}"`);
  }
  console.log("=".repeat(45) + "\n");
});

function sanitizeCustomer(customer = {}) {
  return {
    name: cleanText(customer.name, 120),
    phone: cleanText(customer.phone, 30),
    email: cleanText(customer.email, 120).toLowerCase(),
    notes: cleanText(customer.notes, 500)
  };
}

/**
 * Normaliza o status cru do webhook/payment_check da InfinitePay para um rótulo da planilha.
 *  - approved / paid / captured / success → "Pago"
 *  - refused / failed / cancelled / rejected → "Recusado"
 *  - qualquer outro (pending, waiting, created…) → "Em análise"
 */
function normalizeWebhookStatus(status) {
  const s = String(status || "").toLowerCase().trim();

  const pagos     = ["approved", "paid", "captured", "success", "succeeded", "concluido", "concluído", "completed"];
  const recusados = ["refused", "failed", "cancelled", "canceled", "rejected", "denied", "chargeback", "refunded", "expired"];

  if (pagos.includes(s))     return "Pago";
  if (recusados.includes(s)) return "Recusado";
  return "Em análise";
}

function cleanText(value, maxLength) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function createOrderId() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AASIAM-${timestamp}-${suffix}`;
}
