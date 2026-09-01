import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Consulta o status da inscrição no backend — que é quem fala com o Mercado
 * Pago. O navegador nunca fala com o Mercado Pago direto e nunca decide se
 * alguém pagou: ele só pergunta e mostra a resposta.
 *
 * A consulta para sozinha quando o pagamento chega a um estado final e pausa
 * quando a aba sai da frente.
 */

const INTERVALO_MS = 7000;

const ERRO_CONEXAO =
	'Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.';

export default function useStatusInscricao({ apiBase, pedido }) {
	const [inscricao, setInscricao] = useState(null);
	const [carregando, setCarregando] = useState(false);
	const [verificando, setVerificando] = useState(false);
	const [erro, setErro] = useState(null);
	// 404: a inscrição não existe ou o token não confere.
	const [naoEncontrada, setNaoEncontrada] = useState(false);

	// Quem já tem os dados em mãos (a resposta do checkout) não espera consulta.
	const temDados = useRef(false);

	const consultar = useCallback(async () => {
		if (!pedido) return null;

		const resposta = await fetch(
			`${apiBase}/api/churrasco/pagamentos/${encodeURIComponent(pedido.orderId)}/status`,
			{ headers: { 'X-Inscricao-Token': pedido.token } },
		);

		if (resposta.status === 404) {
			setNaoEncontrada(true);
			return null;
		}

		const dados = await resposta.json().catch(() => null);
		if (!resposta.ok || !dados?.ok) throw new Error(dados?.error || 'falha ao consultar');

		temDados.current = true;
		setInscricao(dados);
		setErro(null);
		return dados;
	}, [apiBase, pedido]);

	/**
	 * Adota o resultado do checkout sem uma ida ao servidor. É o que faz o QR
	 * aparecer no mesmo instante em que a cobrança é criada.
	 */
	const adotar = useCallback((dados) => {
		temDados.current = Boolean(dados);
		setNaoEncontrada(false);
		setErro(null);
		setInscricao(dados);
	}, []);

	/* Primeira consulta — só quando a página abre sem dados em mãos: um F5
	   durante um Pix pendente, ou o link de retorno antigo. */
	useEffect(() => {
		if (!pedido || temDados.current) return undefined;

		let ativo = true;
		setCarregando(true);
		(async () => {
			try {
				await consultar();
			} catch {
				if (ativo) setErro(ERRO_CONEXAO);
			} finally {
				if (ativo) setCarregando(false);
			}
		})();

		return () => {
			ativo = false;
		};
	}, [consultar, pedido]);

	/* Enquanto o Pix não fecha, a tela se atualiza sozinha. */
	const emAberto = Boolean(inscricao) && !inscricao.final;

	useEffect(() => {
		if (!emAberto) return undefined;

		let timer = null;

		function agendar() {
			clearInterval(timer);
			// Aba em segundo plano não consulta nada — economiza bateria e API.
			if (document.hidden) return;
			timer = setInterval(() => {
				consultar().catch(() => {
					/* falha isolada: a próxima tentativa vem no próximo ciclo */
				});
			}, INTERVALO_MS);
		}

		function aoTrocarVisibilidade() {
			if (!document.hidden) consultar().catch(() => {});
			agendar();
		}

		agendar();
		document.addEventListener('visibilitychange', aoTrocarVisibilidade);

		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', aoTrocarVisibilidade);
		};
	}, [emAberto, consultar]);

	/** "Verificar pagamento" — consulta imediata, sob demanda. */
	const verificarAgora = useCallback(async () => {
		setVerificando(true);
		setErro(null);
		try {
			await consultar();
		} catch {
			setErro(ERRO_CONEXAO);
		} finally {
			setVerificando(false);
		}
	}, [consultar]);

	/** Volta ao ponto de partida — usado ao inscrever outra pessoa. */
	const esquecer = useCallback(() => {
		temDados.current = false;
		setInscricao(null);
		setNaoEncontrada(false);
		setErro(null);
	}, []);

	return {
		inscricao,
		carregando,
		verificando,
		erro,
		naoEncontrada,
		verificarAgora,
		adotar,
		esquecer,
	};
}
