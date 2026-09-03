/**
 * Repasse da taxa de pagamento ao cliente — LOJA (e-commerce).
 *
 * O preço cadastrado no produto é o que a Atlética quer RECEBER, líquido dos
 * custos do Mercado Pago. Quando o cliente paga com cartão, o valor cobrado
 * sobe o suficiente para que, depois da taxa, sobre o preço de tabela:
 *
 *     valorCobrado = valorLíquido / (1 - taxa)          (gross-up)
 *
 * Somar `líquido + líquido*taxa` estaria errado: a taxa do Mercado Pago incide
 * sobre o valor final cobrado, não sobre o líquido.
 *
 * Este arquivo é a ÚNICA fonte de verdade da tabela de taxas. Nada de taxa vive
 * no frontend: a página pede uma simulação a `/api/loja/checkout/quote` e só
 * mostra os números que este módulo devolveu.
 *
 * Dinheiro é sempre centavo inteiro. A única divisão é a do gross-up, feita com
 * inteiros e arredondamento meio-para-cima explícito (nunca `Number.toFixed`,
 * nunca ponto flutuante em decisão financeira).
 *
 * O churrasco NÃO usa este arquivo: lá o Pix é cobrado pelo valor de face.
 */

/* ─── Tabela de taxas ─────────────────────────────────────────────────────
   Taxa TOTAL efetiva por número de parcelas, em pontos-base (1% = 100 bps),
   como inteiros — sem decimal solto na configuração.

   Os valores abaixo vêm do Simulador de Taxas da conta (Checkout, cartão de
   crédito, recebimento na hora, parcelado vendedor), conferidos de forma que
   o gross-up meio-para-cima reproduz exatamente o "cliente paga" de cada
   print para um líquido de R$ 100,00:

     1x → 4,98%  → R$ 105,24
     3x → 9,60%  → R$ 110,62
     4x → 11,67% → R$ 113,21
     5x → 13,64% → R$ 115,79
     6x → 14,94% → R$ 117,56

   2x ficou de fora: o print não terminou de carregar e a taxa não foi
   confirmada nesta conta. Enquanto `LOJA_FEE_CARD_2X_BPS` não for definida,
   2x simplesmente não é oferecido no checkout — nada é inventado. */
const TAXA_CARTAO_PADRAO_BPS = Object.freeze({
  1: 498,
  3: 960,
  4: 1167,
  5: 1364,
  6: 1494,
});

/** Pix da loja: taxa própria da conta. Sem valor confirmado, assume 0 (a
 *  Atlética absorve) — nunca a taxa do cartão. Defina `LOJA_FEE_PIX_BPS`. */
const TAXA_PIX_PADRAO_BPS = 0;

const PARCELAS_MAXIMAS_PADRAO = 6;

export const METODO_CARTAO = "credit_card";
export const METODO_PIX = "pix";
export const METODOS_SUPORTADOS = Object.freeze([METODO_CARTAO, METODO_PIX]);

/* ─── Erros ──────────────────────────────────────────────────────────────── */

export class FeeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FeeError";
    this.code = code;
  }
}

/* ─── Leitura da configuração ────────────────────────────────────────────── */

function inteiroNaoNegativo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Lê `LOJA_FEE_CARD_1X_BPS`, `LOJA_FEE_CARD_2X_BPS`, ... por cima da tabela
 * padrão. Uma variável ausente mantém o padrão; uma variável presente com
 * lixo é ignorada com aviso — a configuração nunca "quase funciona".
 */
function tabelaCartaoBps() {
  const tabela = { ...TAXA_CARTAO_PADRAO_BPS };
  for (let parcelas = 1; parcelas <= 24; parcelas += 1) {
    const bruto = process.env[`LOJA_FEE_CARD_${parcelas}X_BPS`];
    if (bruto === undefined || bruto === "") continue;
    const bps = inteiroNaoNegativo(bruto.trim());
    if (bps === null) {
      console.warn(`[Loja/Taxas] LOJA_FEE_CARD_${parcelas}X_BPS inválida ("${bruto}") — ignorada.`);
      continue;
    }
    tabela[parcelas] = bps;
  }
  return Object.freeze(tabela);
}

function pixBps() {
  const bruto = process.env.LOJA_FEE_PIX_BPS;
  if (bruto === undefined || bruto === "") return TAXA_PIX_PADRAO_BPS;
  const bps = inteiroNaoNegativo(String(bruto).trim());
  if (bps === null) {
    console.warn(`[Loja/Taxas] LOJA_FEE_PIX_BPS inválida ("${bruto}") — assumindo 0.`);
    return 0;
  }
  return bps;
}

function parcelasMaximas() {
  const bps = inteiroNaoNegativo(String(process.env.LOJA_MAX_INSTALLMENTS || "").trim());
  return bps && bps >= 1 ? bps : PARCELAS_MAXIMAS_PADRAO;
}

/**
 * Snapshot imutável da configuração de taxas vigente. Lido uma vez por
 * requisição — barato e mantém o teste livre para mexer no `process.env`.
 */
export function tabelaDeTaxas() {
  const cartao = tabelaCartaoBps();
  const maximo = parcelasMaximas();

  const parcelasCartao = Object.keys(cartao)
    .map(Number)
    .filter((n) => n >= 1 && n <= maximo && Number.isInteger(cartao[n]))
    .sort((a, b) => a - b);

  return Object.freeze({
    cartaoBps: cartao,
    pixBps: pixBps(),
    parcelasCartao: Object.freeze(parcelasCartao),
  });
}

/* ─── Gross-up ───────────────────────────────────────────────────────────── */

/**
 * `liquidoCents / (1 - bps/10000)` em centavos inteiros, arredondado
 * meio-para-cima. Sem ponto flutuante: `(a*2 + d) div (d*2)` é o
 * arredondamento exato de `a/d` para o inteiro mais próximo, resolvendo o
 * empate para cima.
 */
export function grossUpCents(liquidoCents, bps) {
  const liquido = Math.trunc(Number(liquidoCents) || 0);
  if (liquido <= 0) return 0;
  const denominador = 10000 - Number(bps);
  if (!Number.isInteger(denominador) || denominador <= 0) {
    throw new FeeError("taxa_invalida", "Taxa de pagamento fora do intervalo aceito.");
  }
  const numerador = liquido * 10000;
  return Math.floor((numerador * 2 + denominador) / (denominador * 2));
}

/* ─── Simulação ──────────────────────────────────────────────────────────── */

/**
 * Divide o total em parcelas só para exibição ("3x de R$ 36,87"). A cobrança
 * real é sempre o total inteiro; quem parcela de fato é o Mercado Pago.
 */
function parcelaAproximadaCents(totalCents, parcelas) {
  if (parcelas <= 1) return totalCents;
  return Math.floor((totalCents * 2 + parcelas) / (parcelas * 2));
}

/**
 * @param {object} params
 * @param {number} params.subtotalCents  - líquido desejado, inteiro > 0
 * @param {string} params.paymentMethod  - "credit_card" | "pix"
 * @param {number} [params.installments] - 1..N (só cartão; Pix é sempre 1)
 * @returns {{
 *   subtotalCents:number, paymentMethod:string, installments:number,
 *   feeBps:number, feeRate:number, paymentFeeCents:number,
 *   totalCents:number, installmentCents:number
 * }}
 */
export function simularCobranca({ subtotalCents, paymentMethod, installments = 1 }) {
  const subtotal = Math.trunc(Number(subtotalCents) || 0);
  if (subtotal <= 0) {
    throw new FeeError("subtotal_invalido", "O subtotal precisa ser maior que zero.");
  }

  const metodo = String(paymentMethod || "").trim();
  if (!METODOS_SUPORTADOS.includes(metodo)) {
    throw new FeeError("metodo_invalido", "Forma de pagamento não suportada.");
  }

  const tabela = tabelaDeTaxas();

  if (metodo === METODO_PIX) {
    const bps = tabela.pixBps;
    const totalCents = grossUpCents(subtotal, bps);
    return {
      subtotalCents: subtotal,
      paymentMethod: METODO_PIX,
      installments: 1,
      feeBps: bps,
      feeRate: bps / 10000,
      paymentFeeCents: totalCents - subtotal,
      totalCents,
      installmentCents: totalCents,
    };
  }

  const parcelas = Math.trunc(Number(installments) || 1);
  const bps = tabela.cartaoBps[parcelas];
  if (!Number.isInteger(bps) || !tabela.parcelasCartao.includes(parcelas)) {
    throw new FeeError(
      "parcelas_invalidas",
      `Parcelamento em ${parcelas}x não está disponível.`
    );
  }

  const totalCents = grossUpCents(subtotal, bps);
  return {
    subtotalCents: subtotal,
    paymentMethod: METODO_CARTAO,
    installments: parcelas,
    feeBps: bps,
    feeRate: bps / 10000,
    paymentFeeCents: totalCents - subtotal,
    totalCents,
    installmentCents: parcelaAproximadaCents(totalCents, parcelas),
  };
}

/**
 * Opções de parcela para o checkout montar o seletor — cada uma já com o
 * total e a parcela aproximada. É o backend dizendo ao front o que oferecer.
 */
export function opcoesDeParcelamento(subtotalCents) {
  const tabela = tabelaDeTaxas();
  return tabela.parcelasCartao.map((parcelas) =>
    simularCobranca({ subtotalCents, paymentMethod: METODO_CARTAO, installments: parcelas })
  );
}
