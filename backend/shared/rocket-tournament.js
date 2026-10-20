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
export const THIRD_FORMATS = ['MD3', 'MD5'];
const WINS = { MD1: 1, MD3: 2, MD5: 3 };
export const isSeries = format => format === 'MD3' || format === 'MD5';
export const seriesLength = format => (isSeries(format) ? WINS[format] * 2 - 1 : 0);
// O formato das quartas e o do 3º lugar são escolhidos no painel (formatKey).
export const KNOCKOUT_ROUNDS = [
  { id: 'QF', name: 'Quartas de final', venue: 'Online', formatKey: 'quarterFormat', matches: ['QF1', 'QF2', 'QF3', 'QF4'] },
  { id: 'SF', name: 'Semifinal', venue: 'Presencial', format: 'MD3', matches: ['SF1', 'SF2'] },
  { id: 'T3', name: '3º lugar', venue: 'Presencial', formatKey: 'thirdFormat', matches: ['T3'] },
  { id: 'F', name: 'Grande final', venue: 'Presencial', format: 'MD5', matches: ['F'] },
];
// A SF1 recebe os vencedores da QF1 e da QF2; a SF2, da QF3 e da QF4. O 3º
// lugar recebe os perdedores das semifinais e não depende da final.
const FEEDS = { SF1: ['QF1', 'QF2'], SF2: ['QF3', 'QF4'], T3: ['SF1', 'SF2'], F: ['SF1', 'SF2'] };
const FROM_LOSERS = new Set(['T3']);
const MATCH_NAMES = { F: 'final', T3: 'disputa de 3º lugar' };
const KNOCKOUT_IDS = KNOCKOUT_ROUNDS.flatMap(round => round.matches);
const TIEBREAK_KEYS = ['A', 'B', 'C', 'thirds'];

export function formatLabel(format) { return format === 'MD1' || format === 'single' ? 'Partida única' : format; }

export function emptyTournament() {
  return { revision: 0, updatedAt: null, teams: structuredClone(DEFAULT_TEAMS), results: {}, quarterFormat: 'MD3', quarters: [[null, null], [null, null], [null, null], [null, null]], thirdFormat: 'MD3', tiebreaks: {} };
}

const isScore = value => Number.isInteger(value) && value >= 0 && value <= 99;
const scoreOrNull = value => (value === null || value === undefined || value === '' ? null : value);
const cleanGame = game => ({ status: game?.status, a: scoreOrNull(game?.a), b: scoreOrNull(game?.b) });
// Jogos salvos antes do placar por jogo não tinham status, mas só eram aceitos
// completos e sem empate: equivalem a jogos encerrados.
const savedGame = game => ({ ...cleanGame(game), status: STATUS_LABELS[game?.status] ? game.status : 'finished' });
function cleanResult(raw) {
  const games = Array.isArray(raw?.games) ? raw.games.map(savedGame) : [];
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
  if (THIRD_FORMATS.includes(raw.thirdFormat)) state.thirdFormat = raw.thirdFormat;
  if (Array.isArray(raw.quarters)) state.quarters = state.quarters.map((pair, index) => pair.map((_, side) => (TEAM_IDS.includes(raw.quarters[index]?.[side]) ? raw.quarters[index][side] : null)));
  for (const key of TIEBREAK_KEYS) if (Array.isArray(raw.tiebreaks?.[key])) state.tiebreaks[key] = raw.tiebreaks[key].filter(id => TEAM_IDS.includes(id));
  return state;
}

export function matchFormat(state, id) {
  if (GROUP_MATCH_IDS.has(id)) return 'single';
  if (/^QF[1-4]$/.test(id)) return state.quarterFormat;
  if (id === 'T3') return state.thirdFormat;
  return id === 'SF1' || id === 'SF2' ? 'MD3' : id === 'F' ? 'MD5' : null;
}
function resultOf(state, id) { return state.results[id] || { status: 'scheduled', a: null, b: null, games: [] }; }

/* Regras de um placar. Partida única não tem empate (a prorrogação decide).
   Numa série MD3/MD5 quem manda são os jogos: ver validateSeries. */
export function validateResult(format, raw) {
  if (isSeries(format)) return validateSeries(format, raw?.games);
  const { status, a, b, games } = cleanResult(raw);
  if (!STATUS_LABELS[status]) return 'Escolha o status: A jogar, Ao vivo ou Encerrado.';
  if ([a, b].some(value => typeof value === 'number' && value < 0)) return 'Os gols não podem ser negativos.';
  if ([a, b].some(value => value !== null && !isScore(value))) return 'Use apenas números inteiros no placar.';
  if ((a === null) !== (b === null)) return 'Preencha o placar dos dois times.';
  if (games.length) return 'Quantidade de jogos da série inválida.';
  if (status === 'scheduled') return a === null ? null : 'Para lançar o placar, mude o status para Ao vivo ou Encerrado.';
  if (status === 'finished') {
    if (a === null) return 'Preencha o placar final para encerrar a partida.';
    if (a === b) return 'Partida única não pode terminar empatada: no Rocket League a prorrogação define o vencedor.';
  }
  return null;
}

/* Jogos de uma série, na ordem. Cada um tem status próprio; o Jogo N só começa
   depois do N-1 encerrado, e nada é lançado depois que alguém chega a 2 (MD3)
   ou 3 (MD5) vitórias. */
export function validateSeries(format, raw) {
  const target = WINS[format];
  if (!Array.isArray(raw) || raw.length > seriesLength(format)) return 'Quantidade de jogos da série inválida.';
  const games = raw.map(cleanGame);
  const wins = [0, 0];
  for (const [index, game] of games.entries()) {
    const label = `Jogo ${index + 1}`;
    if (!STATUS_LABELS[game.status]) return `Escolha o status do ${label}: A jogar, Ao vivo ou Encerrado.`;
    if ([game.a, game.b].some(value => typeof value === 'number' && value < 0)) return 'Os gols não podem ser negativos.';
    if ([game.a, game.b].some(value => value !== null && !isScore(value))) return 'Use apenas números inteiros no placar.';
    if ((game.a === null) !== (game.b === null)) return `Preencha o placar dos dois times no ${label}.`;
    if (game.status === 'scheduled') {
      if (game.a !== null) return `Para lançar o placar do ${label}, mude o status dele para Ao vivo ou Encerrado.`;
      continue;
    }
    if (Math.max(...wins) === target) return `A série já terminou ${wins[0]} × ${wins[1]}: o ${label} não é necessário.`;
    if (index && games[index - 1].status !== 'finished') return `O ${label} só pode ${game.status === 'finished' ? 'ser encerrado' : 'começar'} depois que o Jogo ${index} estiver encerrado.`;
    if (game.status === 'finished') {
      if (game.a === null) return `Preencha o placar do ${label} para encerrá-lo.`;
      if (game.a === game.b) return `O ${label} não pode terminar empatado: no Rocket League a prorrogação define o vencedor.`;
      wins[game.a > game.b ? 0 : 1]++;
    }
  }
  return null;
}

/* Placar da série calculado pelos jogos encerrados. Devolve sempre a lista
   completa (3 ou 5 jogos); os que vêm depois da série decidida saem com
   needed: false ("Não necessário"). */
export function deriveSeries(format, games = []) {
  const target = WINS[format];
  let a = 0;
  let b = 0;
  const list = Array.from({ length: seriesLength(format) }, (_, index) => {
    const game = games[index] || { status: 'scheduled', a: null, b: null };
    const needed = a < target && b < target;
    const winner = needed && game.status === 'finished' && game.a !== null && game.b !== null && game.a !== game.b ? (game.a > game.b ? 'home' : 'away') : null;
    if (winner === 'home') a++;
    if (winner === 'away') b++;
    return { number: index + 1, status: game.status, a: game.a, b: game.b, needed, winner };
  });
  const status = Math.max(a, b) === target ? 'finished' : list.some(game => game.needed && game.status !== 'scheduled') ? 'live' : 'scheduled';
  return { status, a, b, games: list };
}

/* Visão de uma série salva. Uma série lançada antes do placar por jogo (ou
   com jogos que não explicam o placar salvo) mantém o placar salvo e sai com
   manual: true até alguém preencher os jogos. */
export function seriesResult(format, saved) {
  const derived = deriveSeries(format, saved?.games);
  const manual = !!saved && (saved.status !== derived.status || saved.a !== derived.a || saved.b !== derived.b);
  return manual ? { ...derived, status: saved.status, a: saved.a, b: saved.b, manual } : { ...derived, manual };
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
    const sides = quarter ? state.quarters[index] : FEEDS[id].map(feed => (FROM_LOSERS.has(id) ? knockout[feed].loser : knockout[feed].winner));
    const placeholders = quarter ? [`Classificado ${index * 2 + 1}`, `Classificado ${index * 2 + 2}`] : FEEDS[id].map(feed => `${FROM_LOSERS.has(id) ? 'Perdedor' : 'Vencedor'} ${feed}`);
    const format = matchFormat(state, id);
    const result = isSeries(format) ? seriesResult(format, state.results[id]) : resultOf(state, id);
    const winner = result.status === 'finished' && sides[0] && sides[1] ? (result.a > result.b ? sides[0] : sides[1]) : null;
    const loser = winner && (winner === sides[0] ? sides[1] : sides[0]);
    knockout[id] = { id, format, ...result, home: sides[0] ? team(sides[0]) : null, away: sides[1] ? team(sides[1]) : null, placeholders, winner, loser };
  }
  const rounds = KNOCKOUT_ROUNDS.map(round => ({ ...round, format: round.format || state[round.formatKey], matches: round.matches.map(id => knockout[id]) }));
  // Pódio: campeão e vice saem da final; o 3º lugar, da disputa entre os perdedores das semis.
  const podium = { champion: knockout.F.winner ? team(knockout.F.winner) : null, runnerUp: knockout.F.loser ? team(knockout.F.loser) : null, third: knockout.T3.winner ? team(knockout.T3.winner) : null };

  return { state, teams: TEAM_IDS.map(team), groups, groupsComplete, thirds, thirdTies, seeds, suggestion: seeds && suggestQuarters(seeds), rounds, knockout, champion: podium.champion, podium };
}

// Séries do mata-mata com todos os jogos, para a rota pública do placar.
export function seriesSummary(raw) {
  const state = normalizeTournament(raw);
  return Object.fromEntries(KNOCKOUT_IDS.filter(id => isSeries(matchFormat(state, id))).map(id => [id, { format: matchFormat(state, id), ...seriesResult(matchFormat(state, id), state.results[id]) }]));
}

/* ─── alterações feitas pelo painel: cada uma devolve { state } ou { error } ─── */
export function updateResult(raw, id, payload) {
  const state = normalizeTournament(raw);
  const format = matchFormat(state, id);
  if (!format) return { error: 'Partida não encontrada.' };
  let saved;
  if (isSeries(format)) {
    // Painel aberto antes da mudança ainda manda o placar da série à mão.
    if (['status', 'a', 'b'].some(key => payload?.[key] !== undefined)) return { error: 'O placar da série agora é calculado pelos jogos. Recarregue a página do painel e lance o placar de cada jogo.' };
    const error = validateSeries(format, payload?.games);
    if (error) return { error };
    const games = payload.games.map(cleanGame);
    while (games.length && games.at(-1).status === 'scheduled') games.pop();
    const series = deriveSeries(format, games);
    saved = series.status === 'scheduled' ? null : { status: series.status, a: series.a, b: series.b, games };
  } else {
    const result = cleanResult(payload);
    const error = validateResult(format, result);
    if (error) return { error };
    saved = result.status === 'scheduled' ? null : { status: result.status, a: result.a, b: result.b };
  }
  const before = buildTournament(state);
  if (before.knockout[id] && saved && (!before.knockout[id].home || !before.knockout[id].away)) return { error: 'Defina as duas equipes desta partida antes de lançar o placar.' };
  const next = structuredClone(state);
  if (saved) next.results[id] = saved;
  else delete next.results[id];
  // Trocar o vencedor depois que a fase seguinte já começou bagunçaria a chave.
  // Numa semifinal isso vale para a final e para o 3º lugar (muda o perdedor).
  const fed = Object.keys(FEEDS).find(key => FEEDS[key].includes(id) && state.results[key]);
  const fedName = MATCH_NAMES[fed] || fed;
  if (fed && before.knockout[id].winner !== buildTournament(next).knockout[id].winner) return { error: `A ${fedName} já tem placar. Zere a ${fedName} antes de mudar o vencedor desta série.` };
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
  // Painel aberto antes do 3º lugar não manda thirdFormat: mantém o atual.
  const thirdFormat = payload.thirdFormat ?? state.thirdFormat;
  if (!THIRD_FORMATS.includes(thirdFormat)) return { error: 'Escolha o formato da disputa de 3º lugar: MD3 ou MD5.' };
  if (thirdFormat !== state.thirdFormat && state.results.T3) return { error: 'Zere o placar da disputa de 3º lugar antes de mudar o formato.' };
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
  next.thirdFormat = thirdFormat;
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
