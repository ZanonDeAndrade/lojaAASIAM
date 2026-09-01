import { useCallback, useEffect, useRef, useState } from 'react';

import { CHURRASCO_EVENTO } from './config.js';
import EventoApresentacao from './components/EventoApresentacao.jsx';
import InscricaoForm from './components/InscricaoForm.jsx';
import PagamentoPix from './components/PagamentoPix.jsx';
import useStatusInscricao from './useStatusInscricao.js';
import { esquecerPedido, guardarPedido, lerPedido } from './armazenamento.js';
import './churrasco.css';

// Mesmo contrato da loja: em dev o proxy do Vite manda /api para o backend
// local; em produção VITE_API_URL aponta para o backend no Render.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/** Endereço da volta da InfinitePay. Mantido para não quebrar links antigos. */
export const ROTA_RETORNO = '/churrasco/pagamento-concluido';

const ERRO_CONEXAO =
	'Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.';

/**
 * Página /churrasco — inscrições do Churrasco da Alcateia.
 *
 * Vive fora do fluxo da loja de propósito: sem carrinho, sem tema claro e sem
 * o header do e-commerce. O pagamento é por Pix, criado no Checkout
 * Transparente do Mercado Pago e concluído aqui dentro — não há saída para
 * outro checkout em momento algum.
 *
 * Duas telas no mesmo endereço: o formulário e, depois dele, o Pix.
 */
export default function ChurrascoPage() {
	const [pedido, setPedido] = useState(() => lerPedido());
	const [enviando, setEnviando] = useState(false);
	const [gerandoNovo, setGerandoNovo] = useState(false);

	// Guardado para poder gerar um novo Pix sem pedir tudo de novo.
	const ultimoFormulario = useRef(null);

	const status = useStatusInscricao({ apiBase: API_BASE, pedido });
	const { adotar, esquecer } = status;

	useEffect(() => {
		const html = document.documentElement;
		const tituloAnterior = document.title;
		const fundoAnterior = html.style.background;

		document.title = `${CHURRASCO_EVENTO.titulo} | AASIAM`;
		// A página é sempre preta, independente do tema salvo na loja — isso
		// evita uma faixa clara no overscroll de quem usa o modo claro.
		html.style.background = '#050806';

		return () => {
			document.title = tituloAnterior;
			html.style.background = fundoAnterior;
		};
	}, []);

	/* O link de retorno antigo (/churrasco/pagamento-concluido) continua
	   abrindo a inscrição guardada, mas o endereço volta a ser /churrasco:
	   não existe mais "voltar de um checkout". */
	useEffect(() => {
		if (window.location.pathname.replace(/\/$/, '') === ROTA_RETORNO) {
			window.history.replaceState({}, '', '/churrasco');
		}
	}, []);

	/** Cria (ou renova) a cobrança Pix. Devolve `{ ok }` ou `{ ok, error }`. */
	const cobrar = useCallback(
		async (dados) => {
			try {
				const resposta = await fetch(`${API_BASE}/api/churrasco/checkout`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(dados),
				});

				const corpo = await resposta.json().catch(() => null);

				if (!resposta.ok || !corpo?.ok) {
					return {
						ok: false,
						field: resposta.status === 400 ? corpo?.field : undefined,
						error: corpo?.error || 'Não foi possível gerar o Pix. Tente novamente.',
					};
				}

				ultimoFormulario.current = dados;
				guardarPedido(corpo.orderId, corpo.token);
				setPedido({ orderId: corpo.orderId, token: corpo.token });
				adotar(corpo);

				return { ok: true };
			} catch {
				return { ok: false, error: ERRO_CONEXAO };
			}
		},
		[adotar],
	);

	async function enviarFormulario(dados) {
		setEnviando(true);
		try {
			return await cobrar(dados);
		} finally {
			setEnviando(false);
		}
	}

	/**
	 * "Gerar um novo Pix". O backend reaproveita a mesma linha da planilha e a
	 * mesma referência — só a cobrança é nova.
	 */
	async function gerarNovoPix() {
		if (!ultimoFormulario.current) {
			voltarAoFormulario();
			return;
		}
		setGerandoNovo(true);
		try {
			await cobrar(ultimoFormulario.current);
		} finally {
			setGerandoNovo(false);
		}
	}

	function voltarAoFormulario() {
		esquecerPedido();
		ultimoFormulario.current = null;
		setPedido(null);
		esquecer();
	}

	function painel() {
		if (pedido) {
			return (
				<PagamentoPix
					apiBase={API_BASE}
					token={pedido.token}
					inscricao={status.inscricao}
					carregando={status.carregando || enviando}
					verificando={status.verificando}
					gerandoNovo={gerandoNovo}
					erro={status.erro}
					naoEncontrada={status.naoEncontrada}
					onVerificarAgora={status.verificarAgora}
					onGerarNovoPix={gerarNovoPix}
					onVoltarAoFormulario={voltarAoFormulario}
				/>
			);
		}

		return (
			<>
				<div className="ch-panel-head">
					<h2 className="ch-panel-title">Inscrição</h2>
					<p className="ch-panel-hint">
						Quatro campos e pronto. O valor vem do seu curso e o pagamento é por Pix,
						aqui mesmo nesta página.
					</p>
				</div>
				<InscricaoForm onGerarPix={enviarFormulario} enviando={enviando} />
			</>
		);
	}

	return (
		<div className="ch-page">
			<header className="ch-brandbar">
				<div className="ch-container ch-brandbar-inner">
					<picture>
						<source srcSet="/logo-aasiam.webp" type="image/webp" />
						<img className="ch-brand-logo" src="/logo-aasiam.jpg" alt="" width="34" height="34" />
					</picture>
					<span className="ch-brand-text">
						<span className="ch-brand-name">AASIAM</span>
						<span className="ch-brand-sub">Atlética de Sistemas de Informação</span>
					</span>
					<a className="ch-brand-link" href="/">
						Loja oficial
					</a>
				</div>
			</header>

			<main className="ch-main">
				<div className="ch-container ch-grid">
					<EventoApresentacao />
					<div className="ch-panel">{painel()}</div>
				</div>
			</main>

			<footer className="ch-footer">
				<div className="ch-container">
					<p>© 2026 AASIAM. Todos os direitos reservados.</p>
				</div>
			</footer>
		</div>
	);
}
