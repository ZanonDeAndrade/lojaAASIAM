import { CalendarDays, CheckCircle2, Crown, RefreshCw, Trophy, Users, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildTournament, formatLabel, STATUS_LABELS } from '../../../backend/shared/rocket-tournament.js';
import { API_BASE, site } from '../settings/site.js';

const REFRESH_MS = 20000;
const STAGES = [{ id: 'A', label: 'Grupo A' }, { id: 'B', label: 'Grupo B' }, { id: 'C', label: 'Grupo C' }, { id: 'KO', label: 'Mata-mata' }];

/* Consulta o placar a cada 20 s enquanto a aba está visível e na hora em que
   a pessoa volta para ela (o celular congela os timers em segundo plano). */
function useTournament() {
  const [state, setState] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let alive = true; let running = false;
    async function poll() {
      if (running || document.visibilityState === 'hidden') return;
      running = true;
      const controller = new AbortController(); const deadline = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(`${API_BASE}/api/rocket-league/torneio`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error();
        if (alive) { setState(body.torneio); setUpdatedAt(new Date()); setOffline(false); }
      } catch { if (alive) setOffline(true); }
      finally { clearTimeout(deadline); running = false; }
    }
    const wake = () => { if (document.visibilityState !== 'hidden') poll(); };
    poll(); const timer = setInterval(poll, REFRESH_MS);
    document.addEventListener('visibilitychange', wake); window.addEventListener('focus', wake); window.addEventListener('online', wake);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); window.removeEventListener('online', wake); };
  }, []);
  return { tournament: useMemo(() => buildTournament(state), [state]), loaded: !!state, updatedAt, offline };
}

function StatusBadge({ status }) {
  return <span className={`rl-status rl-status-${status}`}>{status === 'live' && <i aria-hidden="true" />}{status === 'finished' && <CheckCircle2 size={13} aria-hidden="true" />}{STATUS_LABELS[status]}</span>;
}
function Players({ team }) {
  return team?.players?.length ? <small>{team.players.join(' + ')}</small> : null;
}
function Score({ match }) {
  if (match.status === 'scheduled') return <span className="rl-score rl-score-empty" aria-label="Placar ainda não definido">×</span>;
  const a = match.a ?? 0; const b = match.b ?? 0;
  return <span className="rl-score" aria-label={`Placar: ${a} a ${b}`}>{a}<span aria-hidden="true">×</span>{b}</span>;
}

function GameCard({ match }) {
  const winner = match.status === 'finished' ? (match.a > match.b ? 'home' : 'away') : null;
  return <li className={`rl-game is-${match.status}`}>
    <header><span>Jogo {match.number}</span><StatusBadge status={match.status} /></header>
    <div className="rl-game-score">
      <div className={`rl-game-team ${winner === 'home' ? 'is-winner' : winner ? 'is-loser' : ''}`}><strong>{match.home.name}</strong><Players team={match.home} /></div>
      <Score match={match} />
      <div className={`rl-game-team is-away ${winner === 'away' ? 'is-winner' : winner ? 'is-loser' : ''}`}><strong>{match.away.name}</strong><Players team={match.away} /></div>
    </div>
  </li>;
}

function StandingsTable({ group }) {
  const pendingTie = group.ties.some(ids => group.standings.some(row => ids.includes(row.team.id) && row.position <= 3));
  return <section className="rl-standings" aria-labelledby={`rl-standings-${group.id}`}>
    <div className="rl-stage-heading"><h3 id={`rl-standings-${group.id}`}>Classificação · Grupo {group.id}</h3><span>{group.standings.length} equipes · {group.matches.length} jogos</span></div>
    <div className="rl-table-wrap">
      <table className="rl-standings-table">
        <caption className="rl-visually-hidden">Classificação do grupo {group.id}, calculada pelos placares encerrados</caption>
        <thead><tr><th scope="col"><abbr title="Posição">#</abbr></th><th scope="col">Equipe</th><th scope="col"><abbr title="Jogos">J</abbr></th><th scope="col"><abbr title="Vitórias">V</abbr></th><th scope="col"><abbr title="Derrotas">D</abbr></th><th scope="col"><abbr title="Gols marcados (gols pró)">GP</abbr></th><th scope="col"><abbr title="Gols sofridos (gols contra)">GC</abbr></th><th scope="col"><abbr title="Saldo de gols">SG</abbr></th><th scope="col"><abbr title="Pontos">Pts</abbr></th></tr></thead>
        <tbody>{group.standings.map(row => <tr key={row.team.id} className={row.zone ? `rl-zone-${row.zone}` : ''}>
          <td className="rl-pos">{row.position}</td>
          <th scope="row">{row.team.name}</th>
          <td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.gf}</td><td>{row.ga}</td><td>{row.gd > 0 ? `+${row.gd}` : row.gd}</td><td className="rl-pts">{row.points}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <ul className="rl-zone-legend"><li><i className="is-qualified" aria-hidden="true" /> 1º e 2º: classificados às quartas</li><li><i className="is-third" aria-hidden="true" /> 3º: entre os 2 melhores terceiros</li></ul>
    {pendingTie && <p className="rl-group-note"><strong>Empate técnico:</strong> a organização define a posição por sorteio.</p>}
  </section>;
}

function GroupStage({ group }) {
  const finished = group.matches.filter(match => match.status === 'finished').length;
  return <div className="rl-stage-panel">
    <StandingsTable group={group} />
    <p className="rl-group-note">{site.rocket.groupNote}</p>
    <div className="rl-stage-heading"><h3>Jogos · Grupo {group.id}</h3><span>{finished} de {group.matches.length} encerrados</span></div>
    <ol className="rl-game-list">{group.matches.map(match => <GameCard key={match.id} match={match} />)}</ol>
  </div>;
}

function ThirdsTable({ tournament }) {
  return <section className="rl-standings" aria-labelledby="rl-thirds-title">
    <div className="rl-stage-heading"><h3 id="rl-thirds-title">Melhores terceiros colocados</h3><span>{tournament.groupsComplete ? '2 vagas definidas' : 'Parcial · 2 vagas'}</span></div>
    <div className="rl-table-wrap">
      <table className="rl-standings-table rl-thirds-table">
        <caption className="rl-visually-hidden">Comparação entre os terceiros colocados dos grupos A, B e C. Os dois primeiros avançam.</caption>
        <thead><tr><th scope="col"><abbr title="Posição">#</abbr></th><th scope="col">Equipe</th><th scope="col"><abbr title="Grupo">Gr</abbr></th><th scope="col"><abbr title="Jogos">J</abbr></th><th scope="col"><abbr title="Saldo de gols">SG</abbr></th><th scope="col"><abbr title="Gols marcados">GP</abbr></th><th scope="col"><abbr title="Pontos">Pts</abbr></th></tr></thead>
        <tbody>{tournament.thirds.map(row => <tr key={row.team.id} className={row.qualifies ? 'rl-zone-third-in' : 'rl-zone-out'}>
          <td className="rl-pos">{row.rank}</td><th scope="row">{row.team.name}{row.qualifies && <small className="rl-advance">Avança</small>}</th><td>{row.team.group}</td><td>{row.played}</td><td>{row.gd > 0 ? `+${row.gd}` : row.gd}</td><td>{row.gf}</td><td className="rl-pts">{row.points}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="rl-group-note">Comparação pelos mesmos critérios: pontos, saldo de gols e gols marcados.{tournament.thirdTies.length ? ' Empate técnico na 2ª vaga: a organização define por sorteio.' : ''}</p>
  </section>;
}

function SeriesSide({ team, placeholder, score, state }) {
  return <div className={`rl-series-team ${state}`}><span>{team ? <><strong>{team.name}</strong><Players team={team} /></> : <em>{placeholder}</em>}</span><b>{score}</b></div>;
}
function SeriesCard({ match }) {
  const showScore = match.status !== 'scheduled';
  const side = index => (match.winner ? ((index === 0 ? match.home : match.away)?.id === match.winner ? 'is-winner' : 'is-loser') : '');
  return <article className={`rl-series is-${match.status}`} aria-label={`${match.id}: ${match.home?.name || match.placeholders[0]} contra ${match.away?.name || match.placeholders[1]}`}>
    <header><span>{match.id === 'F' ? 'Final' : match.id}</span><StatusBadge status={match.status} /></header>
    <SeriesSide team={match.home} placeholder={match.placeholders[0]} score={showScore ? match.a ?? 0 : '–'} state={side(0)} />
    <SeriesSide team={match.away} placeholder={match.placeholders[1]} score={showScore ? match.b ?? 0 : '–'} state={side(1)} />
    {match.games?.length > 0 && <footer>Jogos: {match.games.map(game => `${game.a}–${game.b}`).join(' · ')}</footer>}
  </article>;
}

function Knockout({ tournament }) {
  return <div className="rl-stage-panel">
    <div className="rl-callout"><Users size={18} aria-hidden="true" /><p><strong>Classificação para as quartas:</strong> {site.rocket.qualification}</p></div>
    <ThirdsTable tournament={tournament} />
    {tournament.champion && <div className="rl-champion" role="status"><Crown size={22} aria-hidden="true" /><span><small>Campeã da Copa AASIAM</small><strong>{tournament.champion.name}</strong></span></div>}
    <div className="rl-stage-heading"><h3>Chaveamento</h3><span>8 equipes · 1 campeão</span></div>
    <p className="rl-group-note">{site.rocket.bracketNote}</p>
    <div className="rl-knockout">{tournament.rounds.map(round => <section className={`rl-knockout-round rl-round-${round.id}`} key={round.id} aria-labelledby={`rl-round-${round.id}`}>
      <div className="rl-knockout-heading"><h4 id={`rl-round-${round.id}`}>{round.name}</h4><span>{formatLabel(round.format)} · {round.venue}</span></div>
      <div className="rl-knockout-matches">{round.matches.map(match => <SeriesCard key={match.id} match={match} />)}</div>
    </section>)}</div>
  </div>;
}

export default function MatchSchedule() {
  const { tournament, loaded, updatedAt, offline } = useTournament();
  const [stage, setStage] = useState('A');
  const group = tournament.groups.find(item => item.id === stage);
  const live = tournament.groups.flatMap(item => item.matches).concat(tournament.rounds.flatMap(round => round.matches)).filter(match => match.status === 'live').length;
  return <section className="rl-schedule" aria-labelledby="rl-schedule-title">
    <div className="rl-panel-head">
      <span className="rl-eyebrow"><Trophy size={16} /> Copa AASIAM</span>
      <h2 id="rl-schedule-title">Jogos e classificação</h2>
      <p className="rl-schedule-when"><CalendarDays size={16} aria-hidden="true" /> {site.rocket.schedule.day}</p>
    </div>
    <p className={`rl-sync ${offline ? 'is-offline' : ''}`} role="status" aria-live="polite">
      {offline ? <><WifiOff size={14} aria-hidden="true" /> Sem conexão com o placar. Tentando de novo…</> : !loaded ? <><RefreshCw size={14} className="rl-spin" aria-hidden="true" /> Carregando placares…</> : <><i aria-hidden="true" /> Atualiza sozinho · {live ? `${live} ${live === 1 ? 'partida' : 'partidas'} ao vivo · ` : ''}atualizado às {updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>}
    </p>
    <nav className="rl-stage-tabs" aria-label="Fases do torneio">{STAGES.map(item => <button type="button" key={item.id} aria-pressed={stage === item.id} aria-controls="rl-stage-content" onClick={() => setStage(item.id)}>{item.label}</button>)}</nav>
    <div id="rl-stage-content">{group ? <GroupStage group={group} /> : <Knockout tournament={tournament} />}</div>
  </section>;
}
