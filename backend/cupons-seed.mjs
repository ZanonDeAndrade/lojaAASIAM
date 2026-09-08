/**
 * Seed / "migration" dos cupons pessoais na aba "Cupons" do Google Sheets.
 *
 * Seguro para rodar em produção quantas vezes quiser: usa upsert por código
 * normalizado (só cria o que falta), nunca zera `Usos contabilizados` nem
 * `Ativo` de um cupom que já existe.
 *
 * Rodar:  node backend/cupons-seed.mjs
 *
 * Precisa das variáveis do Google Sheets no ambiente (as mesmas da loja):
 *   GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL,
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (ou _BASE64).
 */
import "./ssl-legacy.js";
import "dotenv/config";

import { isGoogleSheetsConfigured } from "./google-sheets.js";
import { CUPONS_SHEET_NAME, seedCupons } from "./cupons-store.js";

if (!isGoogleSheetsConfigured()) {
  console.error(
    "✗ Google Sheets não configurado. Defina GOOGLE_SHEETS_SPREADSHEET_ID, " +
      "GOOGLE_SERVICE_ACCOUNT_EMAIL e GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY."
  );
  process.exit(1);
}

try {
  const cupons = await seedCupons();
  console.log(`\n✓ Aba "${CUPONS_SHEET_NAME}" pronta. Estado atual:\n`);
  for (const c of cupons) {
    const flag = c.esgotado ? "ESGOTADO" : c.ativo ? "ativo" : "inativo";
    console.log(`  ${c.codigo.padEnd(12)} ${c.usos} / ${c.max}   ${flag}`);
  }
  console.log("");
  process.exit(0);
} catch (err) {
  console.error("✗ Falha no seed:", err?.message || err);
  process.exit(1);
}
