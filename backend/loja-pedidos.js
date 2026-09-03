/**
 * Persistência dos pedidos da LOJA pagos pelo Mercado Pago — Google Sheets.
 *
 * Mesmo padrão das inscrições do churrasco (`churrasco-inscricoes.js`): a
 * planilha é o registro durável, o `orderCache` em memória do e-commerce não é
 * usado aqui, uma linha nasce ANTES da cobrança e é atualizada no lugar pelo
 * webhook — nunca acrescentada.
 *
 * A diferença para o churrasco: aqui a linha guarda um SNAPSHOT FINANCEIRO
 * congelado (subtotal, taxa aplicada, acréscimo, total cobrado). Se a taxa do
 * Mercado Pago mudar amanhã, um pedido antigo continua mostrando exatamente
 * quanto foi cobrado. Por isso os valores são LIDOS da planilha, não
 * recalculados.
 *
 * Reaproveita os helpers de autenticação e de aba de `google-sheets.js`.
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
  STATUS_PAGO,
  STATUS_PENDENTE,
  formatBRL,
  statusFromLabel,
  statusLabel,
} from "./shared/churrasco.js";

export const LOJA_SHEET_NAME = process.env.LOJA_SHEET_NAME || "Pedidos Loja";

/** Rótulo do meio de pagamento gravado na planilha. */
const METODO_LABEL = { credit_card: "Cartão de crédito", pix: "Pix" };

/**
 * Colunas A–U. Uma linha por pedido, criada como "Pendente" e atualizada no
 * lugar. As colunas de dinheiro guardam BRL formatado (para a organização ler)
 * e os centavos são recuperados por texto — nunca por ponto flutuante.
 */
export const LOJA_SHEET_HEADERS = [
  "Data do pedido", // A
  "ID do pedido", // B — external_reference sem o prefixo LOJA-
  "Nome", // C
  "Telefone", // D
  "E-mail", // E
  "Itens", // F
  "Subtotal", // G — líquido desejado pela Atlética
  "Forma de pagamento", // H
  "Parcelas", // I
  "Taxa aplicada (bps)", // J — pontos-base congelados neste pedido
  "Acréscimo do pagamento", // K
  "Total cobrado", // L
  "Status", // M
  "ID da order (Mercado Pago)", // N
  "ID do pagamento (Mercado Pago)", // O
  "Status Mercado Pago", // P — "status / status_detail"
  "Data do pagamento", // Q
  "Última atualização", // R
  "Observações", // S
  "Tamanho da camiseta", // T — uma linha por item que tenha camiseta
  "Tamanho do calção", // U — vazio para itens de uma peça
];

const COL = {
  criadoEm: 0,
  id: 1,
  nome: 2,
  telefone: 3,
  email: 4,
  itens: 5,
  subtotal: 6,
  metodo: 7,
  parcelas: 8,
  taxaBps: 9,
  acrescimo: 10,
  total: 11,
  status: 12,
  orderMpId: 13,
  paymentMpId: 14,
  statusMp: 15,
  pagoEm: 16,
  atualizadoEm: 17,
  observacoes: 18,
  shirtSizes: 19,
  shortsSizes: 20,
};

const LAST_COLUMN = columnLetter(LOJA_SHEET_HEADERS.length);
const FIRST_DATA_ROW = 2;

const CONTROLE_RE = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

/** Neutraliza formula injection + caracteres de controle (com `RAW`). */
function sheetSafe(value, maxLength = 200) {
  return String(value ?? "")
    .replace(CONTROLE_RE, " ")
    .replace(/^[=+\-@]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** "R$ 105,24" → 10524. `null` quando não há dígitos. */
function centsDaPlanilha(texto) {
  const digitos = String(texto || "").replace(/\D/g, "");
  return digitos ? Number(digitos) : null;
}

function inteiroDaPlanilha(texto) {
  const n = Number.parseInt(String(texto || "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function isLojaSheetConfigured() {
  return isGoogleSheetsConfigured();
}

function spreadsheetId() {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
}

/* ─── Cache curto da tabela ────────────────────────────────────────────── */
const TABLE_TTL_MS = 10_000;
let tableCache = null;

function invalidateTable() {
  tableCache = null;
}

let sheetReady = false;

async function ensureSheet(sheets) {
  if (sheetReady) return;
  await ensureSheetExists(sheets, spreadsheetId(), LOJA_SHEET_NAME);
  await ensureSheetHeader(sheets, spreadsheetId(), LOJA_SHEET_NAME, LOJA_SHEET_HEADERS);
  sheetReady = true;
}

async function readTable(sheets, { fresh = false } = {}) {
  if (!fresh && tableCache && Date.now() - tableCache.at < TABLE_TTL_MS) {
    return tableCache.rows;
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${quoteSheetName(LOJA_SHEET_NAME)}!A${FIRST_DATA_ROW}:${LAST_COLUMN}`,
  });
  const rows = res.data.values || [];
  tableCache = { at: Date.now(), rows };
  return rows;
}

/** Linha da planilha → objeto do pedido. O dinheiro é lido, nunca recalculado. */
function rowToPedido(row, rowNumber) {
  return {
    rowNumber,
    criadoEm: row[COL.criadoEm] || "",
    id: row[COL.id] || "",
    nome: row[COL.nome] || "",
    telefone: row[COL.telefone] || "",
    email: row[COL.email] || "",
    itens: row[COL.itens] || "",
    subtotalCents: centsDaPlanilha(row[COL.subtotal]),
    paymentMethod: row[COL.metodo] === METODO_LABEL.pix ? "pix" : "credit_card",
    installments: inteiroDaPlanilha(row[COL.parcelas]) || 1,
    feeBps: inteiroDaPlanilha(row[COL.taxaBps]) ?? 0,
    paymentFeeCents: centsDaPlanilha(row[COL.acrescimo]) ?? 0,
    totalChargedCents: centsDaPlanilha(row[COL.total]),
    statusLabel: row[COL.status] || "",
    status: statusFromLabel(row[COL.status]),
    orderMpId: row[COL.orderMpId] || "",
    paymentMpId: row[COL.paymentMpId] || "",
    statusMp: row[COL.statusMp] || "",
    pagoEm: row[COL.pagoEm] || "",
    atualizadoEm: row[COL.atualizadoEm] || "",
    observacoes: row[COL.observacoes] || "",
    shirtSizes: row[COL.shirtSizes] || "",
    shortsSizes: row[COL.shortsSizes] || "",
  };
}

function pedidoToRow(pedido) {
  const row = new Array(LOJA_SHEET_HEADERS.length).fill("");
  row[COL.criadoEm] = sheetSafe(pedido.criadoEm, 40);
  row[COL.id] = sheetSafe(pedido.id, 40);
  row[COL.nome] = sheetSafe(pedido.nome, 80);
  row[COL.telefone] = sheetSafe(pedido.telefone, 20);
  row[COL.email] = sheetSafe(pedido.email, 120);
  row[COL.itens] = sheetSafe(pedido.itens, 500);
  row[COL.subtotal] = sheetSafe(formatBRL(pedido.subtotalCents), 20);
  row[COL.metodo] = sheetSafe(METODO_LABEL[pedido.paymentMethod] || pedido.paymentMethod, 30);
  row[COL.parcelas] = sheetSafe(pedido.paymentMethod === "pix" ? "—" : `${pedido.installments}x`, 10);
  row[COL.taxaBps] = sheetSafe(String(pedido.feeBps ?? 0), 10);
  row[COL.acrescimo] = sheetSafe(formatBRL(pedido.paymentFeeCents ?? 0), 20);
  row[COL.total] = sheetSafe(formatBRL(pedido.totalChargedCents), 20);
  row[COL.status] = sheetSafe(statusLabel(pedido.status), 30);
  row[COL.orderMpId] = sheetSafe(pedido.orderMpId, 60);
  row[COL.paymentMpId] = sheetSafe(pedido.paymentMpId, 60);
  row[COL.statusMp] = sheetSafe(pedido.statusMp, 60);
  row[COL.pagoEm] = sheetSafe(pedido.pagoEm, 40);
  row[COL.atualizadoEm] = sheetSafe(pedido.atualizadoEm, 40);
  row[COL.observacoes] = sheetSafe(pedido.observacoes, 300);
  row[COL.shirtSizes] = sheetSafe(pedido.shirtSizes, 500);
  row[COL.shortsSizes] = sheetSafe(pedido.shortsSizes, 500);
  return row;
}

/* ─── Fila de escrita serializada ──────────────────────────────────────── */
let writeQueue = Promise.resolve();

function serialize(work) {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function locate(sheets, id, { fresh = false } = {}) {
  const rows = await readTable(sheets, { fresh });
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i][COL.id] === id) return { row: rows[i], rowNumber: FIRST_DATA_ROW + i };
  }
  return null;
}

function exigirPlanilha() {
  if (isLojaSheetConfigured()) return;
  const err = new Error("sheets_not_configured");
  err.code = "sheets_not_configured";
  throw err;
}

/** Busca um pedido pelo ID (external_reference sem prefixo). */
export async function findPedido(id, { fresh = false } = {}) {
  if (!isLojaSheetConfigured() || !id) return null;
  const sheets = createSheetsClient();
  await ensureSheet(sheets);
  const hit = await locate(sheets, id, { fresh });
  return hit ? rowToPedido(hit.row, hit.rowNumber) : null;
}

/**
 * Cria a linha pendente com o snapshot financeiro já congelado. Chamada ANTES
 * de criar a order no Mercado Pago, para o webhook sempre ter onde escrever.
 *
 * @param {object} dados - { id, nome, telefone, email, itens, shirtSizes,
 *   shortsSizes, subtotalCents,
 *   paymentMethod, installments, feeBps, paymentFeeCents, totalChargedCents }
 */
export async function criarPedidoPendente(dados) {
  exigirPlanilha();

  const agora = formatDateTime();
  const pedido = {
    criadoEm: agora,
    id: dados.id,
    nome: dados.nome,
    telefone: dados.telefone,
    email: dados.email,
    itens: dados.itens,
    shirtSizes: dados.shirtSizes || "",
    shortsSizes: dados.shortsSizes || "",
    subtotalCents: dados.subtotalCents,
    paymentMethod: dados.paymentMethod,
    installments: dados.installments || 1,
    feeBps: dados.feeBps ?? 0,
    paymentFeeCents: dados.paymentFeeCents ?? 0,
    totalChargedCents: dados.totalChargedCents,
    status: STATUS_PENDENTE,
    orderMpId: "",
    paymentMpId: "",
    statusMp: "",
    pagoEm: "",
    atualizadoEm: agora,
    observacoes: dados.observacoes || "",
  };

  return serialize(async () => {
    const sheets = createSheetsClient();
    await ensureSheet(sheets);

    const existente = await locate(sheets, pedido.id, { fresh: true });
    if (existente) return rowToPedido(existente.row, existente.rowNumber);

    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId(),
      range: `${quoteSheetName(LOJA_SHEET_NAME)}!A:${LAST_COLUMN}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [pedidoToRow(pedido)] },
    });
    invalidateTable();
    return pedido;
  });
}

/**
 * Atualiza a linha existente com só os campos que mudaram. Devolve
 * `{ pedido, gravou }` — `gravou: false` quando a linha não muda (webhook
 * reenviado). Um pedido já "Pago" nunca volta atrás.
 */
export async function atualizarPedido(id, mudancas) {
  exigirPlanilha();

  return serialize(async () => {
    const sheets = createSheetsClient();
    await ensureSheet(sheets);

    const existente = await locate(sheets, id, { fresh: true });
    if (!existente) return { pedido: null, gravou: false };

    const atual = rowToPedido(existente.row, existente.rowNumber);
    const atualizado = { ...atual, ...mudancas };

    if (atual.status === STATUS_PAGO) {
      atualizado.status = STATUS_PAGO;
      atualizado.pagoEm = atual.pagoEm || atualizado.pagoEm;
    }

    const linhaAtual = pedidoToRow({ ...atual, atualizadoEm: "" });
    const linhaNova = pedidoToRow({ ...atualizado, atualizadoEm: "" });
    if (linhaAtual.join(" ") === linhaNova.join(" ")) {
      return { pedido: atual, gravou: false };
    }

    atualizado.atualizadoEm = formatDateTime();

    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: `${quoteSheetName(LOJA_SHEET_NAME)}!A${existente.rowNumber}:${LAST_COLUMN}${existente.rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [pedidoToRow(atualizado)] },
    });
    invalidateTable();

    return { pedido: atualizado, gravou: true };
  });
}
