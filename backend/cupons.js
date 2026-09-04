/**
 * Cupons de desconto da loja.
 *
 * Map em memória — a lista nunca é exposta nas respostas da API. Extraído de
 * `index.js` para ser compartilhado entre o checkout antigo (InfinitePay) e o
 * checkout do Mercado Pago, sem duplicar a regra nem a lista de nomes.
 *
 * Dois tipos:
 *  - "custo"  → aplica o preço de custo (`costCents`) de cada produto;
 *  - "teste"  → zera tudo para R$ 1,00/unidade, para os testes de pagamento.
 *
 * O estado ("já usado") vive só em memória: reinício do Render zera os usos
 * únicos. Limitação conhecida e aceita — a lista é pequena e curada.
 */
import { getProduct, centsToAmount } from "./shared/order.js";

/** Preço unitário aplicado pelo cupom de teste. */
export const PRECO_TESTE_CENTS = 100;

export function normalizeCoupon(codigo) {
  return String(codigo || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const COUPONS = new Map();

/** Cupons de associado, uso único, preço de custo. */
for (const nome of [
  "Milton Roberto",
  "Marcelo Telles",
  "Samuel Watthier",
  "Guilherme William",
  "Jessika Rodrigues",
  "Vinicius Schmidt",
  "Gabriel Telles",
  "Amanda Roos",
  "Vinícios Dotto",
]) {
  COUPONS.set(normalizeCoupon(nome), { unlimited: false, used: false, tipo: "custo" });
}
/** Cupom de associado ilimitado, preço de custo. */
COUPONS.set(normalizeCoupon("Gabriela Minuzzi"), { unlimited: true, used: false, tipo: "custo" });

/** Cupom de TESTE: R$ 1,00 em qualquer produto. Ilimitado — repita à vontade. */
COUPONS.set(normalizeCoupon("GabiMinuzzi100"), { unlimited: true, used: false, tipo: "teste" });

/** Verifica disponibilidade (case-insensitive, ignora espaços extras). */
export function checkCoupon(codigo) {
  const key = normalizeCoupon(codigo);
  if (!key || !COUPONS.has(key)) return { valido: false, motivo: "invalido" };
  const c = COUPONS.get(key);
  if (!c.unlimited && c.used) return { valido: false, motivo: "ja_utilizado" };
  return { valido: true, tipo: c.tipo };
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
 * Aplica o preço de custo (`costCents`) a todas as linhas do pedido.
 * Exportada porque o checkout legado da InfinitePay ainda a chama direto.
 */
export function aplicarPrecoCusto(order) {
  reprecificar(order, (line) => {
    const product = getProduct(line.productId);
    return product && Number.isFinite(product.costCents) ? product.costCents : line.unitPriceCents;
  });
}

/** Aplica o desconto de um cupom já validado, conforme o `tipo`. */
export function aplicarCupom(order, tipo) {
  if (tipo === "teste") {
    reprecificar(order, () => PRECO_TESTE_CENTS);
    return;
  }
  aplicarPrecoCusto(order);
}
