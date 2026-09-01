import { AlertCircle, Check, Download, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Baixa o comprovante em PDF.
 *
 * O arquivo é montado pelo backend a partir da linha oficial da inscrição —
 * daqui vai só o token, no header. O PDF chega como Blob, vira uma URL local
 * por um instante e é revogado logo depois: nada do documento fica pendurado
 * no navegador, e o token nunca aparece em nenhuma URL.
 */

const MENSAGENS = {
	401: 'Não conseguimos identificar sua inscrição neste navegador.',
	403: 'Este código é de outra inscrição.',
	404: 'Não encontramos esta inscrição.',
	409: 'O pagamento ainda não foi confirmado. Assim que confirmar, o comprovante fica disponível.',
	410: 'Esta inscrição não está paga, então não há comprovante para emitir.',
	429: 'Muitos downloads seguidos. Aguarde um instante e tente de novo.',
};

const PADRAO = 'Não foi possível gerar o comprovante agora. Tente novamente em instantes.';

/** Usa o nome que o servidor mandou; se não vier, monta um a partir do código. */
function nomeDoArquivo(contentDisposition, orderId) {
	const achado = /filename="([^"]+)"/i.exec(contentDisposition || '');
	if (achado?.[1]) return achado[1];
	return `comprovante-churrasco-${String(orderId).replace(/[^A-Za-z0-9-]/g, '')}.pdf`;
}

export default function BotaoComprovante({ apiBase, orderId, token }) {
	const [estado, setEstado] = useState('pronto'); // pronto | gerando | baixado
	const [erro, setErro] = useState(null);
	const emAndamento = useRef(false);
	const timer = useRef(null);

	useEffect(() => () => clearTimeout(timer.current), []);

	async function baixar() {
		// Trava o duplo clique antes de qualquer await.
		if (emAndamento.current) return;
		emAndamento.current = true;
		setEstado('gerando');
		setErro(null);

		let url = null;
		try {
			const resposta = await fetch(
				`${apiBase}/api/churrasco/comprovantes/${encodeURIComponent(orderId)}/pdf`,
				{ headers: { 'X-Inscricao-Token': token } },
			);

			if (!resposta.ok) {
				const corpo = await resposta.json().catch(() => null);
				throw new Error(corpo?.error || MENSAGENS[resposta.status] || PADRAO);
			}

			const arquivo = nomeDoArquivo(resposta.headers.get('Content-Disposition'), orderId);
			const blob = await resposta.blob();

			url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = arquivo;
			link.rel = 'noopener';
			document.body.appendChild(link);
			link.click();
			link.remove();

			setEstado('baixado');
			clearTimeout(timer.current);
			timer.current = setTimeout(() => setEstado('pronto'), 2800);
		} catch (falha) {
			setErro(falha?.message || PADRAO);
			setEstado('pronto');
		} finally {
			// O Safari precisa que a URL sobreviva ao clique antes de sumir.
			if (url) setTimeout(() => URL.revokeObjectURL(url), 4000);
			emAndamento.current = false;
		}
	}

	const gerando = estado === 'gerando';

	return (
		<>
			<button
				className="ch-btn ch-btn-primary ch-btn-comprovante"
				type="button"
				onClick={baixar}
				disabled={gerando}
				aria-busy={gerando}
			>
				{gerando && (
					<>
						<Loader2 size={18} className="ch-spin" aria-hidden="true" />
						Gerando comprovante...
					</>
				)}
				{estado === 'baixado' && (
					<>
						<Check size={18} aria-hidden="true" />
						Comprovante baixado
					</>
				)}
				{estado === 'pronto' && (
					<>
						<Download size={18} aria-hidden="true" />
						Baixar comprovante em PDF
					</>
				)}
			</button>

			<span className="ch-sr-only" role="status">
				{gerando ? 'Gerando o comprovante em PDF.' : ''}
				{estado === 'baixado' ? 'Comprovante baixado.' : ''}
			</span>

			{erro && (
				<div className="ch-alert" role="alert">
					<AlertCircle size={17} aria-hidden="true" />
					<span>{erro}</span>
				</div>
			)}
		</>
	);
}
