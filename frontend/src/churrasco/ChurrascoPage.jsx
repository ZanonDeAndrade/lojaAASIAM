import { CalendarX2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import EventoApresentacao from './components/EventoApresentacao.jsx';
import ApresentacaoSemana from './components/ApresentacaoSemana.jsx';
import InscricaoForm from './components/InscricaoForm.jsx';
import PagamentoPix from './components/PagamentoPix.jsx';
import RecuperarInscricao from './components/RecuperarInscricao.jsx';
import useStatusInscricao from './useStatusInscricao.js';
import { esquecerPedido, guardarPedido, lerPedido, marcarPedidoPago } from './armazenamento.js';
import { paginaDoEvento } from './eventos.js';
import {
	EVENTO_AMF,
	cardapioPorExtenso,
	inscricoesAbertas,
	pessoasPorExtenso,
	prazoDoEvento,
} from '../shared/churrasco-eventos.js';
import './churrasco.css';

// Mesmo contrato da loja: em dev o proxy do Vite manda /api para o backend
// local; em produção VITE_API_URL aponta para o backend no Render.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/** Endereço da volta da InfinitePay. Mantido para não quebrar links antigos. */
export const ROTA_RETORNO = '/churrasco/pagamento-concluido';

const ERRO_CONEXAO =
	'Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.';

/** O maior atraso que um setTimeout aceita (~24,8 dias). */
const MAIOR_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * As inscrições ainda estão abertas?
 *
 * Pelo relógio do navegador, para a tela virar sozinha no prazo, e pela
 * configuração do backend, que é quem decide de verdade (prazo no relógio do
 * servidor e, se houver limite, as vagas). Sem prazo nem limite — o caso do
 * AMF — não pergunta nada a ninguém e fica sempre aberto.
 *
 * Devolve `null` (aberto), 'prazo' ou 'vagas'.
 */
function useFechamento(evento) {
	const temRegra = Boolean(evento.inscricoesAte) || Number.isInteger(evento.vagas);
	const [pelaHora, setPelaHora] = useState(() => inscricoesAbertas(evento));
	const [peloServidor, setPeloServidor] = useState(null);

	useEffect(() => {
		const prazo = prazoDoEvento(evento);
		if (prazo === null || !pelaHora) return undefined;
		const falta = prazo - Date.now() + 1;
		if (falta > MAIOR_TIMEOUT_MS) return undefined;
		const timer = setTimeout(() => setPelaHora(false), Math.max(0, falta));
		return () => clearTimeout(timer);
	}, [evento, pelaHora]);

	useEffect(() => {
		if (!temRegra) return undefined;
		let ativo = true;
		fetch(`${API_BASE}${evento.apiBase}/config`)
			.then((resposta) => (resposta.ok ? resposta.json() : null))
			.then((config) => {
				if (!ativo || typeof config?.inscricoesAbertas !== 'boolean') return;
				if (config.inscricoesAbertas) setPeloServidor(null);
				else setPeloServidor(config.vagasRestantes === 0 ? 'vagas' : 'prazo');
			})
			.catch(() => {
				/* sem resposta: vale o relógio, e o checkout confere de novo */
			});
		return () => {
			ativo = false;
		};
	}, [evento, temRegra]);

	if (!pelaHora) return { fechado: 'prazo', setPeloServidor };
	return { fechado: peloServidor, setPeloServidor };
}

/**
 * Página de um churrasco — /churrasco (Churrasco da Alcateia, AMF Games) ou
 * /churrasco-semana-academica (Churrasco da AASIAM, Semana Acadêmica de SI).
 *
 * Vive fora do fluxo da loja de propósito: sem carrinho, sem tema claro e sem
 * o header do e-commerce. O pagamento é por Pix, criado no Checkout
 * Transparente do Mercado Pago e concluído aqui dentro — não há saída para
 * outro checkout em momento algum.
 *
 * Duas telas no mesmo endereço: o formulário e, depois dele, o Pix.
 */
export default function ChurrascoPage({ eventoId = EVENTO_AMF }) {
	const pagina = paginaDoEvento(eventoId);
	const chave = pagina.chaveArmazenamento;

	const [pedido, setPedido] = useState(() => lerPedido(chave));
	const [enviando, setEnviando] = useState(false);
	const [gerandoNovo, setGerandoNovo] = useState(false);
	const { fechado, setPeloServidor } = useFechamento(pagina);

	// Guardado para poder gerar um novo Pix sem pedir tudo de novo.
	const ultimoFormulario = useRef(null);

	const status = useStatusInscricao({ apiBase: API_BASE, caminho: pagina.apiBase, pedido });
	const { adotar, esquecer } = status;

	// Quantidade e cardápio na comanda, para quem tem cardápio fixo.
	const detalheDaComanda = pagina.cardapio?.length
		? `${pessoasPorExtenso(pagina.pessoasPorInscricao)} · ${cardapioPorExtenso(pagina)} à vontade`
		: null;

	useEffect(() => {
		const html = document.documentElement;
		const tituloAnterior = document.title;
		const fundoAnterior = html.style.background;

		document.title = pagina.tituloDaAba;
		// A página é sempre preta, independente do tema salvo na loja — isso
		// evita uma faixa clara no overscroll de quem usa o modo claro.
		html.style.background = '#050806';

		return () => {
			document.title = tituloAnterior;
			html.style.background = fundoAnterior;
		};
	}, [pagina.tituloDaAba]);

	/* O link de retorno antigo (/churrasco/pagamento-concluido) continua
	   abrindo a inscrição guardada, mas o endereço volta a ser /churrasco:
	   não existe mais "voltar de um checkout". */
	useEffect(() => {
		if (eventoId !== EVENTO_AMF) return;
		if (window.location.pathname.replace(/\/$/, '') === ROTA_RETORNO) {
			window.history.replaceState({}, '', '/churrasco');
		}
	}, [eventoId]);

	/* Inscrição paga não vence no navegador: dá para voltar dias depois e
	   baixar o comprovante de novo. */
	const pago = Boolean(status.inscricao?.paid);
	useEffect(() => {
		if (pago && pedido) marcarPedidoPago(pedido.orderId, chave);
	}, [pago, pedido, chave]);

	/** Cria (ou renova) a cobrança Pix. Devolve `{ ok }` ou `{ ok, error }`. */
	const cobrar = useCallback(
		async (dados) => {
			try {
				const resposta = await fetch(`${API_BASE}${pagina.apiBase}/checkout`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(dados),
				});

				const corpo = await resposta.json().catch(() => null);

				// O prazo passou (ou as vagas acabaram) enquanto a página estava aberta.
				if (corpo?.encerradas) setPeloServidor('prazo');
				if (corpo?.esgotadas) setPeloServidor('vagas');

				if (!resposta.ok || !corpo?.ok) {
					return {
						ok: false,
						field: resposta.status === 400 ? corpo?.field : undefined,
						error: corpo?.error || 'Não foi possível gerar o Pix. Tente novamente.',
					};
				}

				ultimoFormulario.current = dados;
				guardarPedido(corpo.orderId, corpo.token, chave);
				setPedido({ orderId: corpo.orderId, token: corpo.token });
				adotar(corpo);

				return { ok: true };
			} catch {
				return { ok: false, error: ERRO_CONEXAO };
			}
		},
		[adotar, chave, pagina.apiBase, setPeloServidor],
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
		esquecerPedido(chave);
		ultimoFormulario.current = null;
		setPedido(null);
		esquecer();
	}

	/**
	 * A recuperação devolveu o token: daqui em diante é como se a inscrição
	 * tivesse sido feita neste navegador. Paga, a tela vai direto para o
	 * comprovante; ainda em aberto, a primeira consulta traz o Pix de volta.
	 */
	function aoRecuperar(corpo) {
		guardarPedido(corpo.orderId, corpo.token, chave);
		if (corpo.paid) marcarPedidoPago(corpo.orderId, chave);
		ultimoFormulario.current = null;
		if (corpo.final) {
			setPedido({ orderId: corpo.orderId, token: corpo.token });
			adotar(corpo);
		} else {
			esquecer();
			setPedido({ orderId: corpo.orderId, token: corpo.token });
		}
	}

	const recuperacao = pagina.recuperacao ? (
		<RecuperarInscricao
			apiBase={API_BASE}
			caminho={pagina.apiBase}
			exemploDeCodigo={`${pagina.prefixo}2026-…`}
			onRecuperada={aoRecuperar}
			abertoDeInicio={Boolean(fechado)}
		/>
	) : null;

	function painel() {
		if (pedido) {
			return (
				<PagamentoPix
					apiBase={API_BASE}
					caminho={pagina.apiBase}
					tituloDoEvento={pagina.titulo}
					detalheDaComanda={detalheDaComanda}
					inscricoesAbertas={!fechado && status.inscricao?.inscricoesAbertas !== false}
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

		if (fechado) {
			const porVagas = fechado === 'vagas';
			return (
				<>
					<div className="ch-encerradas" role="status">
						<span className="ch-retorno-icone is-alerta">
							<CalendarX2 size={26} aria-hidden="true" />
						</span>
						<h2 className="ch-panel-title">
							{porVagas ? 'Vagas esgotadas' : 'Inscrições encerradas'}
						</h2>
						<p className="ch-panel-hint">
							{porVagas
								? 'Todas as vagas do churrasco foram preenchidas.'
								: pagina.inscricoesAteTexto
									? `As inscrições terminaram em ${pagina.inscricoesAteTexto}.`
									: 'As inscrições terminaram.'}{' '}
							Quem já pagou continua confirmado.
						</p>
					</div>
					{recuperacao}
				</>
			);
		}

		return (
			<>
				<div className="ch-panel-head">
					<h2 className="ch-panel-title">Inscrição</h2>
					<p className="ch-panel-hint">{pagina.dicaDoFormulario}</p>
				</div>
				<InscricaoForm evento={pagina} onGerarPix={enviarFormulario} enviando={enviando} />
				{recuperacao}
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
				{pagina.banner && (
					<div className="ch-container">
						<picture className="ch-banner">
							<source srcSet={pagina.banner.webp} type="image/webp" />
							<img
								src={pagina.banner.src}
								alt={pagina.banner.alt}
								width={pagina.banner.largura}
								height={pagina.banner.altura}
								fetchpriority="high"
								decoding="async"
							/>
						</picture>
					</div>
				)}

				<div className="ch-container ch-grid">
					{eventoId === EVENTO_AMF ? (
						<EventoApresentacao />
					) : (
						<ApresentacaoSemana evento={pagina} fechado={Boolean(fechado)} />
					)}
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
