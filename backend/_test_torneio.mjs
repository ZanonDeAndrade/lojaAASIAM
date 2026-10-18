import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { registerSiteAdmin } from './site-admin.js';
import { registerRocketTournament } from './rocket-torneio.js';
import { createSiteStore } from './site-store.js';
import { buildTournament, emptyTournament, GROUPS, updateQuarters, updateResult, updateTeams, updateTiebreak, validateResult } from './shared/rocket-tournament.js';

let passed = 0;
function check(condition, message) { assert.ok(condition, message); passed++; }

// Tabela oficial enviada pela organização.
const OFFICIAL = {
  A: ['Garotos de programa × Beekeepers', 'Unidos Puntel × Fórmula 67', 'Bolinha e fumaça × Garotos de programa', 'Beekeepers × Unidos Puntel', 'Fórmula 67 × Bolinha e fumaça', 'Garotos de programa × Unidos Puntel', 'Beekeepers × Fórmula 67', 'Unidos Puntel × Bolinha e fumaça', 'Garotos de programa × Fórmula 67', 'Beekeepers × Bolinha e fumaça'],
  B: ['Bola mansa × Bola murcha', 'No flip No Reset × Picape Sando', 'Os Facão × Bola mansa', 'Bola murcha × No flip No Reset', 'Picape Sando × Os Facão', 'Bola mansa × No flip No Reset', 'Bola murcha × Picape Sando', 'No flip No Reset × Os Facão', 'Bola mansa × Picape Sando', 'Bola murcha × Os Facão'],
  C: ['Meninos de Gothan × A Dupra', 'Bacharel em Lambari × Quase Pro', 'Meninos de Gothan × Bacharel em Lambari', 'A Dupra × Quase Pro', 'Meninos de Gothan × Quase Pro', 'A Dupra × Bacharel em Lambari'],
};
const fresh = buildTournament(null);
for (const group of fresh.groups) {
  check(JSON.stringify(group.matches.map(match => `${match.home.name} × ${match.away.name}`)) === JSON.stringify(OFFICIAL[group.id]), `tabela do grupo ${group.id}`);
  const pairs = new Set(group.matches.map(match => [match.home.id, match.away.id].sort().join()));
  const size = group.standings.length;
  check(pairs.size === size * (size - 1) / 2, `todos contra todos no grupo ${group.id}`);
}
check(GROUPS.flatMap(group => group.matches).length === 26);
check(fresh.groups[0].matches[0].number === '01' && fresh.groups[0].matches[0].status === 'scheduled');
check(fresh.rounds[0].matches[0].home === null && fresh.rounds[0].matches[0].placeholders[0] === 'Classificado 1');
check(fresh.rounds[1].matches[0].placeholders.join() === 'Vencedor QF1,Vencedor QF2' && fresh.rounds[2].format === 'MD5' && fresh.rounds[1].format === 'MD3' && fresh.rounds[0].format === 'MD3');

// Validações do placar.
check(validateResult('single', { status: 'finished', a: -1, b: 2 }) === 'Os gols não podem ser negativos.');
check(/empatada/.test(validateResult('single', { status: 'finished', a: 2, b: 2 })));
check(validateResult('single', { status: 'live', a: 1, b: 1 }) === null, 'empate parcial ao vivo é permitido');
check(validateResult('single', { status: 'scheduled', a: 1, b: 0 }) !== null);
check(validateResult('single', { status: 'scheduled', a: null, b: null }) === null);
check(validateResult('single', { status: 'finished', a: 3, b: null }) !== null);
check(validateResult('single', { status: 'finished', a: 1.5, b: 0 }) !== null);
check(/exatamente 2/.test(validateResult('MD3', { status: 'finished', a: 3, b: 1 })));
check(/exatamente 2/.test(validateResult('MD3', { status: 'finished', a: 1, b: 0 })));
check(validateResult('MD3', { status: 'finished', a: 2, b: 1 }) === null);
check(/exatamente 3/.test(validateResult('MD5', { status: 'finished', a: 2, b: 0 })));
check(validateResult('MD5', { status: 'finished', a: 1, b: 3 }) === null);
check(validateResult('MD3', { status: 'live', a: 2, b: 0 }) !== null);
check(validateResult('MD3', { status: 'finished', a: 2, b: 1, games: [{ a: 3, b: 1 }, { a: 0, b: 2 }, { a: 2, b: 1 }] }) === null);
check(validateResult('MD3', { status: 'finished', a: 2, b: 0, games: [{ a: 3, b: 1 }, { a: 0, b: 2 }] }) !== null, 'jogos precisam bater com a série');
check(validateResult('MD3', { status: 'finished', a: 2, b: 0, games: [{ a: 1, b: 1 }] }) !== null);
check(validateResult('MD1', { status: 'finished', a: 4, b: 2 }) === null);
check(validateResult('MD1', { status: 'finished', a: 1, b: 0, games: [{ a: 1, b: 0 }] }) !== null);

// Classificação: 3 pontos por vitória, SG, GP e confronto direto.
function play(state, id, a, b, status = 'finished') {
  const result = updateResult(state, id, { status, a, b });
  assert.ok(result.state, result.error);
  return result.state;
}
let state = emptyTournament();
state = play(state, 'C01', 3, 1); // Gothan 3×1 Dupra
state = play(state, 'C02', 2, 0); // Lambari 2×0 Quase Pro
let view = buildTournament(state);
let c = view.groups[2].standings;
check(c[0].team.name === 'Meninos de Gothan' && c[0].points === 3 && c[0].gd === 2 && c[0].played === 1);
check(c[1].team.name === 'Bacharel em Lambari' && c[1].gf === 2);
check(c[2].team.name === 'A Dupra' && c[2].ga === 3 && c.at(-1).team.name === 'Quase Pro', 'gols marcados desempatam o saldo igual');
check(c[0].zone === 'qualified' && c[1].zone === 'qualified' && ['third-in', 'third-out'].includes(c[2].zone) && c[3].zone === null);
state = play(state, 'C03', 0, 1, 'live');
check(buildTournament(state).groups[2].standings[0].played === 1, 'partida ao vivo não conta na tabela');
// Empate em pontos, saldo e gols: decide o confronto direto (Lambari venceu Gothan).
state = play(state, 'C03', 1, 2); // Lambari vence o confronto direto
state = play(state, 'C01', 2, 1); // correção: Gothan 2×1 Dupra
state = play(state, 'C02', 3, 1); // correção: Lambari 3×1 Quase Pro
state = play(state, 'C04', 1, 0); // Dupra 1×0 Quase Pro
state = play(state, 'C05', 3, 1); // Gothan 3×1 Quase Pro
state = play(state, 'C06', 2, 1); // Dupra 2×1 Lambari
view = buildTournament(state);
c = view.groups[2].standings;
// Gothan e Lambari: 6 pts, SG +2, GP 6 · Dupra: 6 pts, SG +1 · Quase Pro: 0.
check(c.map(row => row.team.name).join() === 'Bacharel em Lambari,Meninos de Gothan,A Dupra,Quase Pro', c.map(row => `${row.team.name} ${row.points} ${row.gd} ${row.gf}`).join(' | '));
check(view.groups[2].complete && !view.groups[2].ties.length);

// Empate total em três equipes → sorteio pelo painel.
let tie = emptyTournament();
tie = play(tie, 'C01', 1, 0); tie = play(tie, 'C03', 0, 1); tie = play(tie, 'C06', 1, 0); // Gothan>Dupra, Lambari>Gothan, Dupra>Lambari
tie = play(tie, 'C02', 1, 0); tie = play(tie, 'C04', 1, 0); tie = play(tie, 'C05', 1, 0); // todos vencem Quase Pro por 1×0
view = buildTournament(tie);
check(view.groups[2].ties.length === 1 && view.groups[2].ties[0].length === 3, 'empate circular fica para sorteio');
check(updateTiebreak(tie, { key: 'C', order: ['C-0', 'A-0'] }).error);
tie = updateTiebreak(tie, { key: 'C', order: ['C-1', 'C-2', 'C-0'] }).state;
view = buildTournament(tie);
check(view.groups[2].standings.slice(0, 3).map(row => row.team.id).join() === 'C-1,C-2,C-0' && !view.groups[2].ties.length);

// Fase de grupos completa: classificados, melhores 3º e sugestão das quartas.
let full = emptyTournament();
for (const group of GROUPS) for (const match of group.matches) {
  const strength = id => -Number(id.split('-')[1]); // a equipe de índice menor vence
  full = play(full, match.id, strength(match.home) > strength(match.away) ? 3 : 1, strength(match.home) > strength(match.away) ? 1 : 3);
}
view = buildTournament(full);
check(view.groupsComplete && view.seeds.length === 8 && new Set(view.seeds).size === 8);
check(view.thirds.length === 3 && view.thirds.filter(row => row.qualifies).length === 2);
check(view.thirds.at(-1).team.group === 'C', 'o 3º do grupo C tem um jogo a menos');
check(view.suggestion.every(([x, y]) => x.split('-')[0] !== y.split('-')[0]), 'sugestão evita equipes do mesmo grupo');
check(updateResult(full, 'QF1', { status: 'finished', a: 2, b: 0 }).error, 'quartas sem equipes não aceitam placar');
check(updateQuarters(full, { quarterFormat: 'MD3', quarters: [['A-0', 'A-0'], [null, null], [null, null], [null, null]] }).error);
full = updateQuarters(full, { quarterFormat: 'MD3', quarters: view.suggestion }).state;
full = updateResult(full, 'QF1', { status: 'finished', a: 2, b: 1, games: [{ a: 2, b: 0 }, { a: 1, b: 3 }, { a: 4, b: 2 }] }).state;
full = updateResult(full, 'QF2', { status: 'finished', a: 0, b: 2 }).state;
view = buildTournament(full);
check(view.knockout.SF1.home.id === view.suggestion[0][0] && view.knockout.SF1.away.id === view.suggestion[1][1], 'vencedores avançam para a semifinal');
check(view.knockout.SF2.home === null && view.knockout.SF2.placeholders[0] === 'Vencedor QF3');
check(updateQuarters(full, { quarterFormat: 'MD5', quarters: view.suggestion }).error, 'formato não muda com quartas jogadas');
check(updateQuarters(full, { quarterFormat: 'MD3', quarters: [view.suggestion[1], view.suggestion[0], view.suggestion[2], view.suggestion[3]] }).error, 'quarta jogada não troca de equipes');
full = updateResult(full, 'SF1', { status: 'finished', a: 2, b: 0 }).state;
check(updateResult(full, 'QF1', { status: 'finished', a: 1, b: 2 }).error, 'não muda vencedor com a semifinal já jogada');
check(updateResult(full, 'QF1', { status: 'finished', a: 2, b: 0 }).state, 'corrige placar mantendo o vencedor');
full = updateResult(full, 'QF3', { status: 'finished', a: 2, b: 0 }).state;
full = updateResult(full, 'QF4', { status: 'finished', a: 2, b: 0 }).state;
full = updateResult(full, 'SF2', { status: 'finished', a: 1, b: 2 }).state;
check(updateResult(full, 'F', { status: 'finished', a: 3, b: 3 }).error);
full = updateResult(full, 'F', { status: 'finished', a: 3, b: 2 }).state;
view = buildTournament(full);
check(view.champion?.id === view.knockout.SF1.winner);
const reset = updateResult(full, 'F', { status: 'scheduled', a: null, b: null }).state;
check(!reset.results.F && buildTournament(reset).champion === null, 'zerar placar');

// Equipes e jogadores.
check(updateTeams(emptyTournament(), { teams: { 'A-0': { name: 'Beekeepers', players: [] } } }).error, 'nomes repetidos');
const named = updateTeams(emptyTournament(), { teams: { 'A-2': { name: ' Unidos Puntel FC ', players: ['Ana', ' ', 'Bia'] } } }).state;
check(named.teams['A-2'].name === 'Unidos Puntel FC' && named.teams['A-2'].players.join() === 'Ana,Bia');

// API: leitura pública, escrita só com login, persistência em disco isolado.
const directory = await mkdtemp(path.join(tmpdir(), 'aasiam-torneio-test-'));
const store = createSiteStore({ directory, sheets: false });
const app = express();
app.use(express.json());
const siteAdmin = registerSiteAdmin(app, { store, password: 'senha-de-teste' });
registerRocketTournament(app, { adminRouter: siteAdmin.router, store });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
async function call(url, { token, body } = {}) {
  const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
try {
  const publicRead = await call('/api/rocket-league/torneio');
  check(publicRead.status === 200 && publicRead.data.torneio.revision === 0);
  check((await call('/api/admin/torneio/partidas/A01', { body: { status: 'finished', a: 2, b: 1 } })).status === 401);
  const token = (await call('/api/admin/login', { body: { username: 'admin', password: 'senha-de-teste' } })).data.token;
  const saved = await call('/api/admin/torneio/partidas/A01', { token, body: { status: 'finished', a: 2, b: 1 } });
  check(saved.status === 200 && saved.data.torneio.revision === 1 && saved.data.torneio.results.A01.a === 2);
  check((await call('/api/admin/torneio/partidas/A02', { token, body: { status: 'finished', a: 1, b: 1 } })).status === 400);
  check((await call('/api/admin/torneio/partidas/Z99', { token, body: { status: 'finished', a: 1, b: 0 } })).status === 400);
  await Promise.all([
    call('/api/admin/torneio/partidas/B01', { token, body: { status: 'live', a: 0, b: 0 } }),
    call('/api/admin/torneio/partidas/C01', { token, body: { status: 'finished', a: 0, b: 3 } }),
  ]);
  const after = await call('/api/rocket-league/torneio');
  check(after.data.torneio.results.B01.status === 'live' && after.data.torneio.results.C01.b === 3 && after.data.torneio.results.A01.a === 2, 'salvamentos simultâneos não se apagam');
  check((await call('/api/admin/torneio/equipes', { token, body: { teams: { 'B-4': { name: 'Os Facão', players: ['Caio', 'Duda'] } } } })).status === 200);
  check((await call('/api/admin/torneio/mata-mata', { token, body: { quarterFormat: 'MD5', quarters: [[null, null], [null, null], [null, null], [null, null]] } })).data.torneio.quarterFormat === 'MD5');
  check((await store.readTournament()).teams['B-4'].players.join() === 'Caio,Duda');
  const reloaded = registerRocketTournament(express(), { adminRouter: express.Router(), store });
  const reloadedState = await reloaded.load();
  check(reloadedState.revision === 5 && reloadedState.results.C01.b === 3, 'placar sobrevive a reinício do servidor');
} finally {
  server.close();
  await rm(directory, { recursive: true, force: true });
}
console.log(`Torneio: ${passed} verificações passaram (tabela oficial, classificação, desempates, mata-mata, validações e API).`);
