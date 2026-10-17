import { groups } from './groups.js';

// Dados de demonstração. Substitua as equipes e os jogos pelos dados oficiais.
// Os IDs relacionam cada confronto à sua dupla, sem repetir nomes na agenda.
export const schedule = {
  isMock: true,
  day: 'Dia de exemplo — data a confirmar',
  timezone: 'Horário de Brasília',
  teams: groups.flatMap(group => group.teams),
  matches: [
    { id: 'J01', time: '19:00', stage: 'Fase de grupos', format: 'Partida única', teams: ['A-0', 'A-1'] },
    { id: 'J02', time: '19:15', stage: 'Fase de grupos', format: 'Partida única', teams: ['A-2', 'A-3'] },
    { id: 'J03', time: '19:30', stage: 'Fase de grupos', format: 'Partida única', teams: ['B-0', 'B-1'] },
    { id: 'J04', time: '19:45', stage: 'Fase de grupos', format: 'Partida única', teams: ['C-0', 'C-1'] },
    { id: 'J05', time: '20:30', stage: 'Semifinal 1', format: 'MD3 · Online', placeholders: ['Classificada 1', 'Classificada 2'] },
    { id: 'J06', time: '21:00', stage: 'Semifinal 2', format: 'MD3 · Online', placeholders: ['Classificada 3', 'Classificada 4'] },
    { id: 'J07', time: '22:00', stage: 'Grande final', format: 'MD5 · Presencial', placeholders: ['Vencedora da semifinal 1', 'Vencedora da semifinal 2'] },
  ],
};
