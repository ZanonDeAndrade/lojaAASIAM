/**
 * O que fica guardado no navegador entre o formulário e a confirmação do Pix.
 *
 * Só o necessário para retomar o pagamento depois de um F5: o código da
 * inscrição, o token de consulta e quando foi criado. Nome, telefone, e-mail e
 * curso não são gravados — eles já estão na planilha, e o backend devolve o que
 * a tela precisa mostrar. O código Pix também não: ele é buscado de novo.
 *
 * Cada evento guarda na própria chave. Uma inscrição paga não vence: é o que
 * deixa a pessoa voltar dias depois e baixar o comprovante de novo.
 */

/** A chave do Churrasco da Alcateia (AMF Games), a de sempre. */
export const CHAVE_PADRAO = 'aasiam-churrasco-pedido';

/** Passado isso, um registro NÃO pago é lixo de uma tentativa antiga. */
const VALIDADE_MS = 24 * 60 * 60 * 1000;

/** localStorage pode estar bloqueado (aba anônima, cookies desativados). */
export function lerPedido(chave = CHAVE_PADRAO) {
	try {
		const bruto = localStorage.getItem(chave);
		if (!bruto) return null;

		const dados = JSON.parse(bruto);
		if (!dados?.orderId || !dados?.token) return null;

		if (!dados.pago && dados.criadoEm && Date.now() - dados.criadoEm > VALIDADE_MS) {
			esquecerPedido(chave);
			return null;
		}
		return { orderId: String(dados.orderId), token: String(dados.token) };
	} catch {
		return null;
	}
}

export function guardarPedido(orderId, token, chave = CHAVE_PADRAO) {
	try {
		localStorage.setItem(chave, JSON.stringify({ orderId, token, criadoEm: Date.now() }));
	} catch {
		/* sem persistência: o fluxo continua nesta aba */
	}
}

/** Marca o pedido guardado como pago — daí em diante ele não vence mais. */
export function marcarPedidoPago(orderId, chave = CHAVE_PADRAO) {
	try {
		const dados = JSON.parse(localStorage.getItem(chave) || 'null');
		if (!dados || dados.orderId !== orderId || dados.pago) return;
		localStorage.setItem(chave, JSON.stringify({ ...dados, pago: true }));
	} catch {
		/* idem */
	}
}

export function esquecerPedido(chave = CHAVE_PADRAO) {
	try {
		localStorage.removeItem(chave);
	} catch {
		/* idem */
	}
}
