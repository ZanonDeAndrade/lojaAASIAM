/** Integração do Torneio Rocket League: planilha e Mercado Pago são dublês. */
import assert from "node:assert/strict";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = (name) => pathToFileURL(path.join(here, "_test_churrasco_fakes", name)).href;
register(new URL("./_test_rocket-hooks.mjs", import.meta.url), import.meta.url);

process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "rocket-test-sheet";
process.env.MERCADO_PAGO_ACCESS_TOKEN = "TEST-rocket-token";
process.env.MERCADO_PAGO_WEBHOOK_SECRET = "rocket-webhook-secret";
process.env.ROCKET_TOKEN_SECRET = "rocket-token-secret";

const express = (await import("express")).default;
const { sheet, resetSheet } = await import(fake("google-sheets.js"));
const { instalarFetchFalso, resetMercadoPago, orderDe, creditar } = await import(fake("mercadopago-api.mjs"));
instalarFetchFalso();
const { registerRocketRoutes, parseRocketRegistration, aplicarWebhookRocket } = await import("./rocket.js");
const { lerOrder } = await import("./mercadopago.js");
const { findRocketRegistration, updateRocketRegistration } = await import("./rocket-inscricoes.js");

const app = express(); app.use(express.json()); registerRocketRoutes(app);
const server = app.listen(0, "127.0.0.1"); await new Promise((done) => server.once("listening", done));
const base = `http://127.0.0.1:${server.address().port}`;

function payload(n = 1, extra = {}) {
  return {
    nomeEquipe: `Alcateia ${n}`,
    jogadores: [
      { nome: "Jogador Um", ra: `RA${n}01`, vinculo: "Aluno atual", identificacaoAlternativa: "" },
      { nome: "Jogador Dois", ra: `RA${n}02`, vinculo: "Aluno atual", identificacaoAlternativa: "" },
    ],
    temReserva: false,
    capitao: { nome: "Capitao Equipe", whatsapp: "(55) 99999-9999", email: `capitao${n}@exemplo.com` },
    aceiteRegulamento: true,
    ...extra,
  };
}
async function enroll(value) {
  const response = await fetch(`${base}/api/rocket-league/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  return { response, body: await response.json() };
}

let passed = 0;
async function test(name, work) { try { await work(); passed += 1; console.log(`  ✓ ${name}`); } catch (error) { console.error(`  ✗ ${name}\n${error.stack}`); process.exitCode = 1; } }

console.log("\nRocket League — inscrições e Pix\n");
resetSheet(); resetMercadoPago();

await test("recusa aceite ausente e aceita professor sem RA com identificação alternativa", async () => {
  assert.ok(parseRocketRegistration(payload(1, { aceiteRegulamento: false })).error);
  const professor = payload(2, { jogadores: [
    { nome: "Professor Alfa", ra: "", vinculo: "Professor", identificacaoAlternativa: "Matrícula funcional 32" },
    { nome: "Egresso Beta", ra: "", vinculo: "Egresso", identificacaoAlternativa: "SI 2024" },
  ] });
  const parsed = parseRocketRegistration(professor);
  assert.equal(parsed.data.jogadores[0].ra, "");
  assert.equal(parsed.data.jogadores[1].identificacaoAlternativa, "SI 2024");
});

let first;
let all = [];
await test("cria uma reserva antes do Pix, cobra R$ 50 e registra o aceite", async () => {
  const result = await enroll(payload(1)); first = result.body;
  assert.equal(result.response.status, 201);
  assert.match(first.registrationId, /^ROCKET-2026-[A-Z2-9]{8}$/);
  assert.equal(first.amountCents, 5000);
  assert.ok(first.pix?.qrCode);
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0][20], "Regulamento Oficial — 25/09/2026");
  assert.ok(sheet.rows[0][21]);
  assert.equal(sheet.rows[0][22], "R$ 50,00");
  assert.equal(orderDe(first.registrationId).total_amount, "50.00");
});

await test("impede nome de equipe e jogador duplicados enquanto a reserva está ativa", async () => {
  const team = await enroll(payload(3, { nomeEquipe: "alcateia 1" }));
  assert.equal(team.response.status, 409);
  const duplicatePlayer = await enroll(payload(4, { jogadores: [
    { nome: "Outro Nome", ra: "RA101", vinculo: "Aluno atual", identificacaoAlternativa: "" },
    { nome: "Jogador Novo Quatro", ra: "RA402", vinculo: "Aluno atual", identificacaoAlternativa: "" },
  ] }));
  assert.equal(duplicatePlayer.response.status, 409);
});

await test("não expõe RA ou contatos na consulta protegida e confirma apenas pela leitura oficial", async () => {
  const order = orderDe(first.registrationId); creditar(order.id);
  await aplicarWebhookRocket(lerOrder(order));
  const response = await fetch(`${base}/api/rocket-league/inscricoes/${first.registrationId}/status`, { headers: { "X-Inscricao-Token": first.token } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.confirmed, true);
  assert.equal(JSON.stringify(body).includes("RA101"), false);
  assert.equal(JSON.stringify(body).includes("capitao1@"), false);
});

await test("não limita o número de equipes: 22 reservas concorrentes criam 22 cobranças (23 equipes com a primeira)", async () => {
  all = await Promise.all(Array.from({ length: 22 }, (_, i) => enroll(payload(i + 10))));
  assert.equal(all.filter((item) => item.response.status === 201).length, 22);
  const beyond = await enroll(payload(99));
  assert.equal(beyond.response.status, 201, "a 24ª equipe não pode ser recusada por falta de vaga");
  assert.equal(beyond.body.amountCents, 5000);
  assert.equal(JSON.stringify(beyond.body).includes("seatsRemaining"), false);
});

await test("a disponibilidade não expõe vagas e segue aberta até o prazo", async () => {
  const body = await (await fetch(`${base}/api/rocket-league/availability`)).json();
  assert.deepEqual(body, { ok: true, open: true, reason: null });
});

await test("pagamento tardio sem conflito é confirmado; com equipe repetida vai para revisão", async () => {
  const late = all[0].body;
  await updateRocketRegistration(late.registrationId, { expiraEm: new Date(Date.now() - 60_000).toISOString() });
  const replacement = await enroll(payload(100, { nomeEquipe: "Alcateia 10", capitao: { nome: "Outro Capitao", whatsapp: "(55) 98888-8888", email: "outro@exemplo.com" } }));
  assert.equal(replacement.response.status, 201, "a reserva expirada deveria liberar o nome da equipe");
  const order = orderDe(late.registrationId);
  creditar(order.id);
  await aplicarWebhookRocket(lerOrder(order));
  const registration = await findRocketRegistration(late.registrationId, { fresh: true });
  assert.equal(registration.status, "Revisão manual");

  const lateOk = all[1].body;
  await updateRocketRegistration(lateOk.registrationId, { expiraEm: new Date(Date.now() - 60_000).toISOString() });
  const okOrder = orderDe(lateOk.registrationId);
  creditar(okOrder.id);
  await aplicarWebhookRocket(lerOrder(okOrder));
  assert.equal((await findRocketRegistration(lateOk.registrationId, { fresh: true })).status, "Pago");
});

console.log(`\n${passed}/7 testes passaram.\n`);
server.close();
if (process.exitCode) process.exit(process.exitCode);
