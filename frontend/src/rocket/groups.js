export const groups = [
  { id: 'A', names: ['Garotos de programa', 'Beekeepers', 'Unidos puntel', 'Fórmula 67', 'Bolinha e fumaça'] },
  { id: 'B', names: ['Bola mansa', 'Bola murcha', 'No flip No Reset', 'Picape Sando', 'Os Facão'] },
  { id: 'C', names: ['Meninos de Gothan', 'A Dupra', 'Bacharel em Lambari', 'Quase Pro'] },
].map(group => ({ id: group.id, teams: group.names.map((name, index) => ({ id: `${group.id}-${index}`, name, players: [] })) }));
