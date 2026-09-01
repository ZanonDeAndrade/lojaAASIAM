/**
 * Configuração da página /churrasco.
 *
 * Nada aqui é inventado: os campos de logística ficam vazios até a organização
 * definir. Um campo vazio simplesmente não é renderizado — a página continua
 * correta sem ele. Basta preencher a string para o item aparecer.
 */
export const CHURRASCO_EVENTO = {
  titulo: 'Churrasco da Alcateia',
  subtitulo:
    'Garanta sua participação no churrasco da Atlética de Sistemas de Informação.',

  // ── Preencher quando a organização definir ──────────────────────────
  data: '',            // ex: '12 de setembro de 2026'
  horario: '',         // ex: '12h às 18h'
  local: '',           // ex: 'Sede campestre da AASIAM'
};

/**
 * Mascote recortado do fundo creme original (`scripts/cutout-lobo.mjs`).
 * A arte original continua em `assets-src/` e em `/imgs/lobo-churrasco.png`.
 */
export const LOBO_IMAGE = {
  webp: '/imgs/lobo-churrasco-transparente.webp',
  fallback: '/imgs/lobo-churrasco-transparente.png',
  width: 1137,
  height: 1201,
  alt:
    'Mascote da Atlética de Sistemas de Informação: um lobo musculoso de pelagem verde, ' +
    'com o emblema "SI" no peito, assando carnes, linguiças e frango em uma churrasqueira.',
};

/** Só os itens efetivamente preenchidos vão para a tela. */
export function detalhesPreenchidos(evento = CHURRASCO_EVENTO) {
  return [
    { chave: 'data', rotulo: 'Data', valor: evento.data },
    { chave: 'horario', rotulo: 'Horário', valor: evento.horario },
    { chave: 'local', rotulo: 'Local', valor: evento.local },
  ].filter((item) => Boolean(item.valor && item.valor.trim()));
}
