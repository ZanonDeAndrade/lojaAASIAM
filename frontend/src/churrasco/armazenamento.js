/**
 * O que fica guardado no navegador entre o formulário e a confirmação do Pix.
 *
 * Só o necessário para retomar o pagamento depois de um F5: o código da
 * inscrição, o token de consulta e quando foi criado. Nome, telefone, e-mail e
 * curso não são gravados — eles já estão na planilha, e o backend devolve o que
 * a tela precisa mostrar. O código Pix também não: ele é buscado de novo.
 */

const CHAVE = 'aasiam-churrasco-pedido';

/** Passado isso, o registro é lixo de uma tentativa antiga. */
const VALIDADE_MS = 24 * 60 * 60 * 1000;

/** localStorage pode estar bloqueado (aba anônima, cookies desativados). */
export function lerPedido() {
	try {
		const bruto = localStorage.getItem(CHAVE);
		if (!bruto) return null;

		const dados = JSON.parse(bruto);
		if (!dados?.orderId || !dados?.token) return null;

		if (dados.criadoEm && Date.now() - dados.criadoEm > VALIDADE_MS) {
			esquecerPedido();
			return null;
		}
		return { orderId: String(dados.orderId), token: String(dados.token) };
	} catch {
		return null;
	}
}

export function guardarPedido(orderId, token) {
	try {
		localStorage.setItem(CHAVE, JSON.stringify({ orderId, token, criadoEm: Date.now() }));
	} catch {
		/* sem persistência: o fluxo continua nesta aba */
	}
}

export function esquecerPedido() {
	try {
		localStorage.removeItem(CHAVE);
	} catch {
		/* idem */
	}
}
