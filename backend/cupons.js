/**
 * Cupons de desconto da loja — REGRA DE PREÇO.
 *
 * Três tipos:
 *  - "custo"      → cada produto do carrinho passa a ser vendido pelo seu
 *                   `costCents` (preço de custo real cadastrado). O cadastro e
 *                   o limite de 2 utilizações vivem em `cupons-store.js` (aba
 *                   "Cupons" do Google Sheets) — nada em memória.
 *  - "custoDireto" → cupom de professor: mesmo preço de custo (`costCents`) de
 *                   todos os produtos, mas o valor cobrado no Mercado Pago é
 *                   EXATAMENTE esse subtotal — sem gross-up de taxa, sempre em
 *                   1x (Pix e cartão). Cadastro fixo em `CUSTO_DIRETO_COUPONS`:
 *                   sem expiração, sem limite de uso, sem planilha.
 *  - "percentual" → desconto de N% sobre o SUBTOTAL dos produtos (nunca sobre
 *                   o acréscimo do pagamento). Cadastro fixo em
 *                   `PERCENT_COUPONS`: sem expiração, sem limite de uso,
 *                   válido para qualquer cliente. O desconto nunca reprecifica
 *                   as linhas — só abate `order.totalCents` — então o "Itens"
 *                   do pedido continua mostrando o preço de venda normal.
 *
 * A normalização (trim + minúsculas + espaços) identifica o mesmo cupom em
 * "abc", "Abc", " ABC ". O nome canônico volta na resposta para exibição.
 */
import { centsToAmount, getProduct } from "./shared/order.js";
import {
  checkCupomCusto,
  contabilizarUsoCupom,
  normalizarCodigo,
} from "./cupons-store.js";

export function normalizeCoupon(codigo) {
  return normalizarCodigo(codigo);
}

/**
 * Cupons de PORCENTAGEM sobre o subtotal dos produtos. Sem data de expiração,
 * sem limite de usos, qualquer cliente pode usar — por isso não passam pela
 * planilha (`cupons-store.js`), igual aos cupons de teste.
 */
export const PERCENT_COUPONS = new Map([["jhpr3dkrr5", { codigo: "JHPR3DKRR5", percentual: 5 }]]);

/**
 * Cupons de CUSTO DIRETO: preço de custo em todos os produtos e o total do
 * checkout do Mercado Pago é o próprio subtotal a custo (`loja-pagamento.js`
 * zera o acréscimo de taxa e força 1x quando o tipo é "custoDireto").
 */
export const CUSTO_DIRETO_COUPONS = new Map([["uze3un2wgg", "UZE3UN2WGG"]]);

/** Tipo cujo total cobrado é o subtotal do pedido, sem repasse de taxa. */
export function cupomSemTaxa(tipo) {
  return tipo === "custoDireto";
}

/**
 * Um produto do carrinho não tem `costCents` cadastrado. O checkout com cupom
 * de custo é BLOQUEADO — nunca cai para 0, `null` ou o preço de venda.
 */
export class CupomPrecoError extends Error {
  constructor(productId, productName) {
    super(`Produto sem preço de custo configurado: ${productName || productId}`);
    this.name = "CupomPrecoError";
    this.code = "produto_sem_custo";
    this.productId = productId;
    this.productName = productName || productId;
  }
}

/**
 * Verifica um cupom sem marcar nada como usado (case-insensitive, ignora
 * espaços). Assíncrona: o cupom de custo é lido da planilha.
 *
 *  { valido: true, tipo: "custo" | "custoDireto" | "percentual", codigo }
 *  { valido: false, motivo: "invalido" | "inativo" | "esgotado" }
 */
export async function checkCoupon(codigo) {
  const key = normalizeCoupon(codigo);
  if (!key) return { valido: false, motivo: "invalido" };
  if (CUSTO_DIRETO_COUPONS.has(key)) {
    return { valido: true, tipo: "custoDireto", codigo: CUSTO_DIRETO_COUPONS.get(key) };
  }
  if (PERCENT_COUPONS.has(key)) {
    const { codigo: canonico, percentual } = PERCENT_COUPONS.get(key);
    return { valido: true, tipo: "percentual", codigo: canonico, percentual };
  }
  return checkCupomCusto(codigo);
}

/**
 * Contabiliza a utilização de um cupom APÓS o pagamento aprovado. Idempotente
 * por pedido (webhook reenviado não conta duas vezes). Cupons sem planilha são no-op.
 */
export async function marcarCupomUsado(codigo, orderId) {
  const key = normalizeCoupon(codigo);
  if (!key) return { ok: false, motivo: "parametros" };
  if (CUSTO_DIRETO_COUPONS.has(key)) return { ok: true, tipo: "custoDireto" };
  if (PERCENT_COUPONS.has(key)) return { ok: true, tipo: "percentual" };
  return contabilizarUsoCupom(codigo, orderId);
}

/** Reprecifica todas as linhas do pedido, no lugar, e recalcula o total. */
function reprecificar(order, unitCentsFor) {
  for (const line of order.lines) {
    const unit = unitCentsFor(line);
    line.unitPriceCents = unit;
    line.totalCents = unit * line.quantity;
  }
  order.totalCents = order.lines.reduce((sum, line) => sum + line.totalCents, 0);
  order.totalAmount = centsToAmount(order.totalCents);
}

/**
 * Aplica o preço de custo (`costCents`) a todas as linhas do pedido. Lança
 * `CupomPrecoError` se qualquer produto do carrinho não tiver custo válido.
 */
export function aplicarPrecoCusto(order) {
  for (const line of order.lines) {
    const product = getProduct(line.productId);
    const custo = product?.costCents;
    if (!Number.isFinite(custo) || custo <= 0) {
      throw new CupomPrecoError(line.productId, line.productName);
    }
  }
  reprecificar(order, (line) => getProduct(line.productId).costCents);
}

/**
 * Abate N% do subtotal do pedido — nunca do acréscimo do pagamento, que é
 * calculado depois, sobre `order.totalCents` já com o desconto aplicado. O
 * arredondamento é para o centavo mais próximo (duas casas decimais), a
 * partir do subtotal em centavos — nunca por linha, para não haver deriva de
 * arredondamento entre os itens.
 */
export function aplicarDescontoPercentual(order, percentual) {
  const descontoCents = Math.round(order.totalCents * (Number(percentual) || 0) / 100);
  order.totalCents = Math.max(0, order.totalCents - descontoCents);
  order.totalAmount = centsToAmount(order.totalCents);
}

/**
 * Aplica o desconto de um cupom já validado, conforme o `tipo`. `codigo` só é
 * necessário para o tipo "percentual" (identifica qual % usar).
 */
export function aplicarCupom(order, tipo, codigo) {
  if (tipo === "percentual") {
    const entrada = PERCENT_COUPONS.get(normalizeCoupon(codigo));
    aplicarDescontoPercentual(order, entrada?.percentual ?? 0);
    return;
  }
  // "custo" e "custoDireto": preço de custo em todas as linhas.
  aplicarPrecoCusto(order);
}
