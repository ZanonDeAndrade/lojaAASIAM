import { formatBRL } from '../../shared/churrasco.js';

/**
 * A comanda: o resumo da inscrição no formato do papel que se recebe na
 * churrascaria. É o mesmo objeto em dois momentos — enquanto a pessoa escolhe
 * o curso (sem código) e depois de confirmada (com código e nome).
 *
 * `status` é o carimbo: uma palavra só, porque ele não quebra linha.
 */
export default function Comanda({
	curso,
	categoria,
	valorCents,
	nome,
	codigo,
	status = 'Pendente',
	pago = false,
}) {
	return (
		<div className="ch-comanda ch-reveal">
			<div className="ch-comanda-eyebrow">
				{codigo ? 'Comanda · inscrição confirmada' : 'Comanda · resumo'}
			</div>

			{nome && <div className="ch-comanda-nome">{nome}</div>}

			<div className="ch-comanda-curso">{curso}</div>
			<div className="ch-comanda-categoria">{categoria}</div>

			{codigo && (
				<>
					<div className="ch-comanda-tear" aria-hidden="true" />
					<div className="ch-comanda-valor-label">Código da inscrição</div>
					<div className="ch-comanda-codigo">{codigo}</div>
				</>
			)}

			<div className="ch-comanda-tear" aria-hidden="true" />

			<div className="ch-comanda-foot">
				<div>
					<span className="ch-comanda-valor-label">
						{pago ? 'Valor pago' : 'Valor da inscrição'}
					</span>
					<span className="ch-comanda-valor">{formatBRL(valorCents)}</span>
				</div>
				<span className={`ch-stamp${pago ? ' is-pago' : ''}`}>{status}</span>
			</div>
		</div>
	);
}
