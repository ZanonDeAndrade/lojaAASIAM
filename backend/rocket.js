/** Fluxo de inscrição do Torneio Rocket League 2x2 da AASIAM. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import PDFDocument from "pdfkit";

import { formatDateTime } from "./google-sheets.js";
import { clientIp, rateLimit } from "./rate-limit.js";
import {
  MercadoPagoError,
  consultarOrder,
  criarOrderPix,
  isMercadoPagoConfigured,
  lerOrder,
  validarAssinaturaWebhook,
} from "./mercadopago.js";
import {
  ROCKET_TEAM_LIMIT,
  activeRegistrations,
  findRocketRegistration,
  isRocketSheetConfigured,
  reserveRocketRegistration,
  rocketSeats,
  updateRocketRegistration,
} from "./rocket-inscricoes.js";
import {
  formatBRL,
  normalizeEmail,
  normalizeFullName,
  normalizePhoneDigits,
  validateEmail,
  validateFullName,
  validatePhone,
} from "./shared/churrasco.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ORDER_PREFIX = "ROCKET-";
export const ROCKET_WEBHOOK_PATH = "/api/rocket-league/webhook/mercadopago";
export const ROCKET_REGULATION_VERSION = "Regulamento Oficial — 25/09/2026";
export const ROCKET_AMOUNT_CENTS = 5000;
const DEADLINE = new Date("2026-10-11T02:59:59-03:00").getTime();
const PIX_EXPIRATION = "PT30M";
const LINKS = new Map();

const RELATIONSHIPS = new Set(["Aluno atual", "Professor", "Egresso"]);
const FINAL = new Set(["Pago", "Recusado", "Expirado", "Erro", "Revisão manual"]);
const RENEWABLE = new Set(["Recusado", "Expirado", "Erro"]);
const checkoutLimiter = rateLimit({ windowMs: 10 * 60_000, max: 30, message: "Muitas tentativas. Aguarde alguns minutos." });
const statusIpLimiter = rateLimit({ windowMs: 10 * 60_000, max: 2400, message: "Muitas consultas. Aguarde um instante.", keyFrom: clientIp });
const statusOrderLimiter = rateLimit({ windowMs: 10 * 60_000, max: 360, message: "Muitas consultas. Aguarde um instante.", keyFrom: (req) => `rocket:${req.params.registrationId}` });

function tokenSecret() {
  return process.env.ROCKET_TOKEN_SECRET || process.env.MERCADO_PAGO_WEBHOOK_SECRET || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "";
}
function registrationToken(id) {
  return crypto.createHmac("sha256", `rocket-token:${tokenSecret()}`).update(String(id)).digest("base64url").slice(0, 32);
}
function tokenMatches(id, candidate) {
  const expected = Buffer.from(registrationToken(id));
  const actual = Buffer.from(String(candidate || ""));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function idempotencyKey(id) {
  return crypto.createHmac("sha256", `rocket-idempotency:${tokenSecret()}`).update(id).digest("hex").slice(0, 48);
}
function createRegistrationId(now = new Date()) {
  const year = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(now);
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (const byte of crypto.randomBytes(8)) suffix += chars[byte % chars.length];
  return `${ORDER_PREFIX}${year}-${suffix}`;
}
function isRocketId(id) { return String(id || "").startsWith(ORDER_PREFIX); }
function normalizeText(value, max = 100) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max); }
function fold(value) {
  return normalizeText(value, 120).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function teamKey(value) { return fold(value); }
function validRa(value) { return /^[A-Za-z0-9./_-]{3,40}$/.test(normalizeText(value, 40)); }
function participantKey(player) {
  if (player.ra) return `ra:${fold(player.ra)}`;
  return `alt:${fold(player.nome)}|${fold(player.vinculo)}|${fold(player.identificacaoAlternativa)}`;
}
function canonicalPlayer(raw, label) {
  const nameError = validateFullName(raw?.nome);
  if (nameError) return { error: `${label}: ${nameError}` };
  const vinculo = normalizeText(raw?.vinculo, 30);
  if (!RELATIONSHIPS.has(vinculo)) return { error: `${label}: selecione um vínculo válido com a AMF.` };
  const ra = normalizeText(raw?.ra, 40);
  const identificacaoAlternativa = normalizeText(raw?.identificacaoAlternativa, 100);
  if (vinculo === "Aluno atual" && !ra) return { error: `${label}: informe o RA do aluno.` };
  if (ra && !validRa(ra)) return { error: `${label}: informe um RA válido.` };
  if (!ra && !identificacaoAlternativa) {
    return { error: `${label}: informe uma identificação AMF alternativa quando não houver RA.` };
  }
  const player = { nome: normalizeFullName(raw.nome), ra, vinculo, identificacaoAlternativa };
  player.chave = participantKey(player);
  return { player };
}

/** Validação e normalização do corpo que chega do navegador. */
export function parseRocketRegistration(body) {
  if (Date.now() > DEADLINE) return { error: "As inscrições foram encerradas em 10/10/2026.", field: "form" };
  const nomeEquipe = normalizeText(body?.nomeEquipe, 70);
  if (nomeEquipe.length < 2) return { error: "Informe o nome da equipe.", field: "nomeEquipe" };
  const captainError = validateFullName(body?.capitao?.nome);
  if (captainError) return { error: captainError, field: "capitao.nome" };
  const phoneError = validatePhone(body?.capitao?.whatsapp);
  if (phoneError) return { error: phoneError, field: "capitao.whatsapp" };
  const emailError = validateEmail(body?.capitao?.email);
  if (emailError) return { error: emailError, field: "capitao.email" };
  if (body?.aceiteRegulamento !== true) {
    return { error: "É necessário concordar com o Regulamento Oficial para seguir ao pagamento.", field: "aceiteRegulamento" };
  }
  const titular1 = canonicalPlayer(body?.jogadores?.[0], "Jogador 1");
  if (titular1.error) return { error: titular1.error, field: "jogadores.0" };
  const titular2 = canonicalPlayer(body?.jogadores?.[1], "Jogador 2");
  if (titular2.error) return { error: titular2.error, field: "jogadores.1" };
  const jogadores = [titular1.player, titular2.player];
  if (body?.temReserva) {
    const reserva = canonicalPlayer(body?.jogadores?.[2], "Jogador reserva");
    if (reserva.error) return { error: reserva.error, field: "jogadores.2" };
    jogadores.push(reserva.player);
  }
  if (new Set(jogadores.map((p) => p.chave)).size !== jogadores.length) {
    return { error: "Um mesmo participante não pode ocupar mais de uma posição na equipe.", field: "jogadores" };
  }
  return {
    data: {
      nomeEquipe, chaveEquipe: teamKey(nomeEquipe), jogadores,
      capitaoNome: normalizeFullName(body.capitao.nome), capitaoWhatsapp: normalizePhoneDigits(body.capitao.whatsapp),
      capitaoEmail: normalizeEmail(body.capitao.email), regulamentoVersao: ROCKET_REGULATION_VERSION,
      regulamentoAceitoEm: formatDateTime(), valorCents: ROCKET_AMOUNT_CENTS,
    },
  };
}

function statusFromMercadoPago(order) {
  const status = String(order.status || "").toLowerCase();
  const detail = String(order.statusDetail || "").toLowerCase();
  if (status === "processed" && detail === "accredited" && order.paymentStatus === "processed" && order.paymentStatusDetail === "accredited") return "Pago";
  if (status === "failed" || status === "cancelled" || status === "canceled") return "Recusado";
  if (status === "expired") return "Expirado";
  if (status === "processing") return "Processando";
  return "Pendente";
}
function applyOrder(registration, order) {
  let status = statusFromMercadoPago(order);
  if (registration.status === "Pendente" && registration.expiraEm && Date.parse(registration.expiraEm) <= Date.now() && status === "Pendente") status = "Expirado";
  const wrongMethod = order.metodoId && (order.metodoId !== "pix" || order.metodoTipo !== "bank_transfer");
  const wrongAmount = order.totalAmountCents !== ROCKET_AMOUNT_CENTS || (status === "Pago" && order.paidAmountCents !== ROCKET_AMOUNT_CENTS);
  if (wrongMethod || wrongAmount) status = "Revisão manual";
  return {
    status, orderMpId: order.orderId || registration.orderMpId, paymentMpId: order.paymentId || registration.paymentMpId,
    metodo: order.metodoId === "pix" ? "Pix" : (order.metodoId || registration.metodo),
    statusMp: [order.status, order.statusDetail].filter(Boolean).join(" / "),
    expiraEm: order.expiraEm || registration.expiraEm,
    valorPagoCents: order.paidAmountCents ?? registration.valorPagoCents,
    pagoEm: status === "Pago" ? (registration.pagoEm || formatDateTime()) : registration.pagoEm,
    observacoes: wrongMethod ? "Pagamento por método diferente do Pix; conferir no painel do Mercado Pago." : wrongAmount ? "Valor divergente; conferir no painel do Mercado Pago." : registration.observacoes,
  };
}
async function refreshRegistration(registration, { fresh = false } = {}) {
  if (!registration.orderMpId || FINAL.has(registration.status)) return registration;
  const order = lerOrder(await consultarOrder(registration.orderMpId));
  const changes = applyOrder(registration, order);
  const result = await updateRocketRegistration(registration.id, changes);
  return result.registration || { ...registration, ...changes };
}
function sameRegistration(record, data) {
  return record.chaveEquipe === data.chaveEquipe && record.capitaoEmail === data.capitaoEmail &&
    record.jogadores.length === data.jogadores.length && record.jogadores.every((p, i) => participantKey(p) === data.jogadores[i].chave);
}
function view(registration, seats = null, order = null) {
  return {
    ok: true, registrationId: registration.id, teamName: registration.nomeEquipe,
    participants: registration.jogadores.map((p) => ({ nome: p.nome, vinculo: p.vinculo })),
    status: registration.status, statusLabel: registration.status,
    confirmed: registration.status === "Pago", final: FINAL.has(registration.status), renewable: RENEWABLE.has(registration.status),
    amountCents: ROCKET_AMOUNT_CENTS, amount: formatBRL(ROCKET_AMOUNT_CENTS), paidAt: registration.pagoEm || null,
    expiresAt: registration.expiraEm || null, seatsRemaining: seats,
    pix: order && registration.status === "Pendente" && (order.qrCode || order.qrCodeBase64)
      ? { qrCode: order.qrCode || "", qrCodeBase64: order.qrCodeBase64 || "", expiresAt: order.expiraEm || registration.expiraEm || "" }
      : null,
  };
}
function mpError(res, error) {
  if (error?.code === "rate_limit") return res.status(429).json({ ok: false, error: "Muitas cobranças em andamento. Aguarde alguns segundos." });
  if (["sem_credencial", "credencial_invalida"].includes(error?.code)) return res.status(503).json({ ok: false, error: "Inscrições temporariamente indisponíveis." });
  return res.status(502).json({ ok: false, error: "Não foi possível abrir o pagamento agora. Tente novamente." });
}
function closingError(res) { return res.status(410).json({ ok: false, error: "As inscrições foram encerradas em 10/10/2026." }); }

async function createPix(registration) {
  const raw = await criarOrderPix({
    externalReference: registration.id, amountCents: ROCKET_AMOUNT_CENTS, payerEmail: registration.capitaoEmail,
    idempotencyKey: idempotencyKey(registration.id), expiracao: PIX_EXPIRATION,
  });
  const order = lerOrder(raw);
  const changes = applyOrder(registration, order);
  const result = await updateRocketRegistration(registration.id, changes);
  return { registration: result.registration || { ...registration, ...changes }, order };
}

function receiptPdf(registration) {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Comprovante Rocket League — ${registration.id}`, Author: "AASIAM" } });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  try { doc.image(fs.readFileSync(path.join(here, "assets", "logo-aasiam.png")), 48, 42, { width: 42 }); } catch { /* identidade textual ainda é suficiente */ }
  doc.fillColor("#116B36").font("Helvetica-Bold").fontSize(21).text("AASIAM", 102, 48);
  doc.fillColor("#101713").fontSize(18).text("Comprovante de inscrição", 48, 126);
  doc.font("Helvetica").fontSize(11).fillColor("#425147").text("Torneio Rocket League 2x2", 48, 155);
  doc.moveTo(48, 184).lineTo(547, 184).strokeColor("#C9D9CF").stroke();
  const line = (label, value) => { doc.font("Helvetica-Bold").fontSize(8).fillColor("#65766B").text(label.toUpperCase(), 48, doc.y + 17); doc.font("Helvetica").fontSize(12).fillColor("#101713").text(value, 48, doc.y + 4); };
  line("Equipe", registration.nomeEquipe); line("Código", registration.id); line("Participantes", registration.jogadores.map((p) => p.nome).join(" · "));
  line("Valor pago", formatBRL(ROCKET_AMOUNT_CENTS)); line("Pagamento confirmado em", registration.pagoEm || "—");
  doc.fontSize(9).fillColor("#65766B").text("Este comprovante é emitido após a confirmação do pagamento pelo Mercado Pago.", 48, 710, { width: 490 });
  doc.end();
  return finished;
}

export async function aplicarWebhookRocket(order) {
  if (!isRocketId(order.externalReference)) return { status: 200, body: { ok: true, ignored: "reference" } };
  const registration = await findRocketRegistration(order.externalReference, { fresh: true });
  if (!registration || (registration.orderMpId && registration.orderMpId !== order.orderId)) return { status: 200, body: { ok: true, ignored: "unknown" } };
  const result = await updateRocketRegistration(registration.id, applyOrder(registration, order));
  return { status: 200, body: { ok: true, confirmed: result.registration?.status === "Pago" } };
}

export function registerRocketRoutes(app) {
  app.get("/api/rocket-league/availability", async (_req, res) => {
    if (Date.now() > DEADLINE) return res.json({ ok: true, open: false, reason: "encerradas", seatsRemaining: 0, teamLimit: ROCKET_TEAM_LIMIT });
    try {
      const records = await activeRegistrations();
      const seats = rocketSeats(records);
      return res.json({ ok: true, open: seats > 0, reason: seats ? null : "esgotadas", seatsRemaining: seats, teamLimit: ROCKET_TEAM_LIMIT });
    } catch { return res.status(503).json({ ok: false, error: "Não foi possível consultar as vagas agora." }); }
  });

  app.post("/api/rocket-league/checkout", checkoutLimiter, async (req, res) => {
    const parsed = parseRocketRegistration(req.body);
    if (parsed.error) return res.status(parsed.field === "form" ? 410 : 400).json({ ok: false, error: parsed.error, field: parsed.field });
    if (!isMercadoPagoConfigured() || !isRocketSheetConfigured()) return res.status(503).json({ ok: false, error: "Inscrições temporariamente indisponíveis." });
    const data = parsed.data;
    try {
      const records = await activeRegistrations({ fresh: true });
      let existing = records.find((r) => sameRegistration(r, data));
      if (existing && !FINAL.has(existing.status)) {
        existing = await refreshRegistration(existing, { fresh: true });
        if (!FINAL.has(existing.status)) {
          const seats = rocketSeats(await activeRegistrations({ fresh: true }));
          const order = existing.orderMpId ? lerOrder(await consultarOrder(existing.orderMpId)) : null;
          return res.status(200).json({ ...view(existing, seats, order), token: registrationToken(existing.id), reused: true });
        }
      }
      const registration = await reserveRocketRegistration({ ...data, id: existing?.id || createRegistrationId() }, { existingId: existing?.id || "" });
      let charged;
      try { charged = await createPix(registration); }
      catch (error) {
        await updateRocketRegistration(registration.id, { status: "Erro", observacoes: "Falha ao criar a cobrança Pix no Mercado Pago." }).catch(() => {});
        throw error;
      }
      const seats = rocketSeats(await activeRegistrations({ fresh: true }));
      return res.status(201).json({ ...view(charged.registration, seats, charged.order), token: registrationToken(charged.registration.id), reused: false });
    } catch (error) {
      if (error?.code === "full") return res.status(409).json({ ok: false, error: "As 20 vagas estão reservadas ou confirmadas.", field: "form" });
      if (error?.code === "duplicate_team") return res.status(409).json({ ok: false, error: "Já existe uma inscrição ativa com este nome de equipe.", field: "nomeEquipe" });
      if (error?.code === "duplicate_player") return res.status(409).json({ ok: false, error: "Um participante já consta em outra equipe com inscrição ativa.", field: "jogadores" });
      if (error?.code === "sheets_not_configured") return res.status(503).json({ ok: false, error: "Inscrições temporariamente indisponíveis." });
      if (error instanceof MercadoPagoError) return mpError(res, error);
      console.error("[Rocket] falha no checkout:", error?.message || error);
      return res.status(502).json({ ok: false, error: "Não foi possível registrar a equipe. Tente novamente." });
    }
  });

  app.get("/api/rocket-league/inscricoes/:registrationId/status", statusIpLimiter, statusOrderLimiter, async (req, res) => {
    const id = String(req.params.registrationId || "").slice(0, 60);
    const token = req.get("X-Inscricao-Token") || "";
    if (!isRocketId(id) || !tokenMatches(id, token)) return res.status(404).json({ ok: false, error: "Inscrição não encontrada." });
    try {
      let registration = await findRocketRegistration(id);
      if (!registration) return res.status(404).json({ ok: false, error: "Inscrição não encontrada." });
      registration = await refreshRegistration(registration);
      const seats = rocketSeats(await activeRegistrations());
      let order = null;
      if (registration.status === "Pendente" && registration.orderMpId) order = lerOrder(await consultarOrder(registration.orderMpId));
      return res.json(view(registration, seats, order));
    } catch (error) {
      return error instanceof MercadoPagoError ? mpError(res, error) : res.status(502).json({ ok: false, error: "Não foi possível verificar o pagamento agora." });
    }
  });

  app.get("/api/rocket-league/inscricoes/:registrationId/comprovante.pdf", async (req, res) => {
    const id = String(req.params.registrationId || "").slice(0, 60);
    if (!isRocketId(id) || !tokenMatches(id, req.get("X-Inscricao-Token") || "")) return res.status(404).json({ ok: false, error: "Inscrição não encontrada." });
    const registration = await findRocketRegistration(id);
    if (!registration || registration.status !== "Pago") return res.status(409).json({ ok: false, error: "O comprovante fica disponível após a confirmação do pagamento." });
    const pdf = await receiptPdf(registration);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="comprovante-rocket-${id}.pdf"`);
    res.send(pdf);
  });

  app.post(ROCKET_WEBHOOK_PATH, async (req, res) => {
    const id = String(req.body?.data?.id || req.body?.id || "").slice(0, 80);
    const signature = validarAssinaturaWebhook({ xSignature: req.get("x-signature"), xRequestId: req.get("x-request-id"), dataId: id });
    if (!signature.ok) return res.status(401).json({ ok: false });
    try { return res.status((await aplicarWebhookRocket(lerOrder(await consultarOrder(id)))).status).json({ ok: true }); }
    catch { return res.status(500).json({ ok: false }); }
  });
}
