/**
 * Helpers de baixo nível da integração com o Google Sheets.
 *
 * Extraídos de `index.js` para serem reaproveitados por outros fluxos (ex:
 * as inscrições do churrasco) sem duplicar autenticação nem criação de abas.
 * As credenciais continuam vindo exclusivamente das variáveis de ambiente.
 */
import { google } from "googleapis";

export function isGoogleSheetsConfigured() {
  return Boolean(
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
        process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64)
  );
}

export function getGooglePrivateKey() {
  // Alternativa Base64 (mais segura para painel de hosting)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64) {
    return Buffer.from(
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64,
      "base64"
    ).toString("utf8");
  }

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "";

  // Normaliza os três formatos possíveis dependendo do ambiente:
  //  1. Render UI: cole a chave com newlines reais → já tem \n reais, replace é no-op
  //  2. .env local dotenv v17+: \n já convertido para newline real → idem
  //  3. .env local dotenv antigo / var exportada manualmente: \n como backslash-n literal
  return raw
    .replace(/\\n/g, "\n") // backslash-n literal → newline real
    .trim();
}

export function createGoogleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = getGooglePrivateKey();

  // Diagnóstico — nunca o conteúdo, prefixo ou tamanho de um segredo.
  console.log(`[Google Auth] service account: ${email ? "configurada" : "NÃO DEFINIDA"}`);
  console.log(`[Google Auth] chave privada: ${key ? "configurada" : "NÃO DEFINIDA"}`);

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/** Cliente autenticado do Sheets v4. */
export function createSheetsClient() {
  return google.sheets({ version: "v4", auth: createGoogleAuth() });
}

/** Escapa o nome da aba para uso em ranges A1 ('Minha Aba'!A:N). */
export function quoteSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

/** 1 → "A", 26 → "Z", 27 → "AA". */
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

/** Cria a aba caso ela ainda não exista. */
export async function ensureSheetExists(sheets, spreadsheetId, sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });

  const hasSheet = spreadsheet.data.sheets?.some(
    (sheet) => sheet.properties?.title === sheetName
  );

  if (hasSheet) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  });
}

/**
 * Grava/atualiza a primeira linha da aba quando o cabeçalho estiver ausente
 * ou desatualizado (ex: migração de 13 → 14 colunas).
 */
export async function ensureSheetHeader(sheets, spreadsheetId, sheetName, headers) {
  const lastColumn = columnLetter(headers.length);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1:${lastColumn}1`,
  });

  const currentHeaders = res.data.values?.[0] || [];

  const needsUpdate =
    currentHeaders.length === 0 ||
    currentHeaders.length !== headers.length ||
    !headers.every((h, i) => currentHeaders[i] === h);

  if (!needsUpdate) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers] },
  });
  console.log(`[Sheets] Cabeçalho da aba "${sheetName}" atualizado.`);
}

export function formatDateTime() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
