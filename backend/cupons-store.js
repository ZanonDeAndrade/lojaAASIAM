/**
 * Cupons pessoais de PREÇO DE CUSTO — persistidos numa aba própria do Google
 * Sheets ("Cupons"). É a fonte de verdade do limite de utilizações: reinício do
 * Render, deploy ou nova instância não zeram nada.
 *
 * Mesmo padrão de `loja-pedidos.js`:
 *  - uma linha por cupom, atualizada no lugar (nunca acrescentada);
 *  - toda escrita passa por uma fila serializada (`serialize`) e relê a aba
 *    ANTES de decidir — duas compras simultâneas na última utilização não
 *    conseguem levar o contador além do máximo;
 *  - a contabilização guarda os IDs de pedido que já consumiram o cupom, então
 *    um webhook reenviado para o mesmo pedido é idempotente.
 *
 * O "painel administrativo" é a própria aba: editar `Ativo` para ligar/desligar,
 * ler `Usos contabilizados` / `Máximo de usos` para ver "1 / 2", "2 / 2".
 *
 * A regra de preço (aplicar `costCents`, bloquear produto sem custo) vive em
 * `cupons.js` — aqui é só o cadastro e o contador.
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

export const CUPONS_SHEET_NAME = process.env.CUPONS_SHEET_NAME || "Cupons";

/** Cupons pessoais criados pelo seed. Cada um começa com 2 utilizações. */
export const CUPONS_PESSOAIS = Object.freeze([
  "Dotto",
  "Schmidt",
  "Milton",
  "Samuel",
  "Marcelo",
  "Zanon",
  "Amanda",
  "Jessika",
  "Gabriel",
  "Guilherme",
  "Sofia",
]);

export const MAX_USOS_PADRAO = 2;

export const CUPONS_SHEET_HEADERS = [
  "Código", // A — nome canônico, como aparece para o cliente
  "Máximo de usos", // B
  "Usos contabilizados", // C — só sobe quando o pagamento é aprovado
  "Ativo", // D — "Sim" / "Não" (editável na mão)
  "Pedidos que usaram", // E — IDs, separados por vírgula (auditoria + idempotência)
  "Criado em", // F
  "Atualização", // G
];

const COL = {
  codigo: 0,
  max: 1,
  usos: 2,
  ativo: 3,
  pedidos: 4,
  criadoEm: 5,
  atualizadoEm: 6,
};

const LAST_COLUMN = columnLetter(CUPONS_SHEET_HEADERS.length);
const FIRST_DATA_ROW = 2;

/** Cache curto da aba — o `/quote` do checkout revalida o cupom a cada troca de
 *  parcela. `CUPONS_CACHE_MS=0` (testes) desliga. */
const CACHE_MS = (() => {
  const bruto = process.env.CUPONS_CACHE_MS;
  if (bruto === undefined || bruto === "") return 5000;
  const n = Number.parseInt(bruto, 10);
  return Number.isFinite(n) && n >= 0 ? n : 5000;
})();

let cache = null;
let sheetReady = false;
let writeQueue = Promise.resolve();
let seedPromise = null;

/** Reinicia o estado de módulo — usado só pelos testes, junto do `resetSheet()`. */
export function resetCuponsStoreForTests() {
  cache = null;
  sheetReady = false;
  seedPromise = null;
  writeQueue = Promise.resolve();
}

function serialize(work) {
  const next = writeQueue.then(work, work);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function spreadsheetId() {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
}

/** trim + minúsculas + colapsa espaços. É a identidade ÚNICA do cupom. */
export function normalizarCodigo(codigo) {
  return String(codigo || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function inteiro(texto) {
  const n = Number.parseInt(String(texto ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Ativo só quando a célula diz "sim"/"s"/"1"/"true"/"ativo" (default: inativo). */
function ativoDaPlanilha(texto) {
  return /^(s|sim|1|true|ativo|yes|y)\b/i.test(String(texto ?? "").trim());
}

function pedidosDaCelula(texto) {
  return new Set(
    String(texto ?? "")
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function novaLinha(nome, agora) {
  const row = new Array(CUPONS_SHEET_HEADERS.length).fill("");
  row[COL.codigo] = nome;
  row[COL.max] = String(MAX_USOS_PADRAO);
  row[COL.usos] = "0";
  row[COL.ativo] = "Sim";
  row[COL.pedidos] = "";
  row[COL.criadoEm] = agora;
  row[COL.atualizadoEm] = agora;
  return row;
}

async function ensureSheet(sheets) {
  if (sheetReady) return;
  await ensureSheetExists(sheets, spreadsheetId(), CUPONS_SHEET_NAME);
  await ensureSheetHeader(sheets, spreadsheetId(), CUPONS_SHEET_NAME, CUPONS_SHEET_HEADERS);
  sheetReady = true;
}

async function readRows(sheets, { fresh = false } = {}) {
  if (!fresh && CACHE_MS > 0 && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.rows;
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${quoteSheetName(CUPONS_SHEET_NAME)}!A${FIRST_DATA_ROW}:${LAST_COLUMN}`,
  });
  const rows = res.data.values || [];
  cache = { at: Date.now(), rows };
  return rows;
}

function faltantes(rows) {
  const existentes = new Set(rows.map((r) => normalizarCodigo(r[COL.codigo])));
  return CUPONS_PESSOAIS.filter((nome) => !existentes.has(normalizarCodigo(nome)));
}

/** Acrescenta as linhas que faltam. NÃO serializa — quem chama controla isso. */
async function seedRaw(sheets, rows) {
  const faltam = faltantes(rows);
  if (!faltam.length) return rows;

  const agora = formatDateTime();
  const novas = faltam.map((nome) => novaLinha(nome, agora));
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${quoteSheetName(CUPONS_SHEET_NAME)}!A:${LAST_COLUMN}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: novas },
  });
  cache = null;
  console.log(`[Cupom] seed: ${faltam.length} cupom(ns) criado(s) na aba "${CUPONS_SHEET_NAME}".`);
  return [...rows, ...novas];
}

/**
 * Garante os 11 cupons pessoais na aba. Idempotente (upsert por código
 * normalizado). Fora da fila de escrita (caminho de leitura): dedupe o primeiro
 * seed concorrente do processo com `seedPromise`.
 */
async function garantirSeed(sheets, rows) {
  if (!faltantes(rows).length) return rows;
  if (!seedPromise) {
    seedPromise = seedRaw(sheets, rows).catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  await seedPromise;
  return readRows(sheets, { fresh: true });
}

/**
 * Cria/atualiza a aba e semeia os cupons pessoais que faltarem. Idempotente.
 * Devolve o estado atual dos cupons pessoais.
 */
export async function seedCupons() {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets não configurado — defina as variáveis de ambiente.");
  }
  return serialize(async () => {
    const sheets = createSheetsClient();
    await ensureSheet(sheets);
    const rows = await readRows(sheets, { fresh: true });
    await seedRaw(sheets, rows);
    return listarCupons();
  });
}

/** Leitura + seed (caminho de leitura, fora da fila de escrita). */
async function carregar(sheets, { fresh = false } = {}) {
  const rows = await readRows(sheets, { fresh });
  return garantirSeed(sheets, rows);
}

/**
 * Estado de um cupom pessoal, sem marcar nada como usado.
 *  { valido: true, tipo: "custo", codigo, usos, max }
 *  { valido: false, motivo: "invalido" | "inativo" | "esgotado" }
 */
export async function checkCupomCusto(codigo) {
  if (!isGoogleSheetsConfigured()) return { valido: false, motivo: "invalido" };

  const key = normalizarCodigo(codigo);
  if (!key) return { valido: false, motivo: "invalido" };

  const sheets = createSheetsClient();
  await ensureSheet(sheets);
  const rows = await carregar(sheets);
  const row = rows.find((r) => normalizarCodigo(r[COL.codigo]) === key);
  if (!row) return { valido: false, motivo: "invalido" };

  if (!ativoDaPlanilha(row[COL.ativo])) return { valido: false, motivo: "inativo" };

  const max = inteiro(row[COL.max]) || MAX_USOS_PADRAO;
  const usos = Math.max(inteiro(row[COL.usos]), pedidosDaCelula(row[COL.pedidos]).size);
  if (usos >= max) return { valido: false, motivo: "esgotado" };

  return { valido: true, tipo: "custo", codigo: String(row[COL.codigo]).trim(), usos, max };
}

/**
 * Contabiliza UMA utilização do cupom para `orderId`. Idempotente por pedido e
 * seguro sob concorrência (fila serializada + releitura fresca).
 *
 *  { ok: true, contabilizado: true, usos, max }   primeira vez
 *  { ok: true, jaContava: true, usos, max }       webhook reenviado
 *  { ok: false, motivo: "esgotado" | "invalido" | "sem_planilha" | "parametros" }
 */
export async function contabilizarUsoCupom(codigo, orderId) {
  if (!isGoogleSheetsConfigured()) return { ok: false, motivo: "sem_planilha" };

  const key = normalizarCodigo(codigo);
  const id = String(orderId || "").trim();
  if (!key || !id) return { ok: false, motivo: "parametros" };

  return serialize(async () => {
    const sheets = createSheetsClient();
    await ensureSheet(sheets);
    // Já estamos na fila de escrita: semeia direto, sem `garantirSeed`.
    const rows = await seedRaw(sheets, await readRows(sheets, { fresh: true }));
    const idx = rows.findIndex((r) => normalizarCodigo(r[COL.codigo]) === key);
    if (idx === -1) return { ok: false, motivo: "invalido" };

    const row = rows[idx];
    const pedidos = pedidosDaCelula(row[COL.pedidos]);
    const max = inteiro(row[COL.max]) || MAX_USOS_PADRAO;

    if (pedidos.has(id)) {
      return { ok: true, jaContava: true, usos: Math.max(inteiro(row[COL.usos]), pedidos.size), max };
    }

    const usosAtual = Math.max(inteiro(row[COL.usos]), pedidos.size);
    if (usosAtual >= max) {
      console.warn(
        `[Cupom] "${key}" já em ${usosAtual}/${max} — uso do pedido ${id} NÃO contabilizado.`
      );
      return { ok: false, motivo: "esgotado", usos: usosAtual, max };
    }

    pedidos.add(id);
    const atualizada = [...row];
    while (atualizada.length < CUPONS_SHEET_HEADERS.length) atualizada.push("");
    atualizada[COL.usos] = String(usosAtual + 1);
    atualizada[COL.pedidos] = [...pedidos].join(", ");
    atualizada[COL.atualizadoEm] = formatDateTime();

    const rowNumber = FIRST_DATA_ROW + idx;
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: `${quoteSheetName(CUPONS_SHEET_NAME)}!A${rowNumber}:${LAST_COLUMN}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [atualizada] },
    });
    cache = null;

    return { ok: true, contabilizado: true, usos: usosAtual + 1, max };
  });
}

/** Snapshot para conferência (endpoint admin / log). Nunca exposto ao cliente. */
export async function listarCupons() {
  if (!isGoogleSheetsConfigured()) return [];
  const sheets = createSheetsClient();
  await ensureSheet(sheets);
  const rows = await carregar(sheets, { fresh: true });
  return rows
    .filter((r) => r[COL.codigo])
    .map((r) => {
      const max = inteiro(r[COL.max]) || MAX_USOS_PADRAO;
      const usos = Math.max(inteiro(r[COL.usos]), pedidosDaCelula(r[COL.pedidos]).size);
      return {
        codigo: String(r[COL.codigo]).trim(),
        usos,
        max,
        ativo: ativoDaPlanilha(r[COL.ativo]),
        esgotado: usos >= max,
      };
    });
}
