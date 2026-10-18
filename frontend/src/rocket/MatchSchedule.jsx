import { pageName } from '../../../backend/shared/page-settings.js';
import { CalendarDays, Clock3, Users } from 'lucide-react';
import { site } from '../settings/site.js';

export default function MatchSchedule() {
  const { groups, rounds } = site.rocket;
  const schedule = { ...site.rocket.schedule, teams: groups.flatMap(group => group.teams) };
  const teamsById = new Map(schedule.teams.map(team => [team.id, team]));

  return <section className="rl-schedule" aria-labelledby="rl-schedule-title">
    <div className="rl-panel-head">
      <span className="rl-eyebrow"><CalendarDays size={16} /> Agenda de {pageName(site, 'rocket')}</span>
      <h2 id="rl-schedule-title">Jogos e duplas</h2>
      <p>Confira os confrontos, os horários e quem entra em campo.</p>
    </div>
    <div className="rl-stage-heading"><h3>Fase de grupos</h3><span>{schedule.teams.length} equipes · {groups.length} grupos</span></div>
    <div className="rl-group-grid">{groups.map(group => <section className="rl-group-card" key={group.id} aria-labelledby={`rl-group-${group.id}`}>
      <div className="rl-group-header"><h3 id={`rl-group-${group.id}`}>Grupo {group.id}</h3><span>{group.teams.length} equipes</span></div>
      <table className="rl-group-table"><caption className="rl-visually-hidden">Equipes do grupo {group.id}, sem classificação definida</caption><thead><tr><th scope="col">Equipe</th><th scope="col"><abbr title="Jogos">J</abbr></th><th scope="col"><abbr title="Pontos">PTS</abbr></th></tr></thead><tbody>{group.teams.map(team => <tr key={team.id}><th scope="row">{team.name}</th><td>—</td><td>—</td></tr>)}</tbody></table>
    </section>)}</div>
    <p className="rl-group-note">{site.rocket.groupNote}</p>
    <div className="rl-callout"><Users size={18} aria-hidden="true" /><p><strong>Classificação para as quartas de final:</strong> {site.rocket.qualification}</p></div>
    <div className="rl-stage-heading"><h3>Chaveamento eliminatório</h3><span>8 equipes · 1 campeão</span></div>
    <p className="rl-group-note">{site.rocket.bracketNote}</p>
    <div className="rl-bracket-scroll" role="region" aria-label="Chaveamento das quartas de final até a final. Role horizontalmente para ver todas as fases." tabIndex={0}>
      <div className="rl-bracket">{rounds.map((round, index) => <section className={`rl-bracket-round rl-bracket-round-${index}`} key={round.name} aria-label={round.name}>
        <div className="rl-bracket-heading"><h4>{round.name}</h4><span>{round.format}</span></div>
        <div className="rl-bracket-matches">{round.matches.map(match => <article className="rl-bracket-match" key={match.id} aria-label={`${match.id}: ${match.sides.join(' contra ')}`}>
          <header>{match.id}<span>A definir</span></header>
          {match.sides.map((side, sideIndex) => <div className="rl-bracket-team" key={sideIndex}><span>{side}</span><b aria-label="Placar a definir">—</b></div>)}
        </article>)}</div>
      </section>)}</div>
    </div>
    {schedule.isMock && <div className="rl-callout"><CalendarDays size={18} aria-hidden="true" /><p><strong>Horários e confrontos de exemplo.</strong> As equipes e os grupos acima já foram informados pela organização. A agenda abaixo é demonstrativa e será substituída pela programação oficial. Esta lista não representa a tabela completa do campeonato.</p></div>}
    <div className="rl-schedule-day"><h3>{schedule.day}</h3><span><Clock3 size={15} aria-hidden="true" /> {schedule.timezone}</span></div>
    <ol className="rl-match-list">{schedule.matches.map(match => <li className="rl-match" key={match.id}>
      <div className="rl-match-time"><time>{match.time}</time><small>{match.id}</small></div>
      <div className="rl-match-body">
        <div className="rl-match-meta"><strong>{match.stage}</strong><span>{match.format}</span></div>
        <div className="rl-match-teams">{[0, 1].map((side) => {
          const team = teamsById.get(match.teams?.[side]);
          return <div className="rl-match-side" key={side}>{side === 1 && <span className="rl-match-vs" aria-label="contra">vs</span>}<div><strong>{team?.name || match.placeholders?.[side] || 'Dupla a definir'}</strong><small>{team?.players.length ? team.players.join(' + ') : 'Jogadores a informar'}</small></div></div>;
        })}</div>
      </div>
    </li>)}</ol>
  </section>;
}
