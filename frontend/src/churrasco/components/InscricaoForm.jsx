import { AlertCircle, ArrowRight, Check, Loader2 } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';

import {
	COURSES,
	EMAIL_MAX_LENGTH,
	NAME_MAX_LENGTH,
	formatPhoneBR,
	normalizeEmail,
	normalizeFullName,
	normalizePhoneDigits,
	validateEmail,
	validateFullName,
	validatePhone,
} from '../../shared/churrasco.js';
import {
	EVENTOS_CHURRASCO,
	EVENTO_AMF,
	cardapioPorExtenso,
	pessoasPorExtenso,
	resumoDaInscricao,
} from '../../shared/churrasco-eventos.js';
import CampoCurso from './CampoCurso.jsx';
import Comanda from './Comanda.jsx';

// O e-mail é obrigatório: `payer.email` é exigido pelo Pix da API de Orders.
const CAMPOS_VAZIOS = { nome: '', telefone: '', email: '', curso: '' };
const ORDEM = ['nome', 'telefone', 'email', 'curso'];

/** Valida um campo isolado. Devolve a mensagem de erro ou `null`. */
function validarCampo(campo, valor) {
	if (campo === 'nome') return validateFullName(valor);
	if (campo === 'telefone') return validatePhone(valor);
	if (campo === 'email') return validateEmail(valor);
	if (campo === 'curso') return valor ? null : 'Selecione seu curso para continuar.';
	return null;
}

export default function InscricaoForm({
	evento = EVENTOS_CHURRASCO[EVENTO_AMF],
	onGerarPix,
	enviando,
}) {
	const [valores, setValores] = useState(CAMPOS_VAZIOS);
	// Só existe nos eventos que perguntam; não é obrigatório. Lido aqui, fora
	// de `enviar`, porque lá `evento` é o evento de submit do formulário.
	const perguntaCarona = Boolean(evento.carona);
	const [carona, setCarona] = useState(false);
	const [erros, setErros] = useState({});
	const [tocados, setTocados] = useState({});
	const [erroEnvio, setErroEnvio] = useState(null);

	const refs = {
		nome: useRef(null),
		telefone: useRef(null),
		email: useRef(null),
	};

	const baseId = useId();
	const idDe = (campo) => `${baseId}-${campo}`;
	const idErroDe = (campo) => `${baseId}-${campo}-erro`;

	// O campo de curso é um botão gerenciado pelo CampoCurso, sem ref própria.
	const focar = (campo) =>
		(refs[campo]?.current ?? document.getElementById(idDe(campo)))?.focus();

	// O valor aparece no mesmo instante em que o curso é escolhido; o servidor
	// recalcula tudo de novo antes de cobrar.
	const resumo = useMemo(() => resumoDaInscricao(evento, valores.curso), [evento, valores.curso]);

	// Quantidade e cardápio na comanda, para quem tem cardápio fixo.
	const detalheDaComanda =
		resumo && evento.cardapio?.length
			? `${pessoasPorExtenso(resumo.pessoas)} · ${cardapioPorExtenso(evento)} à vontade`
			: null;

	function alterar(campo, valorBruto) {
		const valor = campo === 'telefone' ? formatPhoneBR(valorBruto) : valorBruto;
		setValores((prev) => ({ ...prev, [campo]: valor }));
		setErroEnvio(null);
		// Corrige a mensagem em tempo real assim que o campo passa a ser válido.
		if (erros[campo] && !validarCampo(campo, valor)) {
			setErros((prev) => ({ ...prev, [campo]: null }));
		}
	}

	function aoSair(campo) {
		setTocados((prev) => ({ ...prev, [campo]: true }));

		let valor = valores[campo];
		if (campo === 'nome') valor = normalizeFullName(valor);
		if (campo === 'email') valor = normalizeEmail(valor);
		if (valor !== valores[campo]) setValores((prev) => ({ ...prev, [campo]: valor }));

		setErros((prev) => ({ ...prev, [campo]: validarCampo(campo, valor) }));
	}

	function escolherCurso(curso) {
		setValores((prev) => ({ ...prev, curso }));
		setErros((prev) => ({ ...prev, curso: null }));
		setErroEnvio(null);
	}

	async function enviar(evento) {
		evento.preventDefault();
		if (enviando) return; // trava cliques repetidos

		const novosErros = Object.fromEntries(
			ORDEM.map((campo) => [campo, validarCampo(campo, valores[campo])]),
		);
		setErros(novosErros);
		setTocados(Object.fromEntries(ORDEM.map((campo) => [campo, true])));

		const primeiroInvalido = ORDEM.find((campo) => novosErros[campo]);
		if (primeiroInvalido) {
			focar(primeiroInvalido);
			return;
		}

		setErroEnvio(null);

		// Os nomes dos campos são os que a rota do backend espera.
		const resultado = await onGerarPix({
			name: normalizeFullName(valores.nome),
			phone: normalizePhoneDigits(valores.telefone),
			email: normalizeEmail(valores.email),
			course: valores.curso,
			...(perguntaCarona ? { needsRide: carona } : {}),
		});

		if (resultado?.ok) return;

		// Erro de validação do servidor volta para o campo de origem.
		const campoDoServidor = {
			name: 'nome',
			phone: 'telefone',
			email: 'email',
			course: 'curso',
		}[resultado?.field];
		if (campoDoServidor) {
			setErros((prev) => ({ ...prev, [campoDoServidor]: resultado.error }));
			focar(campoDoServidor);
			return;
		}
		setErroEnvio(resultado?.error || 'Não foi possível abrir o pagamento. Tente novamente.');
	}

	const mostrarErro = (campo) => Boolean((tocados[campo] || erros[campo]) && erros[campo]);

	function campoDeTexto({ campo, rotulo, ...props }) {
		return (
			<div className="ch-field" key={campo}>
				<label className="ch-label" htmlFor={idDe(campo)}>
					{rotulo}
				</label>
				<input
					id={idDe(campo)}
					ref={refs[campo]}
					className="ch-input"
					name={campo}
					value={valores[campo]}
					onChange={(e) => alterar(campo, e.target.value)}
					onBlur={() => aoSair(campo)}
					aria-invalid={mostrarErro(campo) ? 'true' : undefined}
					aria-describedby={mostrarErro(campo) ? idErroDe(campo) : undefined}
					disabled={enviando}
					{...props}
				/>
				{mostrarErro(campo) && (
					<p className="ch-error" id={idErroDe(campo)} role="alert">
						<AlertCircle size={15} aria-hidden="true" />
						{erros[campo]}
					</p>
				)}
			</div>
		);
	}

	return (
		<form className="ch-form" onSubmit={enviar} noValidate aria-busy={enviando}>
			{campoDeTexto({
				campo: 'nome',
				rotulo: 'Nome completo',
				type: 'text',
				autoComplete: 'name',
				maxLength: NAME_MAX_LENGTH,
				placeholder: 'Nome e sobrenome',
			})}

			{campoDeTexto({
				campo: 'telefone',
				rotulo: 'Telefone ou WhatsApp',
				type: 'tel',
				inputMode: 'tel',
				autoComplete: 'tel-national',
				maxLength: 15,
				placeholder: '(55) 99999-9999',
			})}

			{campoDeTexto({
				campo: 'email',
				rotulo: 'E-mail',
				type: 'email',
				inputMode: 'email',
				autoComplete: 'email',
				spellCheck: 'false',
				maxLength: EMAIL_MAX_LENGTH,
				placeholder: 'voce@exemplo.com',
			})}

			<div className="ch-field">
				<label className="ch-label" htmlFor={idDe('curso')}>
					Curso
				</label>
				<CampoCurso
					id={idDe('curso')}
					opcoes={COURSES}
					valor={valores.curso}
					aoEscolher={escolherCurso}
					aoSair={() => aoSair('curso')}
					invalido={mostrarErro('curso')}
					descritoPor={mostrarErro('curso') ? idErroDe('curso') : undefined}
					desabilitado={enviando}
				/>
				{mostrarErro('curso') && (
					<p className="ch-error" id={idErroDe('curso')} role="alert">
						<AlertCircle size={15} aria-hidden="true" />
						{erros.curso}
					</p>
				)}
			</div>

			{perguntaCarona && (
				<div className="ch-field">
					<label className="ch-check" htmlFor={idDe('carona')}>
						<input
							id={idDe('carona')}
							className="ch-check-input"
							type="checkbox"
							name="carona"
							checked={carona}
							onChange={(e) => setCarona(e.target.checked)}
							disabled={enviando}
							aria-describedby={idDe('carona-dica')}
						/>
						<span className="ch-check-caixa" aria-hidden="true">
							<Check size={14} strokeWidth={3} />
						</span>
						<span className="ch-check-texto">
							<span className="ch-check-rotulo">Preciso de carona</span>
							<span className="ch-check-dica" id={idDe('carona-dica')}>
								Ajuda a organização a combinar as caronas no dia.
							</span>
						</span>
					</label>
				</div>
			)}

			{/* A comanda aparece assim que o curso é escolhido. */}
			{resumo && (
				<Comanda
					curso={resumo.course}
					categoria={resumo.category}
					detalhe={detalheDaComanda}
					valorCents={resumo.priceCents}
				/>
			)}

			{erroEnvio && (
				<div className="ch-alert" role="alert">
					<AlertCircle size={17} aria-hidden="true" />
					<span>{erroEnvio}</span>
				</div>
			)}

			<button className="ch-btn ch-btn-primary" type="submit" disabled={enviando}>
				{enviando ? (
					<>
						<Loader2 size={17} className="ch-spin" aria-hidden="true" />
						Gerando seu Pix...
					</>
				) : (
					<>
						Gerar Pix da inscrição
						<ArrowRight size={17} aria-hidden="true" />
					</>
				)}
			</button>

			<p className="ch-form-nota">
				O QR Code e o código copia e cola aparecem aqui mesmo, nesta página.{' '}
				{evento.recuperacao
					? 'Usamos seu e-mail para emitir a cobrança Pix e para você recuperar o comprovante depois.'
					: 'Usamos seu e-mail só para emitir a cobrança Pix.'}
			</p>
		</form>
	);
}
