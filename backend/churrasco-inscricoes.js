/**
 * Persistência das inscrições do churrasco — Google Sheets.
 *
 * A planilha é o registro durável: `orderCache` do e-commerce é memória e some
 * quando o Render reinicia, então nada aqui depende dele. Uma inscrição ocupa
 * UMA linha durante toda a vida dela — o webhook localiza a linha pela
 * referência externa e atualiza no lugar, nunca acrescenta.
 *
 * Reaproveita os helpers de autenticação e de aba de `google-sheets.js`, os
 * mesmos usados pela aba de pedidos da loja.
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

import {
  PROVEDOR,
  STATUS_PAGO,
  STATUS_PENDENTE,
  formatBRL,
  normalizeEmail,
  priceCentsForCourse,
  statusFromLabel,
  statusLabel,
} from "./shared/churrasco.js";

export const CHURRASCO_SHEET_NAME =
  process.env.CHURRASCO_SHEET_NAME || "Inscrições Churrasco";

/**
 * Colunas A–T.
 *
 * A–O são as colunas que já existiam e as posições não mudaram, para que as
 * linhas antigas continuem alinhadas com o cabeçalho. Só J e K trocaram de
 * rótulo (guardavam identificadores da InfinitePay e agora guardam os do
 * Mercado Pago); P–T foram acrescentadas no fim.
 */
export const CHURRASCO_SHEET_HEADERS = [
  "Data da inscrição",              // A
  "ID da inscrição",                // B — external_reference
  "Nome",                           // C
  "Telefone",                       // D
  "Curso",                          // E
  "Categoria",                      // F
  "Valor",                          // G — valor esperado, recalculado do curso
  "Status",                         // H
  "Método de pagamento",            // I
  "ID da order (Mercado Pago)",     // J
  "ID do pagamento (Mercado Pago)", // K
  "URL do comprovante",             // L — ticket_url
  "Data do pagamento",              // M
  "Última atualização",             // N
  "Observações",                    // O
  "E-mail",                         // P
  "Provedor",                       // Q
  "Valor pago",                     // R
  "Status Mercado Pago",            // S — "status / status_detail"
  "Pix expira em",                  // T
];

const COL = {
  criadaEm: 0,
  id: 1,
  nome: 2,
  telefone: 3,
  curso: 4,
  categoria: 5,
  valor: 6,
  status: 7,
  metodo: 8,
  orderMpId: 9,
  paymentMpId: 10,
  ticketUrl: 11,
  pagoEm: 12,
  atualizadoEm: 13,
  observacoes: 14,
  email: 15,
  provedor: 16,
  valorPago: 17,
  statusMp: 18,
  expiraEm: 19,
};

const LAST_COLUMN = columnLetter(CHURRASCO_SHEET_HEADERS.length);
const FIRST_DATA_ROW = 2;

/** Caracteres de controle — montado por escapes para não sujar o arquivo. */
const CONTROLE_RE = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

/**
 * Neutraliza formula injection e caracteres de controle. Junto com
 * `valueInputOption: "RAW"`, garante que nada digitado no formulário seja
 * interpretado como fórmula pelo Google Sheets.
 */
function sheetSafe(value, maxLength = 200) {
  return String(value ?? "")
    .replace(CONTROLE_RE, " ")
    .replace(/^[=+\-@]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function isChurrascoSheetConfigured() {
  return isGoogleSheetsConfigured();
}

function spreadsheetId() {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
}

/* ─── Cache curto da tabela ────────────────────────────────────────────
   A tela do Pix consulta o status a cada poucos segundos. Sem cache, cada
   consulta viraria uma leitura na API do Sheets. É invalidado a cada
   gravação, e as leituras que precisam enxergar a linha mais recente pedem
   `fresh`. */
const TABLE_TTL_MS = 10_000;
let tableCache = null; // { at, rows }

function invalidateTable() {
  tableCache = null;
}

let sheetReady = false;

async function ensureSheet(sheets) {
  if (sheetReady) return;
  await ensureSheetExists(sheets, spreadsheetId(), CHURRASCO_SHEET_NAME);
  await ensureSheetHeader(sheets, spreadsheetId(), CHURRASCO_SHEET_NAME, CHURRASCO_SHEET_HEADERS);
  sheetReady = true;
}

async function readTable(sheets, { fresh = false } = {}) {
  if (!fresh && tableCache && Date.now() - tableCache.at < TABLE_TTL_MS) {
    return tableCache.rows;
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${quoteSheetName(CHURRASCO_SHEET_NAME)}!A${FIRST_DATA_ROW}:${LAST_COLUMN}`,
  });
  const rows = res.data.values || [];
  tableCache = { at: Date.now(), rows };
  return rows;
}

/** "R$ 25,00" → 2500. Só para exibição; a regra vem sempre do Mercado Pago. */
function centsDaPlanilha(texto) {
  const digitos = String(texto || "").replace(/\D/g, "");
  return digitos ? Number(digitos) : null;
}

/** Linha da planilha → objeto da inscrição. O valor é sempre recalculado. */
function rowToInscricao(row, rowNumber) {
  const curso = row[COL.curso] || "";
  return {
    rowNumber,
    criadaEm: row[COL.criadaEm] || "",
    id: row[COL.id] || "",
    nome: row[COL.nome] || "",
    telefone: row[COL.telefone] || "",
    curso,
    categoria: row[COL.categoria] || "",
    // Recalculado do curso: o número gravado nunca vira regra de negócio.
    valorCents: priceCentsForCourse(curso),
    statusLabel: row[COL.status] || "",
    status: statusFromLabel(row[COL.status]),
    metodo: row[COL.metodo] || "",
    orderMpId: row[COL.orderMpId] || "",
    paymentMpId: row[COL.paymentMpId] || "",
    ticketUrl: row[COL.ticketUrl] || "",
    pagoEm: row[COL.pagoEm] || "",
    atualizadoEm: row[COL.atualizadoEm] || "",
    observacoes: row[COL.observacoes] || "",
    email: row[COL.email] || "",
    provedor: row[COL.provedor] || "",
    valorPagoCents: centsDaPlanilha(row[COL.valorPago]),
    statusMp: row[COL.statusMp] || "",
    expiraEm: row[COL.expiraEm] || "",
  };
}

function inscricaoToRow(inscricao) {
  const row = new Array(CHURRASCO_SHEET_HEADERS.length).fill("");
  row[COL.criadaEm] = sheetSafe(inscricao.criadaEm, 40);
  row[COL.id] = sheetSafe(inscricao.id, 40);
  row[COL.nome] = sheetSafe(inscricao.nome, 80);
  row[COL.telefone] = sheetSafe(inscricao.telefone, 15);
  row[COL.curso] = sheetSafe(inscricao.curso, 60);
  row[COL.categoria] = sheetSafe(inscricao.categoria, 30);
  row[COL.valor] = sheetSafe(formatBRL(inscricao.valorCents), 20);
  row[COL.status] = sheetSafe(statusLabel(inscricao.status), 30);
  row[COL.metodo] = sheetSafe(inscricao.metodo, 30);
  row[COL.orderMpId] = sheetSafe(inscricao.orderMpId, 60);
  row[COL.paymentMpId] = sheetSafe(inscricao.paymentMpId, 60);
  row[COL.ticketUrl] = sheetSafe(inscricao.ticketUrl, 300);
  row[COL.pagoEm] = sheetSafe(inscricao.pagoEm, 40);
  row[COL.atualizadoEm] = sheetSafe(inscricao.atualizadoEm, 40);
  row[COL.observacoes] = sheetSafe(inscricao.observacoes, 300);
  row[COL.email] = sheetSafe(inscricao.email, 120);
  row[COL.provedor] = sheetSafe(inscricao.provedor || PROVEDOR, 30);
  row[COL.valorPago] =
    inscricao.valorPagoCents === null || inscricao.valorPagoCents === undefined
      ? ""
      : sheetSafe(formatBRL(inscricao.valorPagoCents), 20);
  row[COL.statusMp] = sheetSafe(inscricao.statusMp, 60);
  row[COL.expiraEm] = sheetSafe(inscricao.expiraEm, 40);
  return row;
}

/* ─── Fila de escrita ──────────────────────────────────────────────────
   O Mercado Pago reenvia webhooks e o navegador consulta em paralelo.
   Serializar as gravações garante que a segunda enxergue a linha criada pela
   primeira e atualize em vez de duplicar. */
let writeQueue = Promise.resolve();

function serialize(work) {
  const next = writeQueue.then(work, work);
  // Mantém a fila viva mesmo quando uma gravação falha.
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function locate(sheets, id, { fresh = false } = {}) {
  const rows = await readTable(sheets, { fresh });
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][COL.id] === id) return { row: rows[i], rowNumber: FIRST_DATA_ROW + i };
  }
  return null;
}

function exigirPlanilha() {
  if (isChurrascoSheetConfigured()) return;
  const err = new Error("sheets_not_configured");
  err.code = "sheets_not_configured";
  throw err;
}

/** Busca uma inscrição pela referência externa. */
export async function findInscricao(id, { fresh = false } = {}) {
  if (!isChurrascoSheetConfigured() || !id) return null;
  const sheets = createSheetsClient();
  await ensureSheet(sheets);
  const hit = await locate(sheets, id, { fresh });
  return hit ? rowToInscricao(hit.row, hit.rowNumber) : null;
}

/**
 * Busca a inscrição da mesma pessoa no mesmo curso.
 *
 * É o que impede que um duplo clique, um F5 ou um restart do backend virem
 * duas linhas e duas cobranças: a segunda tentativa reencontra a primeira.
 * Quando há mais de uma (linhas antigas), vale a última.
 */
export async function findInscricaoPorPessoa(email, curso, { fresh = false } = {}) {
  if (!isChurrascoSheetConfigured()) return null;
  const alvo = normalizeEmail(email);
  if (!alvo || !curso) return null;

  const sheets = createSheetsClient();
  await ensureSheet(sheets);
  const rows = await readTable(sheets, { fresh });

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (normalizeEmail(row[COL.email]) === alvo && (row[COL.curso] || "") === curso) {
      return rowToInscricao(row, FIRST_DATA_ROW + i);
    }
  }
  return null;
}

/** Cria a linha pendente. Chamada ANTES de criar a order no Mercado Pago. */
export async function criarInscricaoPendente(dados) {
  exigirPlanilha();

  const agora = formatDateTime();
  const inscricao = {
    criadaEm: agora,
    id: dados.id,
    nome: dados.nome,
    telefone: dados.telefone,
    curso: dados.curso,
    categoria: dados.categoria,
    valorCents: dados.valorCents,
    status: STATUS_PENDENTE,
    metodo: "",
    orderMpId: "",
    paymentMpId: "",
    ticketUrl: "",
    pagoEm: "",
    atualizadoEm: agora,
    observacoes: dados.observacoes || "",
    email: dados.email,
    provedor: PROVEDOR,
    valorPagoCents: null,
    statusMp: "",
    expiraEm: "",
  };

  return serialize(async () => {
    const sheets = createSheetsClient();
    await ensureSheet(sheets);

    // Um retry do navegador não pode virar duas linhas.
    const existente = await locate(sheets, inscricao.id, { fresh: true });
    if (existente) return rowToInscricao(existente.row, existente.rowNumber);

    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId(),
      range: `${quoteSheetName(CHURRASCO_SHEET_NAME)}!A:${LAST_COLUMN}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [inscricaoToRow(inscricao)] },
    });
    invalidateTable();
    return inscricao;
  });
}

/**
 * Atualiza a linha existente. Recebe só os campos que mudaram.
 * Devolve `{ inscricao, gravou }` — `gravou: false` quando nada mudou, que é
 * o caso de um webhook reenviado.
 *
 * Uma inscrição já confirmada nunca volta atrás: o status "Pago" e a data do
 * pagamento ficam onde estão, aconteça o que acontecer depois.
 */
export async function atualizarInscricao(id, mudancas) {
  exigirPlanilha();

  return serialize(async () => {
    const sheets = createSheetsClient();
    await ensureSheet(sheets);

    const existente = await locate(sheets, id, { fresh: true });
    if (!existente) return { inscricao: null, gravou: false };

    const atual = rowToInscricao(existente.row, existente.rowNumber);
    const atualizada = { ...atual, ...mudancas };

    if (atual.status === STATUS_PAGO) {
      atualizada.status = STATUS_PAGO;
      atualizada.pagoEm = atual.pagoEm || atualizada.pagoEm;
    }

    // Compara o que de fato vai para a planilha: se a linha não muda, não
    // gastamos uma escrita (é o reenvio do mesmo webhook).
    const linhaAtual = inscricaoToRow({ ...atual, atualizadoEm: "" });
    const linhaNova = inscricaoToRow({ ...atualizada, atualizadoEm: "" });
    if (linhaAtual.join("") === linhaNova.join("")) {
      return { inscricao: atual, gravou: false };
    }

    atualizada.atualizadoEm = formatDateTime();

    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: `${quoteSheetName(CHURRASCO_SHEET_NAME)}!A${existente.rowNumber}:${LAST_COLUMN}${existente.rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [inscricaoToRow(atualizada)] },
    });
    invalidateTable();

    return { inscricao: atualizada, gravou: true };
  });
}
