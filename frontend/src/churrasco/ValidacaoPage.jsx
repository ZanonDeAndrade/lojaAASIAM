import { AlertTriangle, CheckCircle2, Loader2, SearchCheck, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { CHURRASCO_EVENTO } from './config.js';
import './churrasco.css';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/**
 * Página /churrasco/validar/:token — o que o QR Code do comprovante abre.
 *
 * Quem lê isto está na fila da entrada, com o celular na mão, provavelmente à
 * noite. Então a tela é uma coisa só: um veredito do tamanho da largura da
 * tela, e abaixo dele os dados para conferir com a pessoa. Nada mais.
 *
 * O token do QR não é fonte de verdade nenhuma: o backend só o usa para
 * localizar a inscrição, e a situação vem da planilha, lida na hora. Esta
 * página nunca altera nada — não confirma pagamento nem marca presença.
 */

/** O token vem da própria URL; nada do que está nele é exibido. */
function tokenDaUrl() {
	const partes = window.location.pathname.split('/').filter(Boolean);
	const i = partes.indexOf('validar');
	return i >= 0 && partes[i + 1] ? decodeURIComponent(partes[i + 1]) : '';
}

const VEREDITOS = {
	pago: {
		tom: 'valido',
		titulo: 'Comprovante válido',
		linha: 'Pagamento confirmado',
		icone: CheckCircle2,
	},
	invalido: {
		tom: 'invalido',
		titulo: 'Comprovante inválido',
		linha: 'Este código não corresponde a nenhuma inscrição.',
		icone: XCircle,
	},
	pendente: {
		tom: 'atencao',
		titulo: 'Pagamento não confirmado',
		linha: 'A inscrição existe, mas o pagamento ainda não entrou.',
		icone: AlertTriangle,
	},
};

/** Situações que existem, mas não liberam a entrada. */
const RECUSADOS = {
	processando: 'O Pix está sendo liquidado pelo banco.',
	expirado: 'O Pix venceu sem pagamento.',
	cancelado: 'O pagamento foi cancelado.',
	falhou: 'O pagamento não foi concluído.',
	recusado: 'O pagamento não foi concluído.',
	reembolsado: 'O pagamento foi reembolsado.',
	revisao_manual: 'A organização está conferindo este pagamento.',
	erro: 'A inscrição não chegou a ser cobrada.',
	pendente: 'O pagamento ainda não entrou.',
};

export default function ValidacaoPage() {
	const [estado, setEstado] = useState('consultando');
	const [dados, setDados] = useState(null);

	useEffect(() => {
		document.title = `Validar comprovante | ${CHURRASCO_EVENTO.titulo}`;
		const html = document.documentElement;
		const fundoAnterior = html.style.background;
		html.style.background = '#050806';
		return () => {
			html.style.background = fundoAnterior;
		};
	}, []);

	useEffect(() => {
		const token = tokenDaUrl();
		if (!token) {
			setDados(null);
			setEstado('pronto');
			return undefined;
		}

		let ativo = true;
		(async () => {
			try {
				const resposta = await fetch(
					`${API_BASE}/api/churrasco/comprovantes/validar/${encodeURIComponent(token)}`,
				);
				const corpo = await resposta.json().catch(() => null);
				if (!ativo) return;

				if (!resposta.ok || !corpo?.ok) {
					setEstado('indisponivel');
					return;
				}
				setDados(corpo);
				setEstado('pronto');
			} catch {
				if (ativo) setEstado('indisponivel');
			}
		})();

		return () => {
			ativo = false;
		};
	}, []);

	function conteudo() {
		if (estado === 'consultando') {
			return (
				<div className="ch-validacao-carregando" role="status">
					<Loader2 size={30} className="ch-spin" aria-hidden="true" />
					<p>Consultando a inscrição...</p>
				</div>
			);
		}

		if (estado === 'indisponivel') {
			return (
				<div className="ch-validacao ch-reveal">
					<div className="ch-veredito is-atencao">
						<SearchCheck size={30} aria-hidden="true" />
						<strong>Não deu para validar agora</strong>
					</div>
					<p className="ch-validacao-linha">
						A conexão falhou. Tente de novo, ou confira o código da inscrição na lista da
						organização.
					</p>
				</div>
			);
		}

		const valido = Boolean(dados?.valido);
		const existe = Boolean(dados?.orderId);
		const chave = valido ? 'pago' : existe ? 'pendente' : 'invalido';
		const veredito = VEREDITOS[chave];
		const Icone = veredito.icone;

		return (
			<div className="ch-validacao ch-reveal">
				<div className={`ch-veredito is-${veredito.tom}`} role="status">
					<Icone size={30} aria-hidden="true" />
					<strong>{veredito.titulo}</strong>
				</div>

				<p className="ch-validacao-linha">
					{valido ? veredito.linha : RECUSADOS[dados?.status] || veredito.linha}
				</p>

				{existe && (
					<>
						<div className="ch-validacao-nome">{dados.nome}</div>
						<dl className="ch-retorno-resumo">
							{dados.curso && (
								<div>
									<dt>Curso</dt>
									<dd>{dados.curso}</dd>
								</div>
							)}
							{dados.categoria && (
								<div>
									<dt>Categoria</dt>
									<dd>{dados.categoria}</dd>
								</div>
							)}
							<div>
								<dt>Valor</dt>
								<dd>{dados.amount}</dd>
							</div>
							{dados.pagoEm && (
								<div>
									<dt>Confirmado em</dt>
									<dd>{dados.pagoEm}</dd>
								</div>
							)}
							<div>
								<dt>Situação</dt>
								<dd>{dados.statusLabel}</dd>
							</div>
							<div>
								<dt>Código</dt>
								<dd className="ch-retorno-codigo">{dados.orderId}</dd>
							</div>
						</dl>
					</>
				)}

				<p className="ch-validacao-nota">
					Situação consultada agora, direto no registro da inscrição.
				</p>
			</div>
		);
	}

	return (
		<div className="ch-page ch-page-validacao">
			<header className="ch-brandbar">
				<div className="ch-container ch-brandbar-inner">
					<picture>
						<source srcSet="/logo-aasiam.webp" type="image/webp" />
						<img className="ch-brand-logo" src="/logo-aasiam.jpg" alt="" width="34" height="34" />
					</picture>
					<span className="ch-brand-text">
						<span className="ch-brand-name">AASIAM</span>
						<span className="ch-brand-sub">{CHURRASCO_EVENTO.titulo}</span>
					</span>
				</div>
			</header>

			<main className="ch-main">
				<div className="ch-container ch-validacao-wrap">
					<div className="ch-panel">{conteudo()}</div>
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
