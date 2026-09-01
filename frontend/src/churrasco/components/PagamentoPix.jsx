import {
	AlertCircle,
	ArrowLeft,
	Check,
	CheckCircle2,
	Copy,
	ExternalLink,
	Loader2,
	RefreshCw,
	SearchCheck,
	Smartphone,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { formatBRL } from '../../shared/churrasco.js';
import Comanda from './Comanda.jsx';

/**
 * O pagamento inteiro, dentro da página. Não há redirecionamento: o QR Code e
 * o copia e cola vêm do backend, que os obteve na API de Orders do Mercado
 * Pago, e a confirmação chega pelo webhook.
 *
 * A comanda continua sendo o objeto central da tela — o QR é impresso nela,
 * numa faixa clara (código de barras precisa de fundo claro para ser lido), e
 * o carimbo que já existia é quem muda de "Aguardando" para "Pago".
 */

/** Só formatos de imagem que o navegador renderiza a partir de Base64. */
const MIMES_ACEITOS = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function mimeSeguro(valor) {
	const mime = String(valor || '').toLowerCase().trim();
	return MIMES_ACEITOS.has(mime) ? mime : 'image/png';
}

/** "12:04" a partir de milissegundos. */
function formatarContagem(ms) {
	const total = Math.max(0, Math.floor(ms / 1000));
	const minutos = String(Math.floor(total / 60)).padStart(2, '0');
	const segundos = String(total % 60).padStart(2, '0');
	return `${minutos}:${segundos}`;
}

/** Conta o tempo que resta no Pix. `null` quando não há validade conhecida. */
function useContagem(expiraEm) {
	const [restante, setRestante] = useState(() => calcular(expiraEm));

	useEffect(() => {
		setRestante(calcular(expiraEm));
		if (calcular(expiraEm) === null) return undefined;

		const timer = setInterval(() => setRestante(calcular(expiraEm)), 1000);
		return () => clearInterval(timer);
	}, [expiraEm]);

	return restante;
}

function calcular(expiraEm) {
	if (!expiraEm) return null;
	const instante = Date.parse(expiraEm);
	if (Number.isNaN(instante)) return null;
	return Math.max(0, instante - Date.now());
}

/** Copia com fallback para navegadores sem a Clipboard API. */
async function copiar(texto) {
	try {
		await navigator.clipboard.writeText(texto);
		return true;
	} catch {
		try {
			const campo = document.createElement('textarea');
			campo.value = texto;
			campo.setAttribute('readonly', '');
			campo.style.position = 'fixed';
			campo.style.opacity = '0';
			document.body.appendChild(campo);
			campo.select();
			const deu = document.execCommand('copy');
			document.body.removeChild(campo);
			return deu;
		} catch {
			return false;
		}
	}
}

function BotaoCopiar({ codigo }) {
	const [estado, setEstado] = useState('pronto'); // pronto | copiado | falhou
	const timer = useRef(null);

	useEffect(() => () => clearTimeout(timer.current), []);

	async function aoClicar() {
		const deu = await copiar(codigo);
		setEstado(deu ? 'copiado' : 'falhou');
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setEstado('pronto'), 2600);
	}

	return (
		<>
			<button
				className={`ch-btn ch-btn-copiar${estado === 'copiado' ? ' is-copiado' : ''}`}
				type="button"
				onClick={aoClicar}
			>
				{estado === 'copiado' ? (
					<>
						<Check size={17} aria-hidden="true" />
						Código copiado
					</>
				) : (
					<>
						<Copy size={17} aria-hidden="true" />
						Copiar código Pix
					</>
				)}
			</button>
			<span className="ch-sr-only" role="status">
				{estado === 'copiado' ? 'Código Pix copiado.' : ''}
				{estado === 'falhou' ? 'Não foi possível copiar. Selecione o código manualmente.' : ''}
			</span>
			{estado === 'falhou' && (
				<p className="ch-pix-aviso">
					Seu navegador bloqueou a cópia. Selecione o código acima e copie manualmente.
				</p>
			)}
		</>
	);
}

/** Cabeçalho comum das telas que não são o Pix em si. */
function Cabecalho({ tom = 'neutro', icone, titulo, texto, tituloRef }) {
	return (
		<div className="ch-retorno-head">
			<span className={`ch-retorno-icone is-${tom}`}>{icone}</span>
			<h2 className="ch-retorno-titulo" ref={tituloRef} tabIndex={-1}>
				{titulo}
			</h2>
			{texto && <p className="ch-retorno-texto">{texto}</p>}
		</div>
	);
}

export default function PagamentoPix({
	inscricao,
	carregando,
	verificando,
	gerandoNovo,
	erro,
	naoEncontrada,
	onVerificarAgora,
	onGerarNovoPix,
	onVoltarAoFormulario,
}) {
	const tituloRef = useRef(null);
	const pix = inscricao?.pix ?? null;
	const restante = useContagem(pix?.expiraEm || inscricao?.expiraEm);

	// Leitores de tela anunciam a etapa assim que ela troca.
	useEffect(() => {
		tituloRef.current?.focus();
	}, [inscricao?.status, carregando, naoEncontrada]);

	/* ── Gerando a cobrança ── */
	if (carregando || gerandoNovo) {
		return (
			<div className="ch-retorno ch-reveal">
				<Cabecalho
					icone={<Loader2 size={26} className="ch-spin" aria-hidden="true" />}
					titulo="Gerando seu Pix..."
					texto="Estamos criando a cobrança no Mercado Pago. Leva alguns segundos."
					tituloRef={tituloRef}
				/>
			</div>
		);
	}

	/* ── Sem inscrição para mostrar ── */
	if (naoEncontrada || !inscricao) {
		return (
			<div className="ch-retorno ch-reveal">
				<Cabecalho
					tom="alerta"
					icone={<AlertCircle size={26} aria-hidden="true" />}
					titulo="Não encontramos esta inscrição."
					texto="Ela não está guardada neste navegador. Se você já pagou, procure a organização com o comprovante do Pix em mãos."
					tituloRef={tituloRef}
				/>
				{erro && (
					<div className="ch-alert" role="alert">
						<AlertCircle size={17} aria-hidden="true" />
						<span>{erro}</span>
					</div>
				)}
				<button className="ch-btn ch-btn-primary" type="button" onClick={onVoltarAoFormulario}>
					<ArrowLeft size={17} aria-hidden="true" />
					Fazer uma nova inscrição
				</button>
			</div>
		);
	}

	const { status, statusLabel, nome, curso, categoria, amountCents, orderId, receiptUrl } =
		inscricao;

	/* ── Pagamento confirmado ── */
	if (status === 'pago') {
		return (
			<div className="ch-sucesso ch-reveal" role="status">
				<div className="ch-sucesso-head">
					<span className="ch-sucesso-icon">
						<CheckCircle2 size={34} aria-hidden="true" />
					</span>
					<h2 className="ch-sucesso-title" ref={tituloRef} tabIndex={-1}>
						Pagamento confirmado!
					</h2>
					<p className="ch-sucesso-msg">
						Sua inscrição no Churrasco da Alcateia está confirmada. Guarde o código da
						comanda: é ele que vale na entrada.
					</p>
				</div>

				<Comanda
					nome={nome}
					curso={curso}
					categoria={categoria}
					valorCents={amountCents}
					codigo={orderId}
					status="Pago"
					pago
				/>

				{receiptUrl && (
					<a
						className="ch-btn ch-btn-ghost"
						href={receiptUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						<ExternalLink size={17} aria-hidden="true" />
						Abrir comprovante
					</a>
				)}

				<button className="ch-btn ch-btn-ghost" type="button" onClick={onVoltarAoFormulario}>
					Inscrever outra pessoa
				</button>
			</div>
		);
	}

	/* ── Pix recebido, banco ainda liquidando ── */
	if (status === 'processando') {
		return (
			<div className="ch-retorno ch-reveal">
				<Cabecalho
					icone={<Loader2 size={26} className="ch-spin" aria-hidden="true" />}
					titulo="Recebemos seu Pix."
					texto="O banco está liquidando a transferência. Esta página confirma sozinha assim que o valor cair."
					tituloRef={tituloRef}
				/>
				<Resumo nome={nome} curso={curso} codigo={orderId} />
				<AvisoAutomatico />
				<BotaoVerificar verificando={verificando} onVerificarAgora={onVerificarAgora} />
			</div>
		);
	}

	/* ── Em conferência pela organização ──
	   O backend marca assim quando o valor ou o meio de pagamento não bateu.
	   Não é erro da pessoa e o detalhe técnico não vai para a tela. */
	if (status === 'revisao_manual') {
		return (
			<div className="ch-retorno ch-reveal">
				<Cabecalho
					tom="alerta"
					icone={<SearchCheck size={26} aria-hidden="true" />}
					titulo="Estamos conferindo seu pagamento."
					texto="A organização confirma sua inscrição manualmente. Guarde o código abaixo e o comprovante do pagamento."
					tituloRef={tituloRef}
				/>
				<Resumo nome={nome} curso={curso} codigo={orderId} />
				{receiptUrl && (
					<a
						className="ch-btn ch-btn-ghost"
						href={receiptUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						<ExternalLink size={17} aria-hidden="true" />
						Abrir comprovante
					</a>
				)}
			</div>
		);
	}

	/* ── Pix vencido ou pagamento não concluído ──
	   O contador chega a zero antes de o Mercado Pago marcar a order como
	   expirada; quando isso acontece, a tela já para de mostrar o QR. */
	const venceuNaTela = restante === 0;
	const encerrado = inscricao.final || venceuNaTela;

	if (encerrado) {
		const expirou = status === 'expirado' || venceuNaTela;
		return (
			<div className="ch-retorno ch-reveal">
				<Cabecalho
					tom="alerta"
					icone={<AlertCircle size={26} aria-hidden="true" />}
					titulo={expirou ? 'O código Pix venceu.' : 'O pagamento não foi concluído.'}
					texto={
						expirou
							? 'Nada foi cobrado. Gere um novo código para continuar a inscrição — os seus dados já estão guardados.'
							: 'Nada foi cobrado. Você pode gerar um novo código Pix e tentar de novo.'
					}
					tituloRef={tituloRef}
				/>

				<Resumo nome={nome} curso={curso} codigo={orderId} situacao={statusLabel} />

				{erro && (
					<div className="ch-alert" role="alert">
						<AlertCircle size={17} aria-hidden="true" />
						<span>{erro}</span>
					</div>
				)}

				<button
					className="ch-btn ch-btn-primary"
					type="button"
					onClick={onGerarNovoPix}
					disabled={gerandoNovo}
				>
					<RefreshCw size={17} aria-hidden="true" />
					Gerar um novo Pix
				</button>

				<button className="ch-btn ch-btn-ghost" type="button" onClick={onVoltarAoFormulario}>
					Inscrever outra pessoa
				</button>
			</div>
		);
	}

	/* ── Aguardando o pagamento: a comanda com o QR impresso ── */
	return (
		<div className="ch-pix ch-reveal">
			<div className="ch-pix-head">
				<h2 className="ch-pix-titulo" ref={tituloRef} tabIndex={-1}>
					Pague {formatBRL(amountCents)} por Pix
				</h2>
				<p className="ch-pix-instrucao">
					<Smartphone size={15} aria-hidden="true" />
					Abra o app do seu banco, escolha Pix e aponte a câmera para o código.
				</p>
			</div>

			<div className="ch-comanda ch-comanda-pix">
				<div className="ch-comanda-eyebrow">Comanda · aguardando pagamento</div>
				<div className="ch-comanda-curso">{curso}</div>
				<div className="ch-comanda-categoria">{categoria}</div>

				<div className="ch-comanda-tear" aria-hidden="true" />

				{pix?.qrCodeBase64 ? (
					<div className="ch-qr">
						<img
							className="ch-qr-img"
							src={`data:${mimeSeguro(pix.mimeType)};base64,${pix.qrCodeBase64}`}
							alt="QR Code para pagamento via Pix"
							width="280"
							height="280"
						/>
					</div>
				) : (
					<p className="ch-pix-aviso">
						O QR Code não veio desta vez. Use o código copia e cola abaixo — ele funciona
						igual.
					</p>
				)}

				{pix?.qrCode && (
					<>
						<div className="ch-pix-copia-label">Pix copia e cola</div>
						<p className="ch-pix-copia" title={pix.qrCode}>
							{pix.qrCode}
						</p>
					</>
				)}

				<div className="ch-comanda-tear" aria-hidden="true" />

				<div className="ch-comanda-foot">
					<div>
						<span className="ch-comanda-valor-label">Valor da inscrição</span>
						<span className="ch-comanda-valor">{formatBRL(amountCents)}</span>
					</div>
					<span className="ch-stamp">Aguardando</span>
				</div>
			</div>

			{pix?.qrCode && <BotaoCopiar codigo={pix.qrCode} />}

			{restante !== null && (
				<p className={`ch-pix-validade${restante < 5 * 60 * 1000 ? ' is-urgente' : ''}`}>
					<span className="ch-pix-validade-label">Este código vence em</span>
					<time className="ch-pix-relogio">{formatarContagem(restante)}</time>
				</p>
			)}

			<Resumo nome={nome} curso={curso} codigo={orderId} />

			<AvisoAutomatico />

			{erro && (
				<div className="ch-alert" role="alert">
					<AlertCircle size={17} aria-hidden="true" />
					<span>{erro}</span>
				</div>
			)}

			<BotaoVerificar verificando={verificando} onVerificarAgora={onVerificarAgora} />
		</div>
	);
}

function Resumo({ nome, curso, codigo, situacao }) {
	return (
		<dl className="ch-retorno-resumo">
			<div>
				<dt>Participante</dt>
				<dd>{nome}</dd>
			</div>
			{curso && (
				<div>
					<dt>Curso</dt>
					<dd>{curso}</dd>
				</div>
			)}
			<div>
				<dt>Código</dt>
				<dd className="ch-retorno-codigo">{codigo}</dd>
			</div>
			{situacao && (
				<div>
					<dt>Situação</dt>
					<dd>{situacao}</dd>
				</div>
			)}
		</dl>
	);
}

function AvisoAutomatico() {
	return (
		<p className="ch-retorno-auto" role="status">
			<RefreshCw size={13} className="ch-spin-lento" aria-hidden="true" />
			Status: aguardando pagamento — verificamos sozinhos a cada 7 segundos
		</p>
	);
}

function BotaoVerificar({ verificando, onVerificarAgora }) {
	return (
		<button
			className="ch-btn ch-btn-ghost"
			type="button"
			onClick={onVerificarAgora}
			disabled={verificando}
		>
			{verificando ? (
				<>
					<Loader2 size={17} className="ch-spin" aria-hidden="true" />
					Verificando...
				</>
			) : (
				'Verificar pagamento'
			)}
		</button>
	);
}
