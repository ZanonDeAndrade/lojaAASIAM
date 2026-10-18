import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, RefreshCw, RotateCcw, Save, Sparkles } from 'lucide-react';
import { buildTournament, formatLabel, GROUPS, QUARTER_FORMATS, STATUS_LABELS, validateResult } from '../../../backend/shared/rocket-tournament.js';
import './tournament-admin.css';

const FILTERS = [{ id: 'A', label: 'Grupo A' }, { id: 'B', label: 'Grupo B' }, { id: 'C', label: 'Grupo C' }, { id: 'KO', label: 'Mata-mata' }, { id: 'teams', label: 'Equipes' }];
const time = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const toNumber = value => (value === '' ? null : Number(value));
const gameCount = format => ({ MD3: 3, MD5: 5 })[format] || 0;

function Card({ title, description, action, children }) {
  return <section className="adm-card"><header className="adm-card-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>{children}</section>;
}

/* Uma partida: placar, status, salvar e zerar. Edições locais não são
   sobrescritas pela atualização automática enquanto não forem salvas. */
function MatchEditor({ match, label, format, onSave }) {
  const games = gameCount(format);
  const server = JSON.stringify({ status: match.status, a: match.a ?? '', b: match.b ?? '', games: Array.from({ length: games }, (_, i) => ({ a: match.games?.[i]?.a ?? '', b: match.games?.[i]?.b ?? '' })) });
  const [draft, setDraft] = useState(() => JSON.parse(server));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  useEffect(() => { if (!dirty) setDraft(JSON.parse(server)); }, [server, dirty]);
  const ready = match.home && match.away;
  function change(next) {
    setDirty(true); setFeedback(null);
    setDraft(current => {
      const merged = { ...current, ...next };
      // Digitar um placar numa partida "A jogar" já a coloca como "Ao vivo".
      if (current.status === 'scheduled' && ('a' in next || 'b' in next || 'games' in next)) merged.status = 'live';
      return merged;
    });
  }
  async function submit(payload) {
    const error = validateResult(format, payload);
    if (error) { setFeedback({ error }); return; }
    setBusy(true); setFeedback(null);
    try { await onSave(match.id, payload); setDirty(false); setFeedback({ ok: `Salvo às ${time()}` }); }
    catch (error) { setFeedback({ error: error.message }); }
    finally { setBusy(false); }
  }
  function save() {
    const filled = draft.games.filter(game => game.a !== '' || game.b !== '').map(game => ({ a: toNumber(game.a), b: toNumber(game.b) }));
    submit({ status: draft.status, a: toNumber(draft.a), b: toNumber(draft.b), games: filled });
  }
  function reset() {
    if (!window.confirm(`Zerar o placar de ${label}? A partida volta para "A jogar".`)) return;
    setDirty(false);
    submit({ status: 'scheduled', a: null, b: null, games: [] });
  }
  const scoreInput = (side, name) => <input type="number" inputMode="numeric" min="0" step="1" aria-label={`${format === 'single' || format === 'MD1' ? 'Gols' : 'Vitórias na série'} de ${name}`} value={draft[side]} disabled={!ready || busy} onChange={event => change({ [side]: event.target.value })} />;
  return <article className={`adm-tour-match is-${match.status} ${dirty ? 'is-dirty' : ''}`}>
    <header><strong>{label}</strong><span className={`adm-tour-status is-${match.status}`}>{STATUS_LABELS[match.status]}</span></header>
    <div className="adm-tour-score">
      <span className="adm-tour-team">{match.home?.name || <em>{match.placeholders?.[0]}</em>}</span>
      {scoreInput('a', match.home?.name || 'time A')}<span aria-hidden="true">×</span>{scoreInput('b', match.away?.name || 'time B')}
      <span className="adm-tour-team is-away">{match.away?.name || <em>{match.placeholders?.[1]}</em>}</span>
    </div>
    {!ready && <p className="adm-context-note">Defina as duas equipes antes de lançar o placar.</p>}
    {games > 0 && ready && <details className="adm-tour-games"><summary>Placar de cada jogo da série (opcional)</summary><div>{draft.games.map((game, index) => <label key={index}><span>Jogo {index + 1}</span><input type="number" inputMode="numeric" min="0" step="1" aria-label={`Gols de ${match.home.name} no jogo ${index + 1}`} value={game.a} disabled={busy} onChange={event => change({ games: draft.games.map((item, i) => (i === index ? { ...item, a: event.target.value } : item)) })} /><span aria-hidden="true">×</span><input type="number" inputMode="numeric" min="0" step="1" aria-label={`Gols de ${match.away.name} no jogo ${index + 1}`} value={game.b} disabled={busy} onChange={event => change({ games: draft.games.map((item, i) => (i === index ? { ...item, b: event.target.value } : item)) })} /></label>)}</div></details>}
    <div className="adm-tour-actions">
      <div className="adm-tour-segment" role="group" aria-label={`Status de ${label}`}>{Object.entries(STATUS_LABELS).map(([status, text]) => <button type="button" key={status} aria-pressed={draft.status === status} disabled={!ready || busy} onClick={() => change({ status })}>{text}</button>)}</div>
      <button type="button" className="adm-primary" disabled={!ready || busy || !dirty} onClick={save}><Save size={15} /> {busy ? 'Salvando…' : 'Salvar'}</button>
      <button type="button" title="Zerar placar" disabled={busy || match.status === 'scheduled'} onClick={reset}><RotateCcw size={15} /> Zerar</button>
    </div>
    {feedback?.error && <p className="adm-error" role="alert">{feedback.error}</p>}
    {feedback?.ok && <p className="adm-tour-ok" role="status"><Check size={14} /> {feedback.ok}</p>}
  </article>;
}

function MiniStandings({ group }) {
  return <div className="adm-tour-table-wrap"><table className="adm-tour-table"><thead><tr><th>#</th><th>Equipe</th><th>J</th><th>V</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>Pts</th></tr></thead><tbody>{group.standings.map(row => <tr key={row.team.id} className={row.zone ? `is-${row.zone}` : ''}><td>{row.position}</td><th>{row.team.name}</th><td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.gf}</td><td>{row.ga}</td><td>{row.gd}</td><td><b>{row.points}</b></td></tr>)}</tbody></table></div>;
}

function TieBreaker({ title, ids, teams, onSave }) {
  const [order, setOrder] = useState(ids);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setOrder(ids), [ids.join()]);
  const name = id => teams.find(team => team.id === id)?.name;
  function move(index, direction) { const next = [...order]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; setOrder(next); }
  async function save() { setBusy(true); setError(''); try { await onSave(order); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <div className="adm-tour-tie"><strong>{title}</strong><p className="adm-context-note">Pontos, saldo, gols e confronto direto não separaram estas equipes. Ordene conforme o sorteio e salve.</p><ol>{order.map((id, index) => <li key={id}><span>{index + 1}. {name(id)}</span><button type="button" aria-label={`Subir ${name(id)}`} disabled={!index} onClick={() => move(index, -1)}><ArrowUp size={14} /></button><button type="button" aria-label={`Descer ${name(id)}`} disabled={index === order.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button></li>)}</ol><button type="button" className="adm-primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar ordem do sorteio'}</button>{error && <p className="adm-error" role="alert">{error}</p>}</div>;
}

function QuartersEditor({ view, onSave }) {
  const server = JSON.stringify({ format: view.state.quarterFormat, quarters: view.state.quarters });
  const [draft, setDraft] = useState(() => JSON.parse(server));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  useEffect(() => { if (!dirty) setDraft(JSON.parse(server)); }, [server, dirty]);
  function change(next) { setDraft(current => ({ ...current, ...next })); setDirty(true); setFeedback(null); }
  async function save() {
    setBusy(true); setFeedback(null);
    try { await onSave({ quarterFormat: draft.format, quarters: draft.quarters }); setDirty(false); setFeedback({ ok: `Confrontos salvos às ${time()}` }); }
    catch (error) { setFeedback({ error: error.message }); }
    finally { setBusy(false); }
  }
  const seedLabel = id => { const index = view.seeds?.indexOf(id); return index >= 0 ? ` (classificado ${index + 1})` : ''; };
  return <Card title="Formato e confrontos das quartas" description="Escolha as equipes de cada quarta. A sugestão segue a classificação (1×8, 4×5, 2×7, 3×6) e evita equipes do mesmo grupo; você pode editar antes de salvar." action={<button type="button" disabled={!view.suggestion} onClick={() => change({ quarters: view.suggestion })} title={view.suggestion ? '' : 'Disponível quando todos os jogos dos grupos estiverem encerrados'}><Sparkles size={15} /> Sugerir pela classificação</button>}>
    {!view.suggestion && <p className="adm-context-note">A sugestão fica disponível quando os 26 jogos dos grupos estiverem encerrados.</p>}
    <label className="adm-field adm-tour-format"><span>Formato das quartas</span><select value={draft.format} onChange={event => change({ format: event.target.value })}>{QUARTER_FORMATS.map(format => <option key={format} value={format}>{formatLabel(format)}</option>)}</select></label>
    <div className="adm-tour-quarters">{draft.quarters.map((pair, index) => <fieldset key={index}><legend>QF{index + 1}</legend>{pair.map((id, side) => <select key={side} aria-label={`QF${index + 1}, equipe ${side + 1}`} value={id || ''} onChange={event => change({ quarters: draft.quarters.map((item, i) => (i === index ? item.map((team, s) => (s === side ? event.target.value || null : team)) : item)) })}><option value="">Classificado {index * 2 + side + 1} (a definir)</option>{GROUPS.map(group => <optgroup key={group.id} label={`Grupo ${group.id}`}>{group.teams.map(teamId => <option key={teamId} value={teamId}>{view.teams.find(team => team.id === teamId).name}{seedLabel(teamId)}</option>)}</optgroup>)}</select>)}</fieldset>)}</div>
    <div className="adm-tour-actions"><button type="button" className="adm-primary" disabled={busy || !dirty} onClick={save}><Save size={15} /> {busy ? 'Salvando…' : 'Salvar confrontos'}</button></div>
    {feedback?.error && <p className="adm-error" role="alert">{feedback.error}</p>}
    {feedback?.ok && <p className="adm-tour-ok" role="status"><Check size={14} /> {feedback.ok}</p>}
  </Card>;
}

function TeamsEditor({ view, onSave }) {
  const server = JSON.stringify(Object.fromEntries(view.teams.map(team => [team.id, { name: team.name, players: team.players.join(', ') }])));
  const [draft, setDraft] = useState(() => JSON.parse(server));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  useEffect(() => { if (!dirty) setDraft(JSON.parse(server)); }, [server, dirty]);
  function change(id, field, value) { setDraft(current => ({ ...current, [id]: { ...current[id], [field]: value } })); setDirty(true); setFeedback(null); }
  async function save() {
    setBusy(true); setFeedback(null);
    try { await onSave({ teams: Object.fromEntries(Object.entries(draft).map(([id, team]) => [id, { name: team.name, players: team.players.split(',').map(player => player.trim()).filter(Boolean) }])) }); setDirty(false); setFeedback({ ok: `Equipes salvas às ${time()}` }); }
    catch (error) { setFeedback({ error: error.message }); }
    finally { setBusy(false); }
  }
  return <Card title="Nomes das equipes e jogadores" description="Os jogadores só aparecem no site quando forem preenchidos. Separe os nomes por vírgula.">
    {GROUPS.map(group => <fieldset className="adm-tour-teams" key={group.id}><legend>Grupo {group.id}</legend>{group.teams.map(id => <div key={id}><label className="adm-field"><span>Equipe</span><input value={draft[id].name} maxLength={40} onChange={event => change(id, 'name', event.target.value)} /></label><label className="adm-field"><span>Jogadores (opcional)</span><input value={draft[id].players} placeholder="Ex.: Ana, Bruno" onChange={event => change(id, 'players', event.target.value)} /></label></div>)}</fieldset>)}
    <div className="adm-tour-actions"><button type="button" className="adm-primary" disabled={busy || !dirty} onClick={save}><Save size={15} /> {busy ? 'Salvando…' : 'Salvar equipes'}</button></div>
    {feedback?.error && <p className="adm-error" role="alert">{feedback.error}</p>}
    {feedback?.ok && <p className="adm-tour-ok" role="status"><Check size={14} /> {feedback.ok}</p>}
  </Card>;
}

export default function TournamentAdmin({ request }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('A');
  const [loadedAt, setLoadedAt] = useState('');
  const view = useMemo(() => state && buildTournament(state), [state]);
  async function refresh() {
    try { const data = await request('/torneio'); setState(data.torneio); setLoadedAt(time()); setError(''); }
    catch (e) { setError(e.message); }
  }
  // Outros organizadores podem lançar placares ao mesmo tempo.
  useEffect(() => { refresh(); const timer = setInterval(refresh, 30000); return () => clearInterval(timer); }, []);
  async function send(path, body) { const data = await request(path, { method: 'POST', body: JSON.stringify(body) }); setState(data.torneio); setLoadedAt(time()); }
  const saveMatch = (id, payload) => send(`/torneio/partidas/${id}`, payload);
  const saveTie = key => order => send('/torneio/desempate', { key, order });
  if (!view) return <div className="adm-section-stack">{error ? <p className="adm-feedback adm-error" role="alert">{error}</p> : <p className="adm-context-note">Carregando placares…</p>}<button type="button" onClick={refresh}><RefreshCw size={15} /> Tentar novamente</button></div>;
  const group = view.groups.find(item => item.id === filter);
  return <div className="adm-section-stack adm-tour">
    <div className="adm-tour-bar"><nav className="adm-tabs" aria-label="Filtrar partidas">{FILTERS.map(item => <button type="button" key={item.id} aria-pressed={filter === item.id} className={filter === item.id ? 'is-selected' : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}</nav><button type="button" onClick={refresh}><RefreshCw size={15} /> Atualizar{loadedAt && <small>{loadedAt}</small>}</button></div>
    {error && <p className="adm-feedback adm-error" role="alert">{error}</p>}
    {group && <>
      <Card title={`Classificação · Grupo ${group.id}`} description="Recalculada a cada placar encerrado. Partidas ao vivo não contam.">
        <MiniStandings group={group} />
        {group.ties.map(ids => <TieBreaker key={ids.join()} title={`Empate no Grupo ${group.id}`} ids={ids} teams={view.teams} onSave={saveTie(group.id)} />)}
      </Card>
      <div className="adm-tour-list">{group.matches.map(match => <MatchEditor key={match.id} match={match} format="single" label={`Grupo ${group.id} · Jogo ${match.number}`} onSave={saveMatch} />)}</div>
    </>}
    {filter === 'KO' && <>
      {view.groupsComplete && <Card title="Classificados" description="Sementes calculadas pela classificação final dos grupos."><ol className="adm-tour-seeds">{view.seeds.map(id => { const team = view.teams.find(item => item.id === id); return <li key={id}>{team.name} <small>Grupo {team.group}</small></li>; })}</ol>{view.thirdTies.map(ids => <TieBreaker key={ids.join()} title="Empate entre os terceiros colocados" ids={ids} teams={view.teams} onSave={saveTie('thirds')} />)}</Card>}
      <QuartersEditor view={view} onSave={body => send('/torneio/mata-mata', body)} />
      {view.rounds.map(round => <div className="adm-tour-list" key={round.id}><h3 className="adm-tour-round">{round.name} · {formatLabel(round.format)} · {round.venue}</h3>{round.matches.map(match => <MatchEditor key={match.id} match={match} format={match.format} label={match.id === 'F' ? 'Grande final' : match.id} onSave={saveMatch} />)}</div>)}
    </>}
    {filter === 'teams' && <TeamsEditor view={view} onSave={body => send('/torneio/equipes', body)} />}
  </div>;
}
