// Copa AASIAM de Rocket League: tabela oficial, classificação e mata-mata.
// Compartilhado entre o backend (valida e grava os placares) e o frontend
// (página pública e painel), para que os dois calculem exatamente igual.

// Ordem das equipes e dos jogos conforme a tabela oficial da organização.
const FIXTURE = [
  {
    id: 'A',
    teams: ['Garotos de programa', 'Beekeepers', 'Unidos Puntel', 'Fórmula 67', 'Bolinha e fumaça'],
    games: [[0, 1], [2, 3], [4, 0], [1, 2], [3, 4], [0, 2], [1, 3], [2, 4], [0, 3], [1, 4]],
  },
  {
    id: 'B',
    teams: ['Bola mansa', 'Bola murcha', 'No flip No Reset', 'Picape Sando', 'Os Facão'],
    games: [[0, 1], [2, 3], [4, 0], [1, 2], [3, 4], [0, 2], [1, 3], [2, 4], [0, 3], [1, 4]],
  },
  {
    id: 'C',
    teams: ['Meninos de Gothan', 'A Dupra', 'Bacharel em Lambari', 'Quase Pro'],
    games: [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]],
  },
];

const pad = number => String(number).padStart(2, '0');
export const GROUPS = FIXTURE.map(group => ({
  id: group.id,
  teams: group.teams.map((_, index) => `${group.id}-${index}`),
  matches: group.games.map(([home, away], index) => ({ id: `${group.id}${pad(index + 1)}`, group: group.id, number: pad(index + 1), home: `${group.id}-${home}`, away: `${group.id}-${away}` })),
}));
export const DEFAULT_TEAMS = Object.fromEntries(FIXTURE.flatMap(group => group.teams.map((name, index) => [`${group.id}-${index}`, { name, players: [] }])));
export const TEAM_IDS = Object.keys(DEFAULT_TEAMS);
export const GROUP_OF = Object.fromEntries(GROUPS.flatMap(group => group.teams.map(id => [id, group.id])));
const GROUP_MATCH_IDS = new Set(GROUPS.flatMap(group => group.matches.map(match => match.id)));

export const STATUS_LABELS = { scheduled: 'A jogar', live: 'Ao vivo', finished: 'Encerrado' };
export const QUARTER_FORMATS = ['MD1', 'MD3', 'MD5'];
const WINS = { MD1: 1, MD3: 2, MD5: 3 };
export const KNOCKOUT_ROUNDS = [
  { id: 'QF', name: 'Quartas de final', venue: 'Online', matches: ['QF1', 'QF2', 'QF3', 'QF4'] },
  { id: 'SF', name: 'Semifinal', venue: 'Online', format: 'MD3', matches: ['SF1', 'SF2'] },
  { id: 'F', name: 'Grande final', venue: 'Presencial', format: 'MD5', matches: ['F'] },
];
// A SF1 recebe os vencedores da QF1 e da QF2; a SF2, da QF3 e da QF4.
const FEEDS = { SF1: ['QF1', 'QF2'], SF2: ['QF3', 'QF4'], F: ['SF1', 'SF2'] };
const KNOCKOUT_IDS = KNOCKOUT_ROUNDS.flatMap(round => round.matches);
const TIEBREAK_KEYS = ['A', 'B', 'C', 'thirds'];

export function formatLabel(format) { return format === 'MD1' || format === 'single' ? 'Partida única' : format; }

export function emptyTournament() {
  return { revision: 0, updatedAt: null, teams: structuredClone(DEFAULT_TEAMS), results: {}, quarterFormat: 'MD3', quarters: [[null, null], [null, null], [null, null], [null, null]], tiebreaks: {} };
}

const isScore = value => Number.isInteger(value) && value >= 0 && value <= 99;
const scoreOrNull = value => (value === null || value === undefined || value === '' ? null : value);
function cleanResult(raw) {
  const games = Array.isArray(raw?.games) ? raw.games.map(game => ({ a: scoreOrNull(game?.a), b: scoreOrNull(game?.b) })) : [];
  return { status: raw?.status, a: scoreOrNull(raw?.a), b: scoreOrNull(raw?.b), games };
}

// Aceita documentos antigos ou incompletos e devolve sempre o formato atual.
export function normalizeTournament(raw) {
  const state = emptyTournament();
  if (!raw || typeof raw !== 'object') return state;
  if (Number.isInteger(raw.revision)) state.revision = raw.revision;
  if (typeof raw.updatedAt === 'string') state.updatedAt = raw.updatedAt;
  for (const id of TEAM_IDS) {
    const team = raw.teams?.[id];
    if (team && typeof team.name === 'string' && team.name.trim()) state.teams[id] = { name: team.name.trim(), players: Array.isArray(team.players) ? team.players.filter(player => typeof player === 'string' && player.trim()) : [] };
  }
  for (const [id, result] of Object.entries(raw.results || {})) {
    if (!matchFormat(state, id) || !STATUS_LABELS[result?.status] || result.status === 'scheduled') continue;
    state.results[id] = cleanResult(result);
  }
  if (QUARTER_FORMATS.includes(raw.quarterFormat)) state.quarterFormat = raw.quarterFormat;
  if (Array.isArray(raw.quarters)) state.quarters = state.quarters.map((pair, index) => pair.map((_, side) => (TEAM_IDS.includes(raw.quarters[index]?.[side]) ? raw.quarters[index][side] : null)));
  for (const key of TIEBREAK_KEYS) if (Array.isArray(raw.tiebreaks?.[key])) state.tiebreaks[key] = raw.tiebreaks[key].filter(id => TEAM_IDS.includes(id));
  return state;
}

export function matchFormat(state, id) {
  if (GROUP_MATCH_IDS.has(id)) return 'single';
  if (/^QF[1-4]$/.test(id)) return state.quarterFormat;
  return id === 'SF1' || id === 'SF2' ? 'MD3' : id === 'F' ? 'MD5' : null;
}
function resultOf(state, id) { return state.results[id] || { status: 'scheduled', a: null, b: null, games: [] }; }

/* Regras de um placar. Partida única não tem empate (a prorrogação decide);
   numa série MD3/MD5 o vencedor precisa ter exatamente 2/3 vitórias. Os jogos
   da série são opcionais, mas quando informados precisam bater com a série. */
export function validateResult(format, raw) {
  const { status, a, b, games } = cleanResult(raw);
  const series = format === 'MD3' || format === 'MD5';
  const needed = WINS[format] || 1;
  if (!STATUS_LABELS[status]) return 'Escolha o status: A jogar, Ao vivo ou Encerrado.';
  const numbers = [a, b, ...games.flatMap(game => [game.a, game.b])];
  if (numbers.some(value => typeof value === 'number' && value < 0)) return 'Os gols não podem ser negativos.';
  if (numbers.some(value => value !== null && !isScore(value))) return 'Use apenas números inteiros no placar.';
  if ((a === null) !== (b === null)) return 'Preencha o placar dos dois times.';
  if (games.length > (series ? needed * 2 - 1 : 0)) return 'Quantidade de jogos da série inválida.';
  if (games.some(game => game.a === null || game.b === null)) return 'Preencha os dois lados de cada jogo da série.';
  if (status === 'scheduled') return a === null && !games.length ? null : 'Para lançar o placar, mude o status para Ao vivo ou Encerrado.';
  if (games.some(game => game.a === game.b)) return 'Um jogo da série não pode terminar empatado.';
  if (status === 'live' && series && a !== null && Math.max(a, b) >= needed) return `Com ${needed} vitórias a série terminou: marque como Encerrado.`;
  if (status === 'finished') {
    if (a === null) return 'Preencha o placar final para encerrar a partida.';
    if (!series && a === b) return 'Partida única não pode terminar empatada: no Rocket League a prorrogação define o vencedor.';
    if (series && (Math.max(a, b) !== needed || Math.min(a, b) >= needed)) return `Em ${format}, o vencedor precisa ter exatamente ${needed} vitórias.`;
  }
  if (games.length) {
    if (a === null) return 'Preencha o placar da série.';
    const winsA = games.filter(game => game.a > game.b).length;
    if (winsA > a || games.length - winsA > b) return 'Os placares dos jogos não batem com o placar da série.';
  }
  return null;
}

/* ─── classificação ─── */
const compareStats = (x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf;
// Depois de pontos, saldo e gols marcados: confronto direto entre os
// empatados e, persistindo, a ordem de sorteio definida no painel.
function untie(ids, matches, manual) {
  if (ids.length === 1) return [{ id: ids[0], tie: null }];
  const wins = Object.fromEntries(ids.map(id => [id, 0]));
  for (const match of matches) if (ids.includes(match.home) && ids.includes(match.away)) wins[match.a > match.b ? match.home : match.away]++;
  const levels = [...new Set(Object.values(wins))].sort((x, y) => y - x);
  if (levels.length > 1) return levels.flatMap(level => untie(ids.filter(id => wins[id] === level), matches, manual));
  const position = id => (manual.includes(id) ? manual.indexOf(id) : 1e9);
  const resolved = ids.every(id => manual.includes(id));
  return [...ids].sort((x, y) => position(x) - position(y)).map(id => ({ id, tie: resolved ? null : ids.join(',') }));
}
function rank(ids, stats, matches, manual = []) {
  const sorted = [...ids].sort((x, y) => compareStats(stats[x], stats[y]));
  const order = [];
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && !compareStats(stats[sorted[start]], stats[sorted[end]])) end++;
    order.push(...untie(sorted.slice(start, end), matches, manual));
    start = end;
  }
  return order;
}
function tiesOf(rows) {
  const clusters = new Map();
  for (const row of rows) if (row.tie) clusters.set(row.tie, [...(clusters.get(row.tie) || []), row.team.id]);
  return [...clusters.values()];
}

// Sementes 1–8: campeões, vices e os dois melhores 3º, cada bloco ordenado
// pelos mesmos critérios. 1×8, 4×5, 2×7 e 3×6, evitando reencontro do grupo.
function suggestQuarters(seeds) {
  const pairs = [[0, 7], [3, 4], [1, 6], [2, 5]].map(([x, y]) => [seeds[x], seeds[y]]);
  const clash = ([x, y]) => GROUP_OF[x] === GROUP_OF[y];
  for (const pair of pairs) {
    if (!clash(pair)) continue;
    const other = pairs.find(candidate => candidate !== pair && !clash([pair[0], candidate[1]]) && !clash([candidate[0], pair[1]]));
    if (other) [pair[1], other[1]] = [other[1], pair[1]];
  }
  return pairs;
}

export function buildTournament(raw) {
  const state = normalizeTournament(raw);
  const team = id => ({ id, group: GROUP_OF[id], ...state.teams[id] });
  const groups = GROUPS.map(group => {
    const matches = group.matches.map(match => ({ ...match, ...resultOf(state, match.id), home: team(match.home), away: team(match.away) }));
    const finished = matches.filter(match => match.status === 'finished').map(match => ({ home: match.home.id, away: match.away.id, a: match.a, b: match.b }));
    const stats = Object.fromEntries(group.teams.map(id => [id, { played: 0, wins: 0, losses: 0, gf: 0, ga: 0 }]));
    for (const match of finished) {
      for (const [id, scored, conceded] of [[match.home, match.a, match.b], [match.away, match.b, match.a]]) {
        const row = stats[id];
        row.played++; row.gf += scored; row.ga += conceded;
        if (scored > conceded) row.wins++; else row.losses++;
      }
    }
    for (const row of Object.values(stats)) { row.gd = row.gf - row.ga; row.points = row.wins * 3; }
    const standings = rank(group.teams, stats, finished, state.tiebreaks[group.id]).map(({ id, tie }, index) => ({ ...stats[id], team: team(id), position: index + 1, tie }));
    const complete = finished.length === matches.length;
    return { id: group.id, matches, standings, complete, ties: complete ? tiesOf(standings) : [] };
  });
  const groupsComplete = groups.every(group => group.complete);
  const thirdStats = Object.fromEntries(groups.map(group => [group.standings[2].team.id, group.standings[2]]));
  const thirds = rank(Object.keys(thirdStats), thirdStats, [], state.tiebreaks.thirds).map(({ id, tie }, index) => ({ ...thirdStats[id], rank: index + 1, tie, qualifies: index < 2 }));
  // Só importa o empate que decide quem fica com a 2ª vaga de melhor 3º.
  const thirdTies = groupsComplete ? tiesOf(thirds).filter(ids => ids.includes(thirds[1].team.id) && ids.includes(thirds[2].team.id)) : [];
  for (const group of groups) for (const row of group.standings) row.zone = row.position <= 2 ? 'qualified' : row.position === 3 ? (thirds.find(third => third.team.id === row.team.id).qualifies ? 'third-in' : 'third-out') : null;

  let seeds = null;
  if (groupsComplete) {
    const block = position => groups.map(group => group.standings[position]).sort(compareStats).map(row => row.team.id);
    seeds = [...block(0), ...block(1), ...thirds.slice(0, 2).map(row => row.team.id)];
  }

  const knockout = {};
  for (const id of KNOCKOUT_IDS) {
    const quarter = /^QF(\d)$/.exec(id);
    const index = quarter ? Number(quarter[1]) - 1 : -1;
    const sides = quarter ? state.quarters[index] : FEEDS[id].map(feed => knockout[feed].winner);
    const placeholders = quarter ? [`Classificado ${index * 2 + 1}`, `Classificado ${index * 2 + 2}`] : FEEDS[id].map(feed => `Vencedor ${feed}`);
    const result = resultOf(state, id);
    const winner = result.status === 'finished' && sides[0] && sides[1] ? (result.a > result.b ? sides[0] : sides[1]) : null;
    knockout[id] = { id, format: matchFormat(state, id), ...result, home: sides[0] ? team(sides[0]) : null, away: sides[1] ? team(sides[1]) : null, placeholders, winner };
  }
  const rounds = KNOCKOUT_ROUNDS.map(round => ({ ...round, format: round.format || state.quarterFormat, matches: round.matches.map(id => knockout[id]) }));

  return { state, teams: TEAM_IDS.map(team), groups, groupsComplete, thirds, thirdTies, seeds, suggestion: seeds && suggestQuarters(seeds), rounds, knockout, champion: knockout.F.winner ? team(knockout.F.winner) : null };
}

/* ─── alterações feitas pelo painel: cada uma devolve { state } ou { error } ─── */
export function updateResult(raw, id, payload) {
  const state = normalizeTournament(raw);
  const format = matchFormat(state, id);
  if (!format) return { error: 'Partida não encontrada.' };
  const result = cleanResult(payload);
  const error = validateResult(format, result);
  if (error) return { error };
  const before = buildTournament(state);
  if (before.knockout[id] && result.status !== 'scheduled' && (!before.knockout[id].home || !before.knockout[id].away)) return { error: 'Defina as duas equipes desta partida antes de lançar o placar.' };
  const next = structuredClone(state);
  if (result.status === 'scheduled') delete next.results[id];
  else next.results[id] = { status: result.status, a: result.a, b: result.b, ...(result.games.length ? { games: result.games } : {}) };
  // Trocar o vencedor depois que a fase seguinte já começou bagunçaria a chave.
  const fed = Object.keys(FEEDS).find(key => FEEDS[key].includes(id));
  if (fed && state.results[fed] && before.knockout[id].winner !== buildTournament(next).knockout[id].winner) return { error: `A ${fed === 'F' ? 'final' : fed} já tem placar. Zere a ${fed === 'F' ? 'final' : fed} antes de mudar o vencedor desta série.` };
  return { state: next };
}

export function updateTeams(raw, payload) {
  const state = normalizeTournament(raw);
  const next = structuredClone(state);
  for (const [id, team] of Object.entries(payload?.teams || {})) {
    if (!TEAM_IDS.includes(id)) return { error: 'Equipe não encontrada.' };
    const name = typeof team?.name === 'string' ? team.name.trim() : '';
    if (!name || name.length > 40) return { error: 'Cada equipe precisa de um nome com até 40 caracteres.' };
    const players = Array.isArray(team.players) ? team.players.map(player => (typeof player === 'string' ? player.trim() : '')).filter(Boolean) : [];
    if (players.length > 3 || players.some(player => player.length > 60)) return { error: `Informe até 3 jogadores para ${name}, com até 60 caracteres cada.` };
    next.teams[id] = { name, players };
  }
  const names = Object.values(next.teams).map(team => team.name.toLocaleLowerCase('pt-BR'));
  if (new Set(names).size !== names.length) return { error: 'Duas equipes não podem ter o mesmo nome.' };
  return { state: next };
}

export function updateQuarters(raw, payload) {
  const state = normalizeTournament(raw);
  const format = payload?.quarterFormat;
  if (!QUARTER_FORMATS.includes(format)) return { error: 'Escolha o formato das quartas: partida única, MD3 ou MD5.' };
  const playedQuarters = KNOCKOUT_ROUNDS[0].matches.filter(id => state.results[id]);
  if (format !== state.quarterFormat && playedQuarters.length) return { error: 'Zere os placares das quartas antes de mudar o formato.' };
  const quarters = Array.isArray(payload.quarters) && payload.quarters.length === 4 ? payload.quarters.map(pair => [0, 1].map(side => (pair?.[side] ? pair[side] : null))) : null;
  if (!quarters || quarters.flat().some(id => id !== null && !TEAM_IDS.includes(id))) return { error: 'Confrontos das quartas inválidos.' };
  const chosen = quarters.flat().filter(Boolean);
  if (new Set(chosen).size !== chosen.length) return { error: 'Uma equipe não pode aparecer em dois lugares das quartas.' };
  for (const id of playedQuarters) {
    const index = Number(id.slice(2)) - 1;
    if (quarters[index].some((team, side) => team !== state.quarters[index][side])) return { error: `Zere o placar da ${id} antes de trocar as equipes.` };
  }
  const next = structuredClone(state);
  next.quarterFormat = format;
  next.quarters = quarters;
  return { state: next };
}

export function updateTiebreak(raw, payload) {
  const state = normalizeTournament(raw);
  const { key, order } = payload || {};
  if (!TIEBREAK_KEYS.includes(key)) return { error: 'Desempate inválido.' };
  if (!Array.isArray(order) || order.length < 2 || new Set(order).size !== order.length || order.some(id => !TEAM_IDS.includes(id) || (key !== 'thirds' && GROUP_OF[id] !== key))) return { error: 'Ordem de desempate inválida.' };
  const next = structuredClone(state);
  next.tiebreaks[key] = [...order, ...(state.tiebreaks[key] || []).filter(id => !order.includes(id))];
  return { state: next };
}
