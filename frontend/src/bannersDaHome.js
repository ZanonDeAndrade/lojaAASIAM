/**
 * Banners dos eventos no carrossel da home.
 *
 * A ordem da lista é a de base. Um banner com `primeiroAte` fura a fila e vem
 * primeiro até aquele instante — é assim que o Torneio Rocket League abre o
 * carrossel até o fim de 17/10 e, a partir de 18/10 00:00 (Brasília), o
 * churrasco da Semana Acadêmica passa a ser o primeiro sozinho, sem ninguém
 * mexer no código.
 *
 * ATENÇÃO: o `index.html` pré-carrega o primeiro banner com o mesmo corte de
 * data. Se mudar `primeiroAte` ou a ordem aqui, mude lá também.
 */
export const BANNERS_DA_HOME = [
	{
		id: 'churrasco-semana-academica',
		titulo: 'Churrasco da AASIAM na Semana Acadêmica',
		href: '/churrasco-semana-academica',
		src: '/imgs/banner-churrasco-semana-academica.png',
		largura: 2172,
		altura: 724,
		alt:
			'Churrasco da AASIAM na Semana Acadêmica de Sistemas de Informação, 24/10 ao meio-dia: ' +
			'três lobos verdes da atlética assando carne, salsichão e frango numa churrasqueira. ' +
			'Abre a página de inscrição.',
	},
	{
		id: 'torneio-rocket-league',
		titulo: 'Torneio Rocket League',
		href: '/torneio-rocket-league',
		src: '/imgs/banner-torneio-rocket-league.png',
		largura: 1600,
		altura: 584,
		alt:
			'Torneio de Rocket League da AASIAM: o lobo da atlética pilota um carro verde em direção ' +
			'à bola num estádio iluminado. Abre a página de inscrição das equipes.',
		// Fim de 17/10/2026 em Brasília (UTC-03:00).
		primeiroAte: '2026-10-18T00:00:00-03:00',
	},
];

/** A lista na ordem do momento: quem ainda está no prazo de `primeiroAte` vem antes. */
export function ordenarBanners(banners, agora = Date.now()) {
	const furaFila = (banner) =>
		Boolean(banner.primeiroAte) && agora < Date.parse(banner.primeiroAte);
	return [...banners.filter(furaFila), ...banners.filter((banner) => !furaFila(banner))];
}

/** A proporção da arte mais alta: com ela, todas cabem inteiras na mesma caixa. */
export function proporcaoDaCaixa(banners) {
	return Math.min(...banners.map((banner) => banner.largura / banner.altura));
}
