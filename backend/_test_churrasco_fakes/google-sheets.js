/**
 * Planilha falsa em memória — usada só por `_test_churrasco.mjs`.
 * Reproduz a superfície de `google-sheets.js` que o churrasco consome.
 */
export const sheet = { rows: [], calls: { update: 0, append: 0, get: 0 } };

export function resetSheet() {
  sheet.rows = [];
  sheet.calls = { update: 0, append: 0, get: 0 };
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

/** Só o subconjunto de `spreadsheets.values` que o código usa. */
export function createSheetsClient() {
  return {
    spreadsheets: {
      values: {
        async get() {
          sheet.calls.get += 1;
          return { data: { values: sheet.rows.map((r) => [...r]) } };
        },
        async update({ range, requestBody }) {
          sheet.calls.update += 1;
          const rowNumber = Number(range.match(/!A(\d+):/)[1]);
          sheet.rows[rowNumber - 2] = [...requestBody.values[0]];
          return {};
        },
        async append({ requestBody }) {
          sheet.calls.append += 1;
          sheet.rows.push([...requestBody.values[0]]);
          return {};
        },
      },
    },
  };
}
