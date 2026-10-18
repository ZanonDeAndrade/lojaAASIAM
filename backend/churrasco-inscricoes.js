/**
 * Persistência das inscrições do churrasco — Google Sheets.
 *
 * A planilha é o registro durável: `orderCache` do e-commerce é memória e some
 * quando o Render reinicia, então nada aqui depende dele. Uma inscrição ocupa
 * UMA linha durante toda a vida dela — o webhook localiza a linha pela
 * referência externa e atualiza no lugar, nunca acrescenta.
 *
 * Cada evento tem a própria aba (`criarRegistroDeInscricoes`), com cache,
 * fila de escrita e cabeçalho próprios — a aba de um churrasco nunca é lida
 * nem escrita pelo fluxo do outro. As exportações soltas do fim do arquivo
 * são o registro do Churrasco da Alcateia (AMF Games), como sempre foram.
 *
 * Reaproveita os helpers de autenticação e de aba de `google-sheets.js`, os
 * mesmos usados pela aba de pedidos da loja.
 */
import { sheetSafe } from "./sheet-safe.js";
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
  STATUS_PROCESSANDO,
  STATUS_REVISAO,
  formatBRL,
  normalizeEmail,
  priceCentsForCourse,
  statusFromLabel,
  statusLabel,
} from "./shared/churrasco.js";
import {
  EVENTOS_CHURRASCO,
  EVENTO_SEMANA_SI,
  precoCentsDoEvento,
} from "./shared/churrasco-eventos.js";

export const CHURRASCO_SHEET_NAME =
  process.env.CHURRASCO_SHEET_NAME || "Inscrições Churrasco";

export const CHURRASCO_SEMANA_SI_SHEET_NAME =
  process.env.CHURRASCO_SEMANA_SI_SHEET_NAME || "Inscrições Churrasco Semana SI";

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

/**
 * Coluna U das abas de eventos que perguntam sobre carona. Vem depois de T
 * para que as primeiras 20 colunas sejam idênticas às da aba do AMF.
 */
export const COLUNA_CARONA = {
  campo: "precisaCarona",
  cabecalho: "Precisa de carona",
  gravar: (valor) => (valor === true ? "Sim" : "Não"),
  ler: (texto) => String(texto || "").trim() === "Sim",
};

const FIRST_DATA_ROW = 2;

/** Caracteres de controle — montado por escapes para não sujar o arquivo. */


export function isChurrascoSheetConfigured() {
  return isGoogleSheetsConfigured();
}

function spreadsheetId() {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
}

/** "R$ 25,00" → 2500. Só para exibição; a regra vem sempre do Mercado Pago. */
function centsDaPlanilha(texto) {
  const digitos = String(texto || "").replace(/\D/g, "");
  return digitos ? Number(digitos) : null;
}

function exigirPlanilha() {
  if (isChurrascoSheetConfigured()) return;
  const err = new Error("sheets_not_configured");
  err.code = "sheets_not_configured";
  throw err;
}

/** Ainda há Pix vivo nesta inscrição? Sem validade conhecida, conta como vivo. */
function pixVivo(expiraEm, agora) {
  if (!expiraEm) return true;
  const instante = Date.parse(expiraEm);
  return Number.isNaN(instante) || instante > agora;
}

/**
 * Cria o registro de inscrições de um evento.
 *
 * @param {object}   opcoes
 * @param {string}   opcoes.abaPlanilha    - nome da aba
 * @param {Function} opcoes.valorCents     - curso → centavos (null se inválido)
 * @param {Array}    [opcoes.colunasExtras] - colunas depois de T (ex.: carona)
 */
export function criarRegistroDeInscricoes({ abaPlanilha, valorCents, colunasExtras = [] }) {
  const cabecalhos = [...CHURRASCO_SHEET_HEADERS, ...colunasExtras.map((c) => c.cabecalho)];
  const ultimaColuna = columnLetter(cabecalhos.length);
  const colunaExtra = (i) => CHURRASCO_SHEET_HEADERS.length + i;

  /* ─── Cache curto da tabela ──────────────────────────────────────────
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
    await ensureSheetExists(sheets, spreadsheetId(), abaPlanilha);
    await ensureSheetHeader(sheets, spreadsheetId(), abaPlanilha, cabecalhos);
    sheetReady = true;
  }

  async function readTable(sheets, { fresh = false } = {}) {
    if (!fresh && tableCache && Date.now() - tableCache.at < TABLE_TTL_MS) {
      return tableCache.rows;
    }
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId(),
      range: `${quoteSheetName(abaPlanilha)}!A${FIRST_DATA_ROW}:${ultimaColuna}`,
    });
    const rows = res.data.values || [];
    tableCache = { at: Date.now(), rows };
    return rows;
  }

  /** Linha da planilha → objeto da inscrição. O valor é sempre recalculado. */
  function rowToInscricao(row, rowNumber) {
    const curso = row[COL.curso] || "";
    const inscricao = {
      rowNumber,
      criadaEm: row[COL.criadaEm] || "",
      id: row[COL.id] || "",
      nome: row[COL.nome] || "",
      telefone: row[COL.telefone] || "",
      curso,
      categoria: row[COL.categoria] || "",
      // Recalculado do curso: o número gravado nunca vira regra de negócio.
      valorCents: valorCents(curso),
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
    colunasExtras.forEach((coluna, i) => {
      inscricao[coluna.campo] = coluna.ler(row[colunaExtra(i)]);
    });
    return inscricao;
  }

  function inscricaoToRow(inscricao) {
    const row = new Array(cabecalhos.length).fill("");
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
    colunasExtras.forEach((coluna, i) => {
      row[colunaExtra(i)] = sheetSafe(coluna.gravar(inscricao[coluna.campo]), 60);
    });
    return row;
  }

  /* ─── Fila de escrita ────────────────────────────────────────────────
     O Mercado Pago reenvia webhooks e o navegador consulta em paralelo.
     Serializar as gravações garante que a segunda enxergue a linha criada
     pela primeira e atualize em vez de duplicar. */
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

  /** Busca uma inscrição pela referência externa. */
  async function findInscricao(id, { fresh = false } = {}) {
    if (!isChurrascoSheetConfigured() || !id) return null;
    const sheets = createSheetsClient();
    await ensureSheet(sheets);
    const hit = await locate(sheets, id, { fresh });
    return hit ? rowToInscricao(hit.row, hit.rowNumber) : null;
  }

  /**
   * Busca a inscrição da mesma pessoa no mesmo curso (ou em qualquer curso,
   * com `qualquerCurso` — o caso dos eventos de curso fixo).
   *
   * É o que impede que um duplo clique, um F5 ou um restart do backend virem
   * duas linhas e duas cobranças: a segunda tentativa reencontra a primeira.
   * Quando há mais de uma (linhas antigas), vale a última.
   */
  async function findInscricaoPorPessoa(email, curso, { fresh = false, qualquerCurso = false } = {}) {
    if (!isChurrascoSheetConfigured()) return null;
    const alvo = normalizeEmail(email);
    if (!alvo || (!curso && !qualquerCurso)) return null;

    const sheets = createSheetsClient();
    await ensureSheet(sheets);
    const rows = await readTable(sheets, { fresh });

    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const mesmoCurso = qualquerCurso || (row[COL.curso] || "") === curso;
      if (normalizeEmail(row[COL.email]) === alvo && mesmoCurso) {
        return rowToInscricao(row, FIRST_DATA_ROW + i);
      }
    }
    return null;
  }

  /**
   * Quantas inscrições ocupam vaga agora: as pagas, as em conferência e as
   * que ainda têm um Pix vivo (alguém pode pagar a qualquer momento). Só é
   * consultado quando o evento tem limite de vagas. `ignorar` deixa de fora
   * uma linha (a de quem está renovando o próprio Pix).
   */
  async function contarVagasOcupadas({ ignorar = "" } = {}) {
    exigirPlanilha();
    const sheets = createSheetsClient();
    await ensureSheet(sheets);
    const rows = await readTable(sheets, { fresh: true });
    const agora = Date.now();

    let ocupadas = 0;
    for (const row of rows) {
      if (ignorar && row[COL.id] === ignorar) continue;
      const status = statusFromLabel(row[COL.status]);
      if (status === STATUS_PAGO || status === STATUS_PROCESSANDO || status === STATUS_REVISAO) {
        ocupadas += 1;
      } else if (status === STATUS_PENDENTE && pixVivo(row[COL.expiraEm], agora)) {
        ocupadas += 1;
      }
    }
    return ocupadas;
  }

  /** Cria a linha pendente. Chamada ANTES de criar a order no Mercado Pago. */
  async function criarInscricaoPendente(dados) {
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
    for (const coluna of colunasExtras) inscricao[coluna.campo] = dados[coluna.campo];

    return serialize(async () => {
      const sheets = createSheetsClient();
      await ensureSheet(sheets);

      // Um retry do navegador não pode virar duas linhas.
      const existente = await locate(sheets, inscricao.id, { fresh: true });
      if (existente) return rowToInscricao(existente.row, existente.rowNumber);

      await sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId(),
        range: `${quoteSheetName(abaPlanilha)}!A:${ultimaColuna}`,
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
  async function atualizarInscricao(id, mudancas) {
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
      if (linhaAtual.join("") === linhaNova.join("")) {
        return { inscricao: atual, gravou: false };
      }

      atualizada.atualizadoEm = formatDateTime();

      await sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${quoteSheetName(abaPlanilha)}!A${existente.rowNumber}:${ultimaColuna}${existente.rowNumber}`,
        valueInputOption: "RAW",
        requestBody: { values: [inscricaoToRow(atualizada)] },
      });
      invalidateTable();

      return { inscricao: atualizada, gravou: true };
    });
  }

  return {
    abaPlanilha,
    cabecalhos,
    findInscricao,
    findInscricaoPorPessoa,
    contarVagasOcupadas,
    criarInscricaoPendente,
    atualizarInscricao,
  };
}

/* ─── Registros de cada evento ───────────────────────────────────────── */

/** Churrasco da Alcateia (AMF Games) — a aba de sempre, A–T. */
export const registroAmf = criarRegistroDeInscricoes({
  abaPlanilha: CHURRASCO_SHEET_NAME,
  valorCents: priceCentsForCourse,
});

/** Churrasco da AASIAM na Semana Acadêmica de SI — aba própria, A–U. */
export const registroSemanaSi = criarRegistroDeInscricoes({
  abaPlanilha: CHURRASCO_SEMANA_SI_SHEET_NAME,
  valorCents: (curso) => precoCentsDoEvento(EVENTOS_CHURRASCO[EVENTO_SEMANA_SI], curso),
  colunasExtras: [COLUNA_CARONA],
});

export const {
  findInscricao,
  findInscricaoPorPessoa,
  criarInscricaoPendente,
  atualizarInscricao,
} = registroAmf;
