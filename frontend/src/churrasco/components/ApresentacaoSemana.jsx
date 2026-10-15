import { formatBRL } from '../../shared/churrasco.js';

/**
 * Coluna de apresentação do Churrasco da AASIAM na Semana Acadêmica.
 *
 * Mesma linguagem da página do AMF — título em caixa alta, faixas de valor,
 * detalhes em lista —, com o que este evento tem de diferente: um preço só,
 * o cardápio à vontade e o prazo das inscrições. A arte fica no banner, acima
 * desta coluna, então aqui não há mascote.
 */
export default function ApresentacaoSemana({ evento, fechado }) {
	// "Churrasco da AASIAM" → "Churrasco" + "da AASIAM", como o título do AMF.
	const [primeira, ...resto] = evento.titulo.split(' ');

	const detalhes = [
		{ chave: 'data', rotulo: 'Data', valor: evento.data },
		{ chave: 'horario', rotulo: 'Horário', valor: evento.horario },
		{ chave: 'local', rotulo: 'Local', valor: evento.local },
	].filter((item) => Boolean(item.valor));

	return (
		<section className="ch-apresentacao" aria-labelledby="ch-titulo">
			{evento.subtitulo && <p className="ch-eyebrow">{evento.subtitulo}</p>}

			<h1 className="ch-title" id="ch-titulo">
				{primeira} <span>{resto.join(' ')}</span>
			</h1>

			<p className="ch-subtitle">
				Garanta seu lugar no churrasco da Semana Acadêmica de Sistemas de Informação.
			</p>

			<div className="ch-valores">
				<p className="ch-valores-label" id="ch-valores-label">
					Valor da inscrição
				</p>
				<div className="ch-valores-linha" role="group" aria-labelledby="ch-valores-label">
					<div className="ch-tier ch-tier-si">
						<span className="ch-tier-label">Por pessoa</span>
						<span className="ch-tier-price">{formatBRL(evento.precoCents)}</span>
					</div>
					{evento.inscricoesAteTexto && (
						<div className="ch-tier">
							<span className="ch-tier-label">Inscrições</span>
							<span className="ch-tier-price ch-tier-prazo">
								{fechado ? 'Encerradas' : `Até ${evento.inscricoesAteTexto}`}
							</span>
						</div>
					)}
				</div>
			</div>

			{evento.cardapio?.length > 0 && (
				<div className="ch-cardapio">
					<p className="ch-valores-label" id="ch-cardapio-label">
						Cardápio à vontade
					</p>
					<ul className="ch-cardapio-lista" aria-labelledby="ch-cardapio-label">
						{evento.cardapio.map((item) => (
							<li className="ch-cardapio-item" key={item}>
								{item}
							</li>
						))}
					</ul>
				</div>
			)}

			{detalhes.length > 0 && (
				<dl className="ch-detalhes">
					{detalhes.map((item) => (
						<div className="ch-detalhe" key={item.chave}>
							<dt>{item.rotulo}</dt>
							<dd>{item.valor}</dd>
						</div>
					))}
				</dl>
			)}
		</section>
	);
}
