/**
 * Valor seguro para gravar no Google Sheets (junto com `valueInputOption:
 * "RAW"`): sem caracteres de controle e sem começar com = + - @, que o Sheets
 * ou um CSV exportado interpretariam como fórmula.
 *
 * O trim acontece ANTES da neutralização: um espaço ou caractere de controle
 * no início escondia o "=" (ex.: "\u0000=IMAGE(...)" virava "=IMAGE(...)").
 */
const CONTROLE_RE = /[\u0000-\u001f\u007f]/g;

export function sheetSafe(value, maxLength = 200) {
  return String(value ?? "")
    .replace(CONTROLE_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[=+\-@\s]+/, "")
    .slice(0, maxLength);
}
