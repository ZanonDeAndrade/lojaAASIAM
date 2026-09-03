/**
 * Cupons de desconto de associado (preço de custo).
 *
 * Map em memória com controle de uso — a lista nunca é exposta nas respostas
 * da API. Extraído de `index.js` para ser compartilhado entre o checkout
 * antigo (InfinitePay) e o checkout do Mercado Pago da loja, sem duplicar a
 * regra nem a lista de nomes.
 *
 * O estado ("já usado") vive só em memória: reinício do Render zera os usos
 * únicos. É uma limitação conhecida e aceita — a lista é pequena e curada.
 */
import { getProduct, centsToAmount } from "./shared/order.js";

export function normalizeCoupon(codigo) {
  return String(codigo || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Cupons de uso único. */
const COUPONS = new Map(
  [
    "Milton Roberto",
    "Marcelo Telles",
    "Samuel Watthier",
    "Guilherme William",
    "Jessika Rodrigues",
    "Vinicius Schmidt",
    "Gabriel Telles",
    "Amanda Roos",
    "Vinícios Dotto",
  ].map((nome) => [normalizeCoupon(nome), { unlimited: false, used: false }])
);
/** Cupom ilimitado. */
COUPONS.set(normalizeCoupon("Gabriela Minuzzi"), { unlimited: true, used: false });

/** Verifica disponibilidade (case-insensitive, ignora espaços extras). */
export function checkCoupon(codigo) {
  const key = normalizeCoupon(codigo);
  if (!key || !COUPONS.has(key)) return { valido: false, motivo: "invalido" };
  const c = COUPONS.get(key);
  if (!c.unlimited && c.used) return { valido: false, motivo: "ja_utilizado" };
  return { valido: true, tipo: "custo" };
}

/** Marca um cupom de uso único como usado (idempotente; ilimitado nunca trava). */
export function marcarCupomUsado(codigo, orderId) {
  const key = normalizeCoupon(codigo);
  const c = COUPONS.get(key);
  if (!c) return false;
  if (!c.unlimited) c.used = true;
  console.log(`[Cupom] "${key}" marcado como usado (pedido ${orderId || "?"}).`);
  return true;
}

/**
 * Aplica o preço de custo (`costCents`) a todas as linhas do pedido, no lugar.
 * O pedido passa a valer o total de custo.
 */
export function aplicarPrecoCusto(order) {
  for (const line of order.lines) {
    const product = getProduct(line.productId);
    const custo =
      product && Number.isFinite(product.costCents) ? product.costCents : line.unitPriceCents;
    line.unitPriceCents = custo;
    line.totalCents = custo * line.quantity;
  }
  order.totalCents = order.lines.reduce((sum, line) => sum + line.totalCents, 0);
  order.totalAmount = centsToAmount(order.totalCents);
}
