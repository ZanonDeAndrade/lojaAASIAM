import { AlertCircle, Loader2, SearchCheck } from 'lucide-react';
import { useId, useState } from 'react';

import { normalizeEmail, validateEmail } from '../../shared/churrasco.js';

const ERRO_CONEXAO =
	'Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.';

/**
 * "Já se inscreveu?" — devolve a inscrição a quem trocou de celular, limpou o
 * navegador ou quer o comprovante de novo dias depois.
 *
 * Pede o e-mail da inscrição e o código impresso no comprovante. O backend
 * responde a mesma mensagem para qualquer falha, então a tela também não
 * distingue "e-mail errado" de "código errado": mostra o que o servidor disse.
 */
export default function RecuperarInscricao({
	apiBase,
	caminho,
	exemploDeCodigo,
	onRecuperada,
	abertoDeInicio = false,
}) {
	const [aberto, setAberto] = useState(abertoDeInicio);
	const [email, setEmail] = useState('');
	const [codigo, setCodigo] = useState('');
	const [erro, setErro] = useState(null);
	const [enviando, setEnviando] = useState(false);

	const baseId = useId();
	const idDe = (campo) => `${baseId}-${campo}`;

	if (!aberto) {
		return (
			<button className="ch-recuperar-abrir" type="button" onClick={() => setAberto(true)}>
				<SearchCheck size={16} aria-hidden="true" />
				Já se inscreveu? Recuperar comprovante
			</button>
		);
	}

	async function enviar(evento) {
		evento.preventDefault();
		if (enviando) return;

		const emailLimpo = normalizeEmail(email);
		const codigoLimpo = codigo.toUpperCase().replace(/\s+/g, '');
		if (validateEmail(emailLimpo) || !codigoLimpo) {
			setErro('Informe o e-mail da inscrição e o código que está no comprovante.');
			return;
		}

		setEnviando(true);
		setErro(null);
		try {
			const resposta = await fetch(`${apiBase}${caminho}/inscricoes/recuperar`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: emailLimpo, codigo: codigoLimpo }),
			});
			const corpo = await resposta.json().catch(() => null);

			if (!resposta.ok || !corpo?.ok || !corpo?.token) {
				setErro(corpo?.error || 'Não foi possível consultar agora. Tente novamente em instantes.');
				return;
			}
			onRecuperada(corpo);
		} catch {
			setErro(ERRO_CONEXAO);
		} finally {
			setEnviando(false);
		}
	}

	return (
		<form className="ch-recuperar ch-reveal" onSubmit={enviar} noValidate aria-busy={enviando}>
			<div>
				<h3 className="ch-recuperar-titulo">Recuperar inscrição</h3>
				<p className="ch-recuperar-dica">
					Use o e-mail da inscrição e o código que aparece no comprovante e na tela de
					confirmação.
				</p>
			</div>

			<div className="ch-field">
				<label className="ch-label" htmlFor={idDe('email')}>
					E-mail da inscrição
				</label>
				<input
					id={idDe('email')}
					className="ch-input"
					type="email"
					inputMode="email"
					autoComplete="email"
					spellCheck="false"
					maxLength={120}
					placeholder="voce@exemplo.com"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					disabled={enviando}
				/>
			</div>

			<div className="ch-field">
				<label className="ch-label" htmlFor={idDe('codigo')}>
					Código da inscrição
				</label>
				<input
					id={idDe('codigo')}
					className="ch-input ch-input-codigo"
					type="text"
					autoComplete="off"
					autoCapitalize="characters"
					spellCheck="false"
					maxLength={40}
					placeholder={exemploDeCodigo}
					value={codigo}
					onChange={(e) => setCodigo(e.target.value)}
					disabled={enviando}
				/>
			</div>

			{erro && (
				<div className="ch-alert" role="alert">
					<AlertCircle size={17} aria-hidden="true" />
					<span>{erro}</span>
				</div>
			)}

			<button className="ch-btn ch-btn-ghost" type="submit" disabled={enviando}>
				{enviando ? (
					<>
						<Loader2 size={17} className="ch-spin" aria-hidden="true" />
						Consultando...
					</>
				) : (
					'Recuperar'
				)}
			</button>
		</form>
	);
}
