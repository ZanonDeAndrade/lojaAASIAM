/**
 * Cupons de desconto da loja — REGRA DE PREÇO.
 *
 * Quatro tipos:
 *  - "custo"      → cada produto do carrinho passa a ser vendido pelo seu
 *                   `costCents` (preço de custo real cadastrado). O cadastro e
 *                   o limite de 2 utilizações vivem em `cupons-store.js` (aba
 *                   "Cupons" do Google Sheets) — nada em memória.
 *  - "teste"      → zera tudo para R$ 1,00/unidade, para os testes de
 *                   pagamento. Ilimitados, sem persistência. Apagar quando os
 *                   testes acabarem.
 *  - "percentual" → desconto de N% sobre o SUBTOTAL dos produtos (nunca sobre
 *                   o acréscimo do pagamento). Cadastro fixo em
 *                   `PERCENT_COUPONS`: sem expiração, sem limite de uso,
 *                   válido para qualquer cliente. O desconto nunca reprecifica
 *                   as linhas — só abate `order.totalCents` — então o "Itens"
 *                   do pedido continua mostrando o preço de venda normal.
 *  - "valorFixo"  → cupom Diretoria: colapsa o TOTAL FINAL do pedido
 *                   (produtos + acréscimo do pagamento) para exatamente
 *                   `CUPOM_DIRETORIA_CENTS`, não importa o carrinho. Cobrança
 *                   REAL — não é simulação. Só existe com
 *                   `ENABLE_TEST_COUPON=true` no ambiente (nome da variável
 *                   mantido — é o que já está configurado em produção);
 *                   ausente, vazia ou diferente de "true" desativa por
 *                   completo. Não é anunciado em nenhuma vitrine, banner ou
 *                   sugestão do site — só funciona pra quem já sabe o código.
 *
 * A normalização (trim + minúsculas + espaços) identifica o mesmo cupom em
 * "zanon", "Zanon", " ZANON ". O nome canônico volta na resposta para exibição
 * — inclusive o "valorFixo": o código de ativação e o que aparece pro cliente
 * são o mesmo (só o RÓTULO na tela é outro — "Cupom Diretoria" — decidido no
 * frontend a partir do `tipo`, nunca do texto do código).
 */
import { centsToAmount, getProduct } from "./shared/order.js";
import {
  checkCupomCusto,
  contabilizarUsoCupom,
  normalizarCodigo,
} from "./cupons-store.js";

/** Preço unitário aplicado pelo cupom de teste. */
export const PRECO_TESTE_CENTS = 100;

export function normalizeCoupon(codigo) {
  return normalizarCodigo(codigo);
}

/** Cupons de TESTE: R$ 1,00 em qualquer produto. Ilimitados — repita à vontade.
 *  São temporários: apagar quando os testes de pagamento terminarem. */
const TEST_COUPONS = new Map([
  ["gabiminuzzi100", "GabiMinuzzi100"],
  ["gabrielaminuzzi100", "GabrielaMinuzzi100"],
]);

/**
 * Cupons de PORCENTAGEM sobre o subtotal dos produtos. Sem data de expiração,
 * sem limite de usos, qualquer cliente pode usar — por isso não passam pela
 * planilha (`cupons-store.js`), igual aos cupons de teste.
 */
const PERCENT_COUPONS = new Map([["programador5", { codigo: "programador5", percentual: 5 }]]);

/**
 * Cupom Diretoria — pedido REAL, cobrado por exatamente R$ 1,00. Chave
 * reservada: nunca cadastre um cupom pessoal com este nome.
 *
 *  - `CUPOM_DIRETORIA_CODE`    chave normalizada usada para RECONHECER o
 *                              código digitado pelo cliente.
 *  - `CUPOM_DIRETORIA_CODIGO`  nome canônico — o mesmo valor volta em toda
 *                              resposta ao cliente e é o que fica gravado na
 *                              planilha do pedido (coluna Cupom), igual a
 *                              qualquer outro cupom do sistema.
 *
 * Só funciona com `ENABLE_TEST_COUPON=true` no ambiente (nome histórico da
 * variável — é o que já está configurado em produção). Ausente, vazia ou
 * qualquer valor diferente da string exata "true" desativa o cupom por
 * completo — ele passa a não existir, como se o código nunca tivesse sido
 * cadastrado (mesma resposta genérica "invalido" de um código qualquer).
 */
const CUPOM_DIRETORIA_CODE = "1real";
const CUPOM_DIRETORIA_CODIGO = "1REAL";
export const CUPOM_DIRETORIA_CENTS = 100;

function cupomDiretoriaHabilitado() {
  return process.env.ENABLE_TEST_COUPON === "true";
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
 *  { valido: true, tipo: "custo" | "teste", codigo }
 *  { valido: false, motivo: "invalido" | "inativo" | "esgotado" }
 */
export async function checkCoupon(codigo) {
  const key = normalizeCoupon(codigo);
  if (!key) return { valido: false, motivo: "invalido" };
  if (key === CUPOM_DIRETORIA_CODE) {
    // Variável ausente/vazia/diferente de "true": o cupom nem existe.
    if (!cupomDiretoriaHabilitado()) return { valido: false, motivo: "invalido" };
    return { valido: true, tipo: "valorFixo", codigo: CUPOM_DIRETORIA_CODIGO };
  }
  if (TEST_COUPONS.has(key)) {
    return { valido: true, tipo: "teste", codigo: TEST_COUPONS.get(key) };
  }
  if (PERCENT_COUPONS.has(key)) {
    const { codigo: canonico, percentual } = PERCENT_COUPONS.get(key);
    return { valido: true, tipo: "percentual", codigo: canonico, percentual };
  }
  return checkCupomCusto(codigo);
}

/**
 * Contabiliza a utilização de um cupom APÓS o pagamento aprovado. Idempotente
 * por pedido (webhook reenviado não conta duas vezes). Cupom de teste é no-op.
 */
export async function marcarCupomUsado(codigo, orderId) {
  const key = normalizeCoupon(codigo);
  if (!key) return { ok: false, motivo: "parametros" };
  if (key === CUPOM_DIRETORIA_CODE) return { ok: true, tipo: "valorFixo" };
  if (TEST_COUPONS.has(key)) return { ok: true, tipo: "teste" };
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
 * Colapsa o total dos PRODUTOS para `CUPOM_DIRETORIA_CENTS` — não é uma
 * porcentagem nem depende de quantidade, produto ou subtotal: é uma
 * substituição direta, sempre R$ 1,00. A rota de checkout ainda zera o
 * acréscimo do pagamento por cima (`loja-pagamento.js`), porque o gross-up de
 * R$ 1,00 empurraria o total cobrado pra além de R$ 1,00.
 */
export function aplicarValorFixo(order) {
  order.totalCents = CUPOM_DIRETORIA_CENTS;
  order.totalAmount = centsToAmount(order.totalCents);
}

/**
 * Aplica o desconto de um cupom já validado, conforme o `tipo`. `codigo` só é
 * necessário para o tipo "percentual" (identifica qual % usar).
 */
export function aplicarCupom(order, tipo, codigo) {
  if (tipo === "valorFixo") {
    aplicarValorFixo(order);
    return;
  }
  if (tipo === "teste") {
    reprecificar(order, () => PRECO_TESTE_CENTS);
    return;
  }
  if (tipo === "percentual") {
    const entrada = PERCENT_COUPONS.get(normalizeCoupon(codigo));
    aplicarDescontoPercentual(order, entrada?.percentual ?? 0);
    return;
  }
  aplicarPrecoCusto(order);
}
