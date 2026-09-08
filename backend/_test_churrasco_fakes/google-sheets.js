/**
 * Planilha falsa em memória — usada pelos testes que sobem rotas reais
 * (`_test_churrasco.mjs`, `_test_loja.mjs`, `_test_loja_pagamento.mjs`,
 * `_test_webhook_central.mjs`).
 *
 * Reproduz a superfície de `google-sheets.js` que o código consome. Para manter
 * o comportamento histórico, TODAS as abas dividem `sheet.rows` — exceto a aba
 * "Cupons", que fica isolada em `sheet.byTab.Cupons` (senão o contador de
 * cupons se misturaria com as linhas de pedido nos testes).
 */
const CUPONS_TAB = "Cupons";

export const sheet = {
  rows: [],
  byTab: {},
  calls: { update: 0, append: 0, get: 0 },
};

export function resetSheet() {
  sheet.rows = [];
  sheet.byTab = {};
  sheet.calls = { update: 0, append: 0, get: 0 };
}

/** Linhas de uma aba isolada (só "Cupons" hoje), cópia rasa. */
export function tabRows(name) {
  return (sheet.byTab[name] || []).map((r) => [...r]);
}

function parseTab(range) {
  const m = String(range).match(/^'((?:[^']|'')+)'!|^([^'!]+)!/);
  const raw = m ? m[1] ?? m[2] ?? "" : "";
  return raw.replace(/''/g, "'");
}

function bucketFor(range) {
  if (parseTab(range) === CUPONS_TAB) return (sheet.byTab[CUPONS_TAB] ||= []);
  return sheet.rows;
}

export function isGoogleSheetsConfigured() {
  return true;
}

export function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

export function columnLetter(index) {
  let n = Math.max(1, Math.trunc(index));
  let out = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

let clock = 0;
export function formatDateTime() {
  clock += 1;
  return `01/09/2026 12:00:${String(clock).padStart(2, "0")}`;
}

export async function ensureSheetExists() {}
export async function ensureSheetHeader() {}

/* Só existem para satisfazer os imports de `index.js` quando ele é subido
   inteiro (teste do webhook central). Nenhum teste chama de verdade. */
export function getGooglePrivateKey() {
  return "chave-de-teste";
}
export function createGoogleAuth() {
  return { fake: true };
}

/** Só o subconjunto de `spreadsheets.values` que o código usa. */
export function createSheetsClient() {
  return {
    spreadsheets: {
      values: {
        async get({ range }) {
          sheet.calls.get += 1;
          return { data: { values: bucketFor(range).map((r) => [...r]) } };
        },
        async update({ range, requestBody }) {
          sheet.calls.update += 1;
          const bucket = bucketFor(range);
          const rowNumber = Number(range.match(/!A(\d+)/)[1]);
          bucket[rowNumber - 2] = [...requestBody.values[0]];
          return {};
        },
        async append({ range, requestBody }) {
          sheet.calls.append += 1;
          const bucket = bucketFor(range);
          for (const row of requestBody.values) bucket.push([...row]);
          return {};
        },
      },
    },
  };
}
