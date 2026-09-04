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
			kind: 'quantity',
			name: 'Camiseta AASIAM 2026',
			shortName: 'Camiseta 2026',
			description: 'Camiseta oficial AASIAM — Forfan, dry-tech.',
			priceCents: 9000,
			tag: 'Unitário',
			accent: '#12c86b',
			images: ['/imgs/camiseta-aasiam.png'],
		},
		{
			id: 'camiseta-goleiro-aasiam',
			kind: 'quantity',
			name: 'Camiseta Goleiro AASIAM 2026',
			shortName: 'Camiseta Goleiro 2026',
			description: 'Camiseta oficial de goleiro da Atlética de Sistemas da AMF 2026.',
			priceCents: 9000,
			tag: 'Unitário',
			accent: '#12c86b',
			images: ['/imgs/camiseta-aasiam-goleiro.png'],
		},
		{
			id: 'conjunto-chumbo',
			kind: 'twoPieceSet',
			name: 'Conjunto Chumbo AASIAM',
			shortName: 'Conjunto Chumbo AASIAM',
			description: 'Conjunto oficial AASIAM com camiseta e calção.',
			priceCents: 14000,
			tag: 'Camiseta + calção',
			accent: '#303438',
			shirtSizes: HOODIE_SIZES,
			shortsSizes: HOODIE_SIZES,
			defaultShirtSize: 'M',
			defaultShortsSize: 'M',
			images: ['/imgs/conjunto chumbo.png'],
		},
		{
			id: 'conjunto-verde',
			kind: 'twoPieceSet',
			name: 'Conjunto Verde AASIAM',
			shortName: 'Conjunto Verde AASIAM',
			description: 'Conjunto oficial AASIAM com camiseta e calção.',
			priceCents: 14000,
			tag: 'Camiseta + calção',
			accent: '#12c86b',
			shirtSizes: HOODIE_SIZES,
			shortsSizes: HOODIE_SIZES,
			defaultShirtSize: 'M',
			defaultShortsSize: 'M',
			images: ['/imgs/conjunto verde.png'],
		},
		{
			id: 'jersey',
			kind: 'sizedVariants',
			name: 'Jersey AASIAM',
			shortName: 'Jersey AASIAM',
			description: 'Jersey oficial AASIAM.',
			priceCents: 15000,
			tag: 'Escolha o tamanho',
			accent: '#12c86b',
			variants: JERSEY_VARIANTS,
			sizes: HOODIE_SIZES,
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
			{ key: 'shirt', name: 'Camiseta', colors: SHIRT_VARIANTS, sizes: HOODIE_SIZES },
			{ key: 'jersey', name: 'Jersey', colors: JERSEY_VARIANTS, sizes: HOODIE_SIZES },
		],
		fixedItems: [{ name: 'Caneca com tirante', quantity: 1 }],
		images: [
			'/imgs/combo-wolf.png',
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
