/**
 * Registro durável do Torneio Rocket League 2x2.
 *
 * A planilha é deliberadamente separada das inscrições do churrasco e dos
 * pedidos da loja. Uma linha representa uma equipe e é criada antes da order
 * do Mercado Pago, portanto uma notificação nunca fica sem inscrição.
 */
import {
  columnLetter,
  createSheetsClient,
  ensureSheetExists,
  ensureSheetHeader,
  formatDateTime,
  isGoogleSheetsConfigured,
  quoteSheetName,
} from "./google-sheets.js";

export const ROCKET_SHEET_NAME = process.env.ROCKET_SHEET_NAME || "Torneio Rocket League 2026";
export const ROCKET_TEAM_LIMIT = 20;

export const ROCKET_SHEET_HEADERS = [
  "Data da inscrição", "ID da inscrição", "Nome da equipe", "Chave da equipe", "Status",
  "Nome do capitão", "WhatsApp do capitão", "E-mail do capitão", "Jogador 1", "RA 1",
  "Vínculo 1", "Identificação alternativa 1", "Jogador 2", "RA 2", "Vínculo 2",
  "Identificação alternativa 2", "Reserva", "RA reserva", "Vínculo reserva",
  "Identificação alternativa reserva", "Versão do regulamento aceita", "Data/hora do aceite",
  "Valor", "Método de pagamento", "ID da order (Mercado Pago)", "ID do pagamento (Mercado Pago)",
  "Data do pagamento", "Valor pago", "Status Mercado Pago", "Pix expira em", "Última atualização",
  "Observações",
];

const COL = Object.freeze({
  criadaEm: 0, id: 1, nomeEquipe: 2, chaveEquipe: 3, status: 4, capitaoNome: 5,
  capitaoWhatsapp: 6, capitaoEmail: 7, jogador1Nome: 8, jogador1Ra: 9, jogador1Vinculo: 10,
  jogador1Alternativa: 11, jogador2Nome: 12, jogador2Ra: 13, jogador2Vinculo: 14,
  jogador2Alternativa: 15, reservaNome: 16, reservaRa: 17, reservaVinculo: 18,
  reservaAlternativa: 19, regulamentoVersao: 20, regulamentoAceitoEm: 21, valor: 22,
  metodo: 23, orderMpId: 24, paymentMpId: 25, pagoEm: 26, valorPago: 27, statusMp: 28,
  expiraEm: 29, atualizadoEm: 30, observacoes: 31,
});

const FIRST_DATA_ROW = 2;
const LAST_COLUMN = columnLetter(ROCKET_SHEET_HEADERS.length);
const CONTROL_RE = new RegExp("[\\u0000-\\u001f\\u007f]", "g");
const STATUS_LABELS = new Set(["Pendente", "Processando", "Pago", "Recusado", "Expirado", "Erro", "Revisão manual"]);

function clean(value, max = 300) {
  return String(value ?? "")
    .replace(CONTROL_RE, " ")
    .replace(/^[=+\-@]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function isRocketSheetConfigured() {
  return isGoogleSheetsConfigured();
}

function spreadsheetId() { return process.env.GOOGLE_SHEETS_SPREADSHEET_ID; }

let ready = false;
let cache = null;
let writeQueue = Promise.resolve();

async function ensureSheet(sheets) {
  if (ready) return;
  await ensureSheetExists(sheets, spreadsheetId(), ROCKET_SHEET_NAME);
  await ensureSheetHeader(sheets, spreadsheetId(), ROCKET_SHEET_NAME, ROCKET_SHEET_HEADERS);
  ready = true;
}

async function readRows(sheets, { fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 5_000) return cache.rows;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${quoteSheetName(ROCKET_SHEET_NAME)}!A${FIRST_DATA_ROW}:${LAST_COLUMN}`,
  });
  const rows = response.data.values || [];
  cache = { at: Date.now(), rows };
  return rows;
}

function invalidate() { cache = null; }
function serialize(work) {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

function statusFromLabel(label) {
  const value = String(label || "").trim();
  return STATUS_LABELS.has(value) ? value : "Pendente";
}

function centsFromSheet(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

function player(row, offset) {
  const value = {
    nome: row[offset] || "",
    ra: row[offset + 1] || "",
    vinculo: row[offset + 2] || "",
    identificacaoAlternativa: row[offset + 3] || "",
  };
  const fold = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  value.chave = value.ra
    ? `ra:${fold(value.ra)}`
    : `alt:${fold(value.nome)}|${fold(value.vinculo)}|${fold(value.identificacaoAlternativa)}`;
  return value;
}

function toRecord(row, rowNumber) {
  return {
    rowNumber,
    criadaEm: row[COL.criadaEm] || "", id: row[COL.id] || "", nomeEquipe: row[COL.nomeEquipe] || "",
    chaveEquipe: row[COL.chaveEquipe] || "", status: statusFromLabel(row[COL.status]),
    capitaoNome: row[COL.capitaoNome] || "", capitaoWhatsapp: row[COL.capitaoWhatsapp] || "",
    capitaoEmail: row[COL.capitaoEmail] || "", jogadores: [
      player(row, COL.jogador1Nome), player(row, COL.jogador2Nome), player(row, COL.reservaNome),
    ].filter((p) => p.nome),
    regulamentoVersao: row[COL.regulamentoVersao] || "", regulamentoAceitoEm: row[COL.regulamentoAceitoEm] || "",
    valorCents: centsFromSheet(row[COL.valor]) ?? 5000, metodo: row[COL.metodo] || "",
    orderMpId: row[COL.orderMpId] || "", paymentMpId: row[COL.paymentMpId] || "", pagoEm: row[COL.pagoEm] || "",
    valorPagoCents: centsFromSheet(row[COL.valorPago]), statusMp: row[COL.statusMp] || "",
    expiraEm: row[COL.expiraEm] || "", atualizadoEm: row[COL.atualizadoEm] || "", observacoes: row[COL.observacoes] || "",
  };
}

function money(cents) { return `R$ ${(Number(cents || 0) / 100).toFixed(2).replace(".", ",")}`; }

function toRow(record) {
  const row = new Array(ROCKET_SHEET_HEADERS.length).fill("");
  row[COL.criadaEm] = clean(record.criadaEm, 40); row[COL.id] = clean(record.id, 50);
  row[COL.nomeEquipe] = clean(record.nomeEquipe, 70); row[COL.chaveEquipe] = clean(record.chaveEquipe, 80);
  row[COL.status] = clean(record.status, 30); row[COL.capitaoNome] = clean(record.capitaoNome, 80);
  row[COL.capitaoWhatsapp] = clean(record.capitaoWhatsapp, 15); row[COL.capitaoEmail] = clean(record.capitaoEmail, 120);
  const players = record.jogadores || [];
  for (const [index, offset] of [COL.jogador1Nome, COL.jogador2Nome, COL.reservaNome].entries()) {
    const p = players[index] || {};
    row[offset] = clean(p.nome, 80); row[offset + 1] = clean(p.ra, 40); row[offset + 2] = clean(p.vinculo, 30);
    row[offset + 3] = clean(p.identificacaoAlternativa, 100);
  }
  row[COL.regulamentoVersao] = clean(record.regulamentoVersao, 100);
  row[COL.regulamentoAceitoEm] = clean(record.regulamentoAceitoEm, 40);
  row[COL.valor] = money(record.valorCents); row[COL.metodo] = clean(record.metodo, 30);
  row[COL.orderMpId] = clean(record.orderMpId, 70); row[COL.paymentMpId] = clean(record.paymentMpId, 70);
  row[COL.pagoEm] = clean(record.pagoEm, 40);
  row[COL.valorPago] = record.valorPagoCents == null ? "" : money(record.valorPagoCents);
  row[COL.statusMp] = clean(record.statusMp, 80); row[COL.expiraEm] = clean(record.expiraEm, 40);
  row[COL.atualizadoEm] = clean(record.atualizadoEm, 40); row[COL.observacoes] = clean(record.observacoes, 300);
  return row;
}

function locate(rows, id) {
  const index = rows.findIndex((row) => row[COL.id] === id);
  return index < 0 ? null : { row: rows[index], rowNumber: FIRST_DATA_ROW + index };
}

export function reservationActive(record, now = Date.now()) {
  if (["Pago", "Processando", "Revisão manual"].includes(record.status)) return true;
  if (record.status !== "Pendente") return false;
  const expiration = Date.parse(record.expiraEm);
  return Number.isNaN(expiration) || expiration > now;
}

function duplicatePlayerKeys(record) {
  return new Set((record.jogadores || []).map((p) => p.chave).filter(Boolean));
}

/** Todos os participantes das reservas ativas, para a validação da rota. */
export async function activeRegistrations({ fresh = false } = {}) {
  if (!isRocketSheetConfigured()) return [];
  const sheets = createSheetsClient();
  await ensureSheet(sheets);
  const rows = await readRows(sheets, { fresh });
  return rows.map((row, index) => toRecord(row, FIRST_DATA_ROW + index));
}

export async function findRocketRegistration(id, { fresh = false } = {}) {
  if (!id || !isRocketSheetConfigured()) return null;
  const sheets = createSheetsClient();
  await ensureSheet(sheets);
  const hit = locate(await readRows(sheets, { fresh }), id);
  return hit ? toRecord(hit.row, hit.rowNumber) : null;
}

/**
 * Reserva uma vaga e grava a equipe na mesma seção crítica. As requisições
 * concorrentes tratadas por esta instância entram em uma fila; só as 20
 * primeiras reservas ativas chegam a criar cobrança.
 */
export async function reserveRocketRegistration(data, { existingId = "" } = {}) {
  if (!isRocketSheetConfigured()) {
    const error = new Error("sheets_not_configured"); error.code = "sheets_not_configured"; throw error;
  }
  return serialize(async () => {
    const sheets = createSheetsClient();
    await ensureSheet(sheets);
    const rows = await readRows(sheets, { fresh: true });
    const records = rows.map((row, index) => toRecord(row, FIRST_DATA_ROW + index));
    const current = existingId ? records.find((r) => r.id === existingId) : null;
    const now = Date.now();
    const active = records.filter((r) => r.id !== existingId && reservationActive(r, now));

    const sameTeam = active.find((r) => r.chaveEquipe === data.chaveEquipe);
    if (sameTeam) {
      const error = new Error("duplicate_team"); error.code = "duplicate_team"; throw error;
    }

    const occupiedPlayers = new Set();
    for (const r of active) for (const p of r.jogadores) if (p.chave) occupiedPlayers.add(p.chave);
    if (data.jogadores.some((p) => occupiedPlayers.has(p.chave))) {
      const error = new Error("duplicate_player"); error.code = "duplicate_player"; throw error;
    }
    if (active.length >= ROCKET_TEAM_LIMIT) {
      const error = new Error("full"); error.code = "full"; throw error;
    }

    const record = {
      ...(current || {}), ...data,
      id: current?.id || data.id,
      criadaEm: current?.criadaEm || formatDateTime(), status: "Pendente", metodo: "",
      // A reserva expira mesmo se o processo cair entre gravar a linha e a
      // resposta do Mercado Pago. Quando a order volta, esta estimativa é
      // substituída pela validade oficial devolvida pelo provedor.
      orderMpId: "", paymentMpId: "", pagoEm: "", valorPagoCents: null, statusMp: "",
      expiraEm: new Date(Date.now() + 30 * 60_000).toISOString(),
      atualizadoEm: formatDateTime(), observacoes: "",
    };
    if (current) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId(), range: `${quoteSheetName(ROCKET_SHEET_NAME)}!A${current.rowNumber}:${LAST_COLUMN}${current.rowNumber}`,
        valueInputOption: "RAW", requestBody: { values: [toRow(record)] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId(), range: `${quoteSheetName(ROCKET_SHEET_NAME)}!A:${LAST_COLUMN}`,
        valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: [toRow(record)] },
      });
    }
    invalidate();
    return record;
  });
}

export async function updateRocketRegistration(id, changes) {
  if (!isRocketSheetConfigured()) throw new Error("sheets_not_configured");
  return serialize(async () => {
    const sheets = createSheetsClient();
    await ensureSheet(sheets);
    const rows = await readRows(sheets, { fresh: true });
    const hit = locate(rows, id);
    if (!hit) return { registration: null, wrote: false };
    const previous = toRecord(hit.row, hit.rowNumber);
    const next = { ...previous, ...changes, jogadores: changes.jogadores || previous.jogadores };
    // A confirmação não regride se o Mercado Pago reenviar uma atualização antiga.
    if (previous.status === "Pago") {
      next.status = "Pago";
      next.pagoEm = previous.pagoEm || next.pagoEm;
    }

    /* Uma cobrança que chega depois de a reserva ter expirado não pode criar
       a 21ª confirmação. Como esta verificação e a escrita passam pela mesma
       fila, duas confirmações simultâneas enxergam uma à outra. O pagamento
       não é descartado: fica em revisão para a organização tratar no painel. */
    if (next.status === "Pago" && previous.status !== "Pago") {
      const ocupadasPorOutras = rows
        .map((row, index) => toRecord(row, FIRST_DATA_ROW + index))
        .filter((record) => record.id !== id && reservationActive(record)).length;
      if (ocupadasPorOutras >= ROCKET_TEAM_LIMIT) {
        next.status = "Revisão manual";
        next.pagoEm = previous.pagoEm;
        next.observacoes = "Pagamento recebido após a vaga expirar; limite de 20 equipes já preenchido. Conferir no painel do Mercado Pago.";
      }
    }
    if (toRow({ ...previous, atualizadoEm: "" }).join("\u0001") === toRow({ ...next, atualizadoEm: "" }).join("\u0001")) {
      return { registration: previous, wrote: false };
    }
    next.atualizadoEm = formatDateTime();
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId(), range: `${quoteSheetName(ROCKET_SHEET_NAME)}!A${hit.rowNumber}:${LAST_COLUMN}${hit.rowNumber}`,
      valueInputOption: "RAW", requestBody: { values: [toRow(next)] },
    });
    invalidate();
    return { registration: next, wrote: true };
  });
}

export function rocketSeats(records, now = Date.now()) {
  return Math.max(0, ROCKET_TEAM_LIMIT - records.filter((record) => reservationActive(record, now)).length);
}
