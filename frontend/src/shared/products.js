export const HOODIE_SIZES = ['PP', 'P', 'M', 'G', 'GG', 'XG'];

export const HOODIE_VARIANTS = [
		{
			code: 'verde',
			name: 'Verde',
			description: 'Preto com verde neon da atlética.',
		swatch: '#12c86b',
	},
	{
		code: 'bege',
		name: 'Off-white',
		description: 'Base off-white com contraste preto e verde.',
		swatch: '#c9b789',
	},
];

// Cores da camiseta que compõe o Combo Wolf.
export const SHIRT_VARIANTS = [
	{ code: 'verde', name: 'Verde', swatch: '#0b5149' },
	{ code: 'chumbo', name: 'Chumbo', swatch: '#303438' },
];

// Colorways comercializadas da Jersey, independentes da imagem de referência.
export const JERSEY_VARIANTS = [
	{ code: 'branca', name: 'Branca', swatch: '#f4f1e8', border: '#b9b2a2' },
	{ code: 'preta', name: 'Preta', swatch: '#252426' },
];

/* ─── Atributos reutilizáveis dos produtos personalizáveis ────────────────
   `chipLabel` monta a descrição curta do item ("Tam. M", "Preta"); `{value}`
   é o código e `{name}` o rótulo da opção. `personalization` liga os campos
   de nome/número — `noun` só decide o texto do label no frontend. */
const sizeAttribute = (key, label, chipLabel) => ({
	key,
	label,
	options: HOODIE_SIZES,
	chipLabel,
});
const colorAttribute = (options, label = 'Cor') => ({
	key: 'color',
	label,
	options,
	chipLabel: '{name}',
});
const SHIRT_PERSONALIZATION = { noun: 'camiseta' };

export const BACKPACK_MODELS = [
	{
		code: 'listras',
		name: 'Listras',
		description: 'Modelo leve para rotina de aula.',
	},
		{
			code: 'estampa',
			name: 'Estampa',
			description: 'Modelo reforçado com mais compartimentos.',
	},
];

export const PRODUCTS = [
		{
			id: 'moletom-verde',
			kind: 'sizedVariants',
			name: 'Moletom Verde',
			shortName: 'Moletom Verde',
			description:
				'Visual clássico e versátil, com a identidade da Alcateia estampada no peito. Conforto, estilo e orgulho de representar a AASIAM.',
		priceCents: 16000,
		tag: 'Escolha o tamanho',
		accent: '#12c86b',
		hasHoodie: true,
		variants: [HOODIE_VARIANTS[0]],
		sizes: HOODIE_SIZES,
		images: ['imgs/moletom-verde.png'],
	},
		{
			id: 'moletom-bege',
			kind: 'sizedVariants',
			name: 'Moletom Off-white',
			shortName: 'Moletom Off-white',
			description:
				'Peça exclusiva com arte do lobo da Alcateia nas costas, representando força, união e pertencimento à AASIAM. Ideal para quem quer se destacar.',
		priceCents: 16000,
		tag: 'Escolha o tamanho',
		accent: '#c9b789',
		hasHoodie: true,
		variants: [HOODIE_VARIANTS[1]],
		sizes: HOODIE_SIZES,
		images: ['/imgs/moletom-off-white.png'],
	},
		{
			id: 'kit-2-moletons',
			kind: 'doubleHoodie',
			name: 'Combo Essencial',
			shortName: 'Combo Essencial AASIAM',
			description:
				'O Combo Essencial reúne as duas peças principais da Coleção Alcateia: o moletom verde e o moletom off-white. Uma combinação perfeita para quem quer ter as duas versões da coleção e representar a AASIAM em diferentes ocasiões, unindo conforto, estilo e identidade em um único pacote.',
		priceCents: 29000,
			tag: 'Verde + Off-white',
		accent: '#7fff8a',
			includes: ['Moletom Verde', 'Moletom Off-white'],
		variants: HOODIE_VARIANTS,
		sizes: HOODIE_SIZES,
		defaultVerdeSize: 'M',
		defaultBegeSize: 'M',
		images: [
			'imgs/combo01.png',
			'/imgs/moletom-verde.png',
			'/imgs/moletom-off-white.png',
		],
	},
		{
			id: 'kit-moletom-caneca',
			kind: 'configuredBundle',
			name: 'Combo Alcateia',
			shortName: 'Combo Alcateia',
			description:
				'O Combo Alcateia foi pensado para quem deseja levar a experiência completa da atlética para o dia a dia. Além do moletom de sua escolha, o kit acompanha a caneca temática e o tirante exclusivo da coleção, criando uma combinação prática e cheia de personalidade para representar a AASIAM dentro e fora da faculdade.',
		priceCents: 18500,
		tag: 'Combo',
		accent: '#9ff34f',
		includes: ['Moletom', 'Caneca'],
		hasHoodie: true,
		variants: HOODIE_VARIANTS,
		sizes: HOODIE_SIZES,
		defaultHoodieVariant: 'verde',
		defaultHoodieSize: 'M',
		images: [
			'/imgs/combo02.png',
			'/imgs/moletom-verde.png',
			'/imgs/moletom-off-white.png',
			'/imgs/copo.png',
		],
	},
		{
			id: 'caneca',
			kind: 'quantity',
			name: 'Caneca com tirante',
			shortName: 'Caneca',
			description:
				'Kit exclusivo da AASIAM que reúne uma caneca temática e um tirante personalizado, ideal para representar a Alcateia em qualquer momento.',
		priceCents: 4000,
		tag: 'Unitário',
		accent: '#e8f7ef',
		images: ['/imgs/copo.png'],
	},
		{
			id: 'mochila-listras',
			kind: 'quantity',
			name: 'Mochila com Listras',
			shortName: 'Mochila Listras',
			description:
					'Mochila esportiva exclusiva da AASIAM. As três listras verdes homenageiam a antiga camisa da Atlética, trazendo história e identidade para um modelo leve e versátil.',
			priceCents: 4000,
			tag: 'Modelo listras',
			soldOut: true,
			accent: '#0b1110',
			images: ['/imgs/mochila-listras.png'],
		},
		{
			id: 'mochila-estampa',
			kind: 'quantity',
			name: 'Mochila com Estampa',
			shortName: 'Mochila Estampa',
			description:
					'Modelo exclusivo com estampa de lobos em tom sobre tom, combinando identidade, estilo e funcionalidade para representar a Alcateia em qualquer ocasião.',
			priceCents: 4000,
			tag: 'Modelo estampa',
			soldOut: true,
			accent: '#0b1110',
			images: ['/imgs/mochila-estampa.png'],
		},
		{
			id: 'camiseta-aasiam',
			kind: 'personalizedProduct',
			name: 'Camiseta AASIAM 2026',
			shortName: 'Camiseta 2026',
			description: 'Camiseta oficial AASIAM — Forfan, dry-tech.',
			priceCents: 9000,
			tag: 'Escolha o tamanho',
			accent: '#12c86b',
			sizes: HOODIE_SIZES,
			attributes: [sizeAttribute('size', 'Tamanho', 'Tam. {value}')],
			personalization: SHIRT_PERSONALIZATION,
			images: ['/imgs/camiseta-aasiam.png'],
		},
		{
			id: 'camiseta-goleiro-aasiam',
			kind: 'personalizedProduct',
			name: 'Camiseta Goleiro AASIAM 2026',
			shortName: 'Camiseta Goleiro 2026',
			description: 'Camiseta oficial de goleiro da Atlética de Sistemas da AMF 2026.',
			priceCents: 9000,
			tag: 'Escolha o tamanho',
			accent: '#12c86b',
			sizes: HOODIE_SIZES,
			attributes: [sizeAttribute('size', 'Tamanho', 'Tam. {value}')],
			personalization: SHIRT_PERSONALIZATION,
			images: ['/imgs/camiseta-aasiam-goleiro.png'],
		},
		{
			id: 'conjunto-chumbo',
			kind: 'personalizedProduct',
			name: 'Conjunto Chumbo AASIAM',
			shortName: 'Conjunto Chumbo AASIAM',
			description: 'Conjunto oficial AASIAM com camiseta e calção.',
			priceCents: 14000,
			tag: 'Camiseta + calção',
			accent: '#303438',
			shirtSizes: HOODIE_SIZES,
			shortsSizes: HOODIE_SIZES,
			attributes: [
				sizeAttribute('shirtSize', 'Tamanho da camiseta', 'Camiseta {value}'),
				sizeAttribute('shortsSize', 'Tamanho do calção', 'Calção {value}'),
			],
			personalization: SHIRT_PERSONALIZATION,
			images: ['/imgs/conjunto chumbo.png'],
		},
		{
			id: 'conjunto-verde',
			kind: 'personalizedProduct',
			name: 'Conjunto Verde AASIAM',
			shortName: 'Conjunto Verde AASIAM',
			description: 'Conjunto oficial AASIAM com camiseta e calção.',
			priceCents: 14000,
			tag: 'Camiseta + calção',
			accent: '#12c86b',
			shirtSizes: HOODIE_SIZES,
			shortsSizes: HOODIE_SIZES,
			attributes: [
				sizeAttribute('shirtSize', 'Tamanho da camiseta', 'Camiseta {value}'),
				sizeAttribute('shortsSize', 'Tamanho do calção', 'Calção {value}'),
			],
			personalization: SHIRT_PERSONALIZATION,
			images: ['/imgs/conjunto verde.png'],
		},
		{
			id: 'jersey',
			kind: 'personalizedProduct',
			name: 'Jersey AASIAM',
			shortName: 'Jersey AASIAM',
			description: 'Jersey oficial AASIAM.',
			priceCents: 15000,
			tag: 'Escolha o tamanho',
			accent: '#12c86b',
			variants: JERSEY_VARIANTS,
			sizes: HOODIE_SIZES,
			attributes: [
				colorAttribute(JERSEY_VARIANTS),
				sizeAttribute('size', 'Tamanho', 'Tam. {value}'),
			],
			personalization: { noun: 'Jersey' },
			images: ['/imgs/jerseys.png'],
		},
		{
			id: 'manta',
			kind: 'quantity',
			name: 'Cachecol',
			shortName: 'Manta',
			description:
					'Cachecol oficial da AASIAM, desenvolvido para demonstrar orgulho e pertencimento. Perfeito para eventos, competições e momentos de integração da Atlética.',
		priceCents: 5000,
		tag: 'Conforto',
		soldOut: true,
		accent: '#213a2c',
		images: ['/imgs/manta.png'],
	},
	{
		id: 'combo-signature',
		kind: 'multiPieceBundle',
		name: 'Combo Signature',
		shortName: 'Combo Signature',
		description:
			'O Combo Signature fecha duas camisetas da Coleção Alcateia numa cartela única: uma verde e uma chumbo. As cores são fixas; escolha tamanho, nome e número de cada camiseta separadamente.',
		priceCents: 16000,
		tag: '2 camisetas',
		accent: '#0b5149',
		includes: ['Camiseta Verde', 'Camiseta Chumbo'],
		pieces: [
			{
				key: 'greenShirt',
				name: 'Camiseta Verde',
				colors: [SHIRT_VARIANTS[0]],
				sizes: HOODIE_SIZES,
				personalization: SHIRT_PERSONALIZATION,
			},
			{
				key: 'charcoalShirt',
				name: 'Camiseta Chumbo',
				colors: [SHIRT_VARIANTS[1]],
				sizes: HOODIE_SIZES,
				personalization: SHIRT_PERSONALIZATION,
			},
		],
		coverImage: '/imgs/combo-signature.png',
		coverFit: 'contain',
		galleryFit: 'contain',
		images: ['/imgs/camiseta-aasiam.png'],
	},
	{
		id: 'combo-territorio',
		kind: 'multiPieceBundle',
		name: 'Combo Território',
		shortName: 'Combo Território',
		description:
			'O Combo Território junta a Jersey oficial da Alcateia à caneca com tirante da coleção. Escolha cor, tamanho, nome e número da Jersey; a caneca acompanha o kit.',
		priceCents: 18000,
		tag: 'Jersey + Caneca',
		accent: '#12c86b',
		includes: ['Jersey', 'Caneca com tirante'],
		pieces: [
			{
				key: 'jersey',
				name: 'Jersey',
				colors: JERSEY_VARIANTS,
				sizes: HOODIE_SIZES,
				personalization: { noun: 'Jersey' },
			},
		],
		fixedItems: [{ name: 'Caneca com tirante', quantity: 1 }],
		coverImage: '/imgs/combo-territorio.png',
		coverFit: 'contain',
		galleryFit: 'contain',
		images: ['/imgs/jerseys.png', '/imgs/copo.png'],
	},
	{
		id: 'combo-dominio',
		kind: 'multiPieceBundle',
		name: 'Combo Domínio',
		shortName: 'Combo Domínio',
		description:
			'O Combo Domínio reúne o moletom e a camiseta da Coleção Alcateia. Escolha a cor e o tamanho do moletom, a cor e o tamanho da camiseta, e personalize a camiseta com nome e número.',
		priceCents: 23000,
		tag: 'Moletom + Camiseta',
		accent: '#12c86b',
		includes: ['Moletom', 'Camiseta'],
		pieces: [
			{ key: 'hoodie', name: 'Moletom', colors: HOODIE_VARIANTS, sizes: HOODIE_SIZES },
			{
				key: 'shirt',
				name: 'Camiseta',
				colors: SHIRT_VARIANTS,
				sizes: HOODIE_SIZES,
				personalization: SHIRT_PERSONALIZATION,
			},
		],
		coverImage: '/imgs/combo-dominio.png',
		coverFit: 'contain',
		galleryFit: 'contain',
		images: [
			'/imgs/moletom-verde.png',
			'/imgs/moletom-off-white.png',
			'/imgs/camiseta-aasiam.png',
		],
	},
	{
		id: 'combo-wolf',
		kind: 'multiPieceBundle',
		name: 'Combo Wolf',
		shortName: 'Combo Wolf',
		description:
			'O Combo Wolf reúne quatro peças da Coleção Alcateia em um único kit: moletom, camiseta, caneca com tirante e Jersey. Escolha as cores e tamanhos das peças para representar a AASIAM dentro e fora da faculdade.',
		priceCents: 41500,
		tag: '4 peças',
		accent: '#18f08a',
		includes: ['Moletom', 'Camiseta', 'Caneca com tirante', 'Jersey'],
		pieces: [
			{ key: 'hoodie', name: 'Moletom', colors: HOODIE_VARIANTS, sizes: HOODIE_SIZES },
			{
				key: 'shirt',
				name: 'Camiseta',
				colors: SHIRT_VARIANTS,
				sizes: HOODIE_SIZES,
				personalization: SHIRT_PERSONALIZATION,
			},
			{ key: 'jersey', name: 'Jersey', colors: JERSEY_VARIANTS, sizes: HOODIE_SIZES },
		],
		fixedItems: [{ name: 'Caneca com tirante', quantity: 1 }],
		// Capa (card + carrinho) separada da galeria. Só o frontend renderiza:
		// não vai para o backend nem para o teste de paridade comercial.
		coverImage: '/imgs/wolfc.png',
		// A arte tem "COMBO" colado no topo — `contain` no card mostra tudo sem
		// aumentar o box (as bordas da arte já são pretas, sem emenda visível).
		coverFit: 'contain',
		// A galeria mostra as peças soltas — nada é cortado (ver `.gallery-contain`).
		galleryFit: 'contain',
		images: [
			'/imgs/moletom-verde.png',
			'/imgs/camiseta-aasiam.png',
			'/imgs/jerseys.png',
			'/imgs/copo.png',
		],
	},
];

// Preços de custo (centavos) — aplicados quando um cupom de associado é usado
const COST_CENTS = {
	'moletom-verde': 13000,
	'moletom-bege': 13000,
	'caneca': 2800,
	'mochila-listras': 3500,
	'mochila-estampa': 3500,
	'manta': 5000,
	'kit-2-moletons': 26000,
	'kit-moletom-caneca': 15800,
};
for (const _p of PRODUCTS) {
	if (COST_CENTS[_p.id] != null) _p.costCents = COST_CENTS[_p.id];
}

export const PRODUCT_BY_ID = Object.fromEntries(
	PRODUCTS.map(product => [product.id, product]),
);
