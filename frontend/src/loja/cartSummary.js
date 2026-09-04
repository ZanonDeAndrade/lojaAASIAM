/**
 * Detalhes ESTRUTURADOS de um item do carrinho para o resumo do checkout.
 *
 * O carrinho já carrega `_sel` (a seleção crua) e `productId`; o catálogo tem
 * `pieces`/`attributes`/`variants`. Aqui esses dados viram grupos legíveis —
 * sem partir a string `item.meta` por " · ".
 *
 * Formato: `{ groups: [{ heading, rows: [{ label?, value }] }] }`.
 *  - `heading` nulo  → produto de peça única (sem subtítulo).
 *  - `row.label`     → prefixo discreto ("Tamanho", "Nome"); ausente = linha solta.
 */
import { PRODUCTS } from '../shared/products.js';
import {
	attributeOption,
	normalizePersonalizationName,
	normalizePersonalizationNumber,
} from '../shared/order.js';

const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

/** Linhas de personalização preenchidas (nome/número são opcionais). */
function personalizationRows(rawName, rawNumber) {
	const nome = normalizePersonalizationName(rawName);
	const numero = normalizePersonalizationNumber(rawNumber);
	const rows = [];
	if (nome) rows.push({ label: 'Nome', value: nome });
	if (numero) rows.push({ label: 'Número', value: numero });
	return rows;
}

/** A cor já está no nome da peça? (ex.: "Camiseta Verde" + cor fixa "Verde"). */
function colorIsInName(piece, color) {
	return (
		piece.colors.length === 1 &&
		color &&
		piece.name.toLowerCase().includes(color.name.toLowerCase())
	);
}

export function cartItemGroups(item) {
	const product = PRODUCT_BY_ID[item?.productId];
	const sel = item?._sel || {};
	if (!product) return { groups: [] };

	if (product.kind === 'multiPieceBundle') {
		const groups = product.pieces.map(piece => {
			const color =
				piece.colors.find(c => c.code === sel[`${piece.key}Color`]) || piece.colors[0];
			const size = sel[`${piece.key}Size`] || '—';
			const rows = [
				colorIsInName(piece, color)
					? { label: 'Tamanho', value: size }
					: { value: `${color?.name || '—'} / ${size}` },
			];
			if (piece.personalization) {
				rows.push(
					...personalizationRows(
						sel[`${piece.key}PersonalizationName`],
						sel[`${piece.key}PersonalizationNumber`],
					),
				);
			}
			return { heading: piece.name, rows };
		});
		for (const fixed of product.fixedItems || []) {
			const n = fixed.quantity;
			groups.push({
				heading: fixed.name,
				rows: [{ value: `${n} unidade${n === 1 ? '' : 's'}` }],
			});
		}
		return { groups };
	}

	if (product.kind === 'personalizedProduct') {
		const rows = [];
		for (const attribute of product.attributes || []) {
			const option = attributeOption(attribute, sel[attribute.key]);
			if (!option) continue;
			rows.push({ label: attribute.label, value: option.name ?? option });
		}
		rows.push(...personalizationRows(sel.personalizationName, sel.personalizationNumber));
		return { groups: [{ heading: null, rows }] };
	}

	if (product.kind === 'sizedVariants') {
		const variant =
			product.variants.find(v => v.code === sel.variant) || product.variants[0];
		const rows = [];
		if (product.variants.length > 1) rows.push({ label: 'Cor', value: variant.name });
		rows.push({ label: 'Tamanho', value: sel.size });
		return { groups: [{ heading: null, rows }] };
	}

	if (product.kind === 'sizedProduct') {
		return { groups: [{ heading: null, rows: [{ label: 'Tamanho', value: sel.size }] }] };
	}

	if (product.kind === 'doubleHoodie') {
		return {
			groups: [
				{ heading: 'Moletom Verde', rows: [{ label: 'Tamanho', value: sel.verde }] },
				{ heading: 'Moletom Off-white', rows: [{ label: 'Tamanho', value: sel.bege }] },
			],
		};
	}

	if (product.kind === 'configuredBundle') {
		const variant = product.variants?.find(v => v.code === sel.variant);
		const rows = [
			{ label: 'Moletom', value: `${variant?.name || sel.variant} / ${sel.size}` },
		];
		if (product.hasBackpack && sel.backpack) {
			const model = product.models?.find(m => m.code === sel.backpack);
			rows.push({ label: 'Mochila', value: model?.name || sel.backpack });
		}
		return { groups: [{ heading: null, rows }] };
	}

	// quantity puro (caneca, mochila, cachecol): nada a detalhar.
	return { groups: [] };
}
