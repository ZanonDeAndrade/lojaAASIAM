import { CalendarDays, CheckCircle2, ChevronDown, MapPin, Medal, RefreshCw, Trophy, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildTournament, formatLabel, isSeries, STATUS_LABELS } from '../../../backend/shared/rocket-tournament.js';
import { API_BASE, site } from '../settings/site.js';

const REFRESH_MS = 20000;
const JUMPS = [{ href: '#rl-grupo-A', label: 'Grupo A' }, { href: '#rl-grupo-B', label: 'Grupo B' }, { href: '#rl-grupo-C', label: 'Grupo C' }, { href: '#rl-mata-mata', label: 'Mata-mata' }];
// Rótulos curtos do chaveamento: Q1…Q4, S1, S2, F e 3º lugar.
const shortId = text => text.replace(/\bQF(\d)/g, 'Q$1').replace(/\bSF(\d)/g, 'S$1');
const cardLabel = id => ({ T3: '3º lugar' })[id] || shortId(id);
const matchName = id => ({ F: 'Grande final', T3: 'Disputa de 3º lugar' })[id] || shortId(id);
const signed = value => (value > 0 ? `+${value}` : value);

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

/* ─── fase de grupos ─── */
function Fixture({ match }) {
  const decided = match.status === 'finished';
  const side = home => (decided ? ((home ? match.a > match.b : match.b > match.a) ? 'is-winner' : 'is-loser') : '');
  const played = match.status !== 'scheduled';
  return <li className={`rl-fixture is-${match.status}`}>
    <span className="rl-fixture-num" aria-label={`Jogo ${match.number}`}>{match.number}</span>
    <span className={`rl-fixture-team is-home ${side(true)}`}>{match.home.name}<Players team={match.home} /></span>
    <span className="rl-fixture-score">
      {played ? <b aria-label={`Placar: ${match.a ?? 0} a ${match.b ?? 0}`}>{match.a ?? 0}<span aria-hidden="true">×</span>{match.b ?? 0}</b> : <b aria-label="Placar ainda não definido">—</b>}
      <small>{match.status === 'live' && <i aria-hidden="true" />}{STATUS_LABELS[match.status]}</small>
    </span>
    <span className={`rl-fixture-team is-away ${side(false)}`}>{match.away.name}<Players team={match.away} /></span>
  </li>;
}

function GroupCard({ group }) {
  const finished = group.matches.filter(match => match.status === 'finished').length;
  const pendingTie = group.ties.some(ids => group.standings.some(row => ids.includes(row.team.id) && row.position <= 3));
  return <section className="rl-card rl-group" id={`rl-grupo-${group.id}`} aria-labelledby={`rl-grupo-${group.id}-titulo`}>
    <header className="rl-card-head"><h4 id={`rl-grupo-${group.id}-titulo`}>Grupo {group.id}</h4><span>{finished} de {group.matches.length} jogos encerrados</span></header>
    <table className="rl-table">
      <caption className="rl-visually-hidden">Classificação do grupo {group.id}, calculada pelos placares encerrados</caption>
      <thead><tr><th scope="col" className="rl-c-pos"><abbr title="Posição">Pos</abbr></th><th scope="col" className="rl-c-team">Equipe</th><th scope="col"><abbr title="Jogos">J</abbr></th><th scope="col" className="rl-c-extra"><abbr title="Vitórias">V</abbr></th><th scope="col" className="rl-c-extra"><abbr title="Derrotas">D</abbr></th><th scope="col" className="rl-c-extra"><abbr title="Gols marcados (gols pró)">GP</abbr></th><th scope="col" className="rl-c-extra"><abbr title="Gols sofridos (gols contra)">GC</abbr></th><th scope="col"><abbr title="Saldo de gols">SG</abbr></th><th scope="col" className="rl-c-pts"><abbr title="Pontos">Pts</abbr></th></tr></thead>
      <tbody>{group.standings.map(row => <tr key={row.team.id} className={row.zone === 'qualified' ? 'rl-zone-qualified' : row.position === 3 ? 'rl-zone-third' : ''}>
        <td className="rl-c-pos">{row.position}</td>
        <th scope="row" className="rl-c-team">{row.team.name}</th>
        <td>{row.played}</td><td className="rl-c-extra">{row.wins}</td><td className="rl-c-extra">{row.losses}</td><td className="rl-c-extra">{row.gf}</td><td className="rl-c-extra">{row.ga}</td><td>{signed(row.gd)}</td><td className="rl-c-pts">{row.points}</td>
      </tr>)}</tbody>
    </table>
    {pendingTie && <p className="rl-note">Empate técnico: a organização define a posição por sorteio.</p>}
    <h5 className="rl-fixtures-title">Jogos do grupo {group.id}</h5>
    <ol className="rl-fixtures">{group.matches.map(match => <Fixture key={match.id} match={match} />)}</ol>
  </section>;
}

function ThirdsCard({ tournament }) {
  return <section className="rl-card rl-thirds" id="rl-terceiros" aria-labelledby="rl-terceiros-titulo">
    <header className="rl-card-head"><h4 id="rl-terceiros-titulo">Melhores terceiros colocados</h4><span>{tournament.groupsComplete ? '2 vagas definidas' : 'Parcial: 2 vagas'}</span></header>
    <table className="rl-table">
      <caption className="rl-visually-hidden">Comparação entre os terceiros colocados dos grupos A, B e C. Os dois primeiros avançam.</caption>
      <thead><tr><th scope="col" className="rl-c-pos"><abbr title="Posição">Pos</abbr></th><th scope="col" className="rl-c-team">Equipe</th><th scope="col"><abbr title="Jogos">J</abbr></th><th scope="col"><abbr title="Saldo de gols">SG</abbr></th><th scope="col" className="rl-c-extra"><abbr title="Gols marcados">GP</abbr></th><th scope="col" className="rl-c-pts"><abbr title="Pontos">Pts</abbr></th></tr></thead>
      <tbody>{tournament.thirds.map(row => <tr key={row.team.id} className={row.qualifies ? 'rl-zone-qualified' : 'rl-zone-out'}>
        <td className="rl-c-pos">{row.rank}</td>
        <th scope="row" className="rl-c-team">{row.team.name} <small>Grupo {row.team.group}</small>{row.qualifies && <em className="rl-advance">Avança</em>}</th>
        <td>{row.played}</td><td>{signed(row.gd)}</td><td className="rl-c-extra">{row.gf}</td><td className="rl-c-pts">{row.points}</td>
      </tr>)}</tbody>
    </table>
    <p className="rl-note">Comparação por pontos, saldo de gols e gols marcados.{tournament.thirdTies.length ? ' Empate técnico na 2ª vaga: a organização define por sorteio.' : ''}</p>
  </section>;
}

/* ─── chaveamento ─── */
function BracketSide({ team, placeholder, score, state }) {
  return <div className={`rl-br-side ${state}`}><span>{team ? <><strong>{team.name}</strong><Players team={team} /></> : <em>{shortId(placeholder)}</em>}</span><b>{score}</b></div>;
}
/* Jogos da série: os não necessários somem, os não jogados mostram "—" e o
   placar de cada jogo segue a ordem do card (de cima × de baixo). */
function SeriesGames({ match, id }) {
  const home = match.home?.name || shortId(match.placeholders[0]);
  const away = match.away?.name || shortId(match.placeholders[1]);
  const games = match.games.filter(game => game.needed && (!match.manual || game.status !== 'scheduled'));
  const score = (game, side) => <b className={game.winner ? (game.winner === side ? 'is-winner' : 'is-loser') : ''}>{(side === 'home' ? game.a : game.b) ?? 0}</b>;
  return <div className="rl-br-games" id={id}>
    {match.manual && <p>Série lançada sem placar por jogo.</p>}
    {games.length > 0 && <ol>{games.map(game => {
      const played = game.status !== 'scheduled';
      const spoken = played ? `${home} ${game.a ?? 0}, ${away} ${game.b ?? 0}${game.status === 'live' ? ', ao vivo' : ''}` : 'ainda não jogado';
      return <li key={game.number} className={`is-${game.status}`} aria-label={`Jogo ${game.number}: ${spoken}`}>
        <span aria-hidden="true">Jogo {game.number}</span><span className="rl-br-game-dot" aria-hidden="true">·</span>
        <span className="rl-br-game-score" aria-hidden="true">{played ? <>{score(game, 'home')}<span>×</span>{score(game, 'away')}</> : '—'}</span>
        {game.status === 'live' && <span className="rl-br-game-live" aria-hidden="true"><i />Ao vivo</span>}
      </li>;
    })}</ol>}
  </div>;
}

function BracketCard({ match, round, open, onToggle }) {
  const played = match.status !== 'scheduled';
  const side = index => (match.winner ? ((index ? match.away : match.home)?.id === match.winner ? 'is-winner' : 'is-loser') : '');
  const label = cardLabel(match.id);
  const series = isSeries(match.format);
  const liveGame = series && match.games.find(game => game.needed && game.status === 'live');
  // Tocar em qualquer parte do card abre ou fecha a lista de jogos.
  return <article className={`rl-br-card is-${match.status} ${match.id === 'F' ? 'is-final' : ''} ${series ? 'has-games' : ''} ${open ? 'is-open' : ''}`} aria-label={`${matchName(match.id)}: ${match.home?.name || shortId(match.placeholders[0])} contra ${match.away?.name || shortId(match.placeholders[1])}`} onClick={series ? onToggle : undefined}>
    <header><strong>{label}</strong><span className="rl-br-format">{formatLabel(round.format)} · {round.venue}</span><StatusBadge status={match.status} /></header>
    <BracketSide team={match.home} placeholder={match.placeholders[0]} score={played ? match.a ?? 0 : '—'} state={side(0)} />
    <BracketSide team={match.away} placeholder={match.placeholders[1]} score={played ? match.b ?? 0 : '—'} state={side(1)} />
    {series && <>
      <button type="button" className="rl-br-toggle" aria-expanded={open} aria-controls={`rl-jogos-${match.id}`}>
        <span>Jogos da série</span>{liveGame && <span className="rl-br-game-live"><i aria-hidden="true" />Jogo {liveGame.number} ao vivo</span>}<ChevronDown size={16} aria-hidden="true" />
      </button>
      <SeriesGames match={match} id={`rl-jogos-${match.id}`} />
    </>}
  </article>;
}
/* Pódio: campeão e vice pela final, 3º lugar pela disputa entre os perdedores
   das semifinais. Cada posição fica "A definir" até sair o resultado. */
const PODIUM = [
  { key: 'champion', label: 'Campeão', Icon: Trophy },
  { key: 'runnerUp', label: 'Vice', Icon: Medal },
  { key: 'third', label: '3º lugar', Icon: Medal },
];
function Podium({ podium }) {
  return <section className="rl-podium" aria-labelledby="rl-podio-titulo">
    <h5 id="rl-podio-titulo" className="rl-visually-hidden">Pódio</h5>
    <ol>{PODIUM.map(({ key, label, Icon }) => <li key={key} className={`is-${key} ${podium[key] ? 'is-decided' : ''}`}>
      <Icon size={key === 'champion' ? 24 : 20} aria-hidden="true" />
      <span><small>{label}</small><strong>{podium[key]?.name || 'A definir'}</strong></span>
    </li>)}</ol>
  </section>;
}

function Bracket({ tournament }) {
  // Um card aberto por vez; tocar fora dele fecha a lista de jogos.
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    if (!openId) return undefined;
    const close = event => { if (!event.target.closest?.('.rl-br-card')) setOpenId(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openId]);
  const card = (match, round) => <BracketCard match={match} round={round} open={openId === match.id} onToggle={() => setOpenId(current => (current === match.id ? null : match.id))} />;
  // O 3º lugar não entra nas colunas: fica na coluna da final, sem conectores.
  const thirdRound = tournament.rounds.find(round => round.id === 'T3');
  return <div className="rl-bracket">{tournament.rounds.filter(round => round !== thirdRound).map(round => <section className={`rl-br-round rl-br-${round.id}`} key={round.id} aria-labelledby={`rl-br-${round.id}-titulo`}>
    <header className="rl-br-heading"><h4 id={`rl-br-${round.id}-titulo`}>{round.id === 'SF' ? 'Semifinais' : round.name}</h4><span>{formatLabel(round.format)} · {round.venue}</span></header>
    <div className="rl-br-slots">{round.matches.map((match, index) => <div key={match.id} className={['rl-br-slot', index % 2 ? 'is-lower' : 'is-upper', match.winner && 'has-winner', match.home && match.away && 'is-fed'].filter(Boolean).join(' ')}>
      {round.id === 'F' ? <div className="rl-br-final">{card(match, round)}<div className="rl-br-third">{card(thirdRound.matches[0], thirdRound)}</div><Podium podium={tournament.podium} /></div> : card(match, round)}
    </div>)}</div>
  </section>)}</div>;
}

export default function MatchSchedule() {
  const { tournament, loaded, updatedAt, offline } = useTournament();
  const live = tournament.groups.flatMap(group => group.matches).concat(tournament.rounds.flatMap(round => round.matches)).filter(match => match.status === 'live').length;
  return <section className="rl-schedule" aria-labelledby="rl-schedule-title">
    <header className="rl-schedule-head">
      <div>
        <h2 id="rl-schedule-title">{site.rocket.gamesTab}</h2>
        <p>Acompanhe os placares, a classificação e o chaveamento da Copa AASIAM.</p>
        <p className="rl-schedule-when"><CalendarDays size={16} aria-hidden="true" /> {site.rocket.schedule.day}</p>
      </div>
      <p className={`rl-sync ${offline ? 'is-offline' : ''}`} role="status" aria-live="polite">
        {offline ? <><WifiOff size={14} aria-hidden="true" /> Sem conexão com o placar. Tentando de novo…</> : !loaded ? <><RefreshCw size={14} className="rl-spin" aria-hidden="true" /> Carregando placares…</> : <><i aria-hidden="true" /> {live ? `${live} ${live === 1 ? 'partida' : 'partidas'} ao vivo. ` : ''}Atualiza sozinho, última às {updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>}
      </p>
    </header>
    <nav className="rl-jump" aria-label="Ir para">{JUMPS.map(item => <a key={item.href} href={item.href}>{item.label}</a>)}</nav>

    <section className="rl-block" aria-labelledby="rl-grupos-titulo">
      <div className="rl-block-head">
        <h3 id="rl-grupos-titulo">Fase de grupos</h3>
        <ul className="rl-zone-legend"><li><i className="is-qualified" aria-hidden="true" /> 1º e 2º: quartas de final</li><li><i className="is-third" aria-hidden="true" /> 3º: disputa vaga de melhor terceiro</li></ul>
      </div>
      <div className="rl-groups">{tournament.groups.map(group => <GroupCard key={group.id} group={group} />)}<ThirdsCard tournament={tournament} /></div>
      <p className="rl-note">{site.rocket.groupNote}</p>
    </section>

    <section className="rl-block" id="rl-mata-mata" aria-labelledby="rl-mata-mata-titulo">
      <div className="rl-block-head">
        <h3 id="rl-mata-mata-titulo">Chaveamento</h3>
        <p>{site.rocket.qualification} {site.rocket.bracketNote}</p>
        <p className="rl-venue"><MapPin size={16} aria-hidden="true" /><span><strong>Semifinais e grande final presenciais</strong> no Auditório da AMF · sábado, 24/10, a partir das 9h</span></p>
      </div>
      <Bracket tournament={tournament} />
    </section>
  </section>;
}
