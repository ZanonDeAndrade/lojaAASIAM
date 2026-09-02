import { CHURRASCO_EVENTO, LOBO_IMAGE, detalhesPreenchidos } from '../config.js';
import {
	PRICE_OTHER_CENTS,
	PRICE_SI_CENTS,
	SI_COURSE,
	formatBRL,
} from '../../shared/churrasco.js';

/**
 * Coluna de apresentação. O mascote é o elemento principal da página: recortado
 * do fundo original, ele fica direto sobre o preto, com a churrasqueira apoiada
 * na base da seção. A regra de valores vem antes dele, compacta, para não
 * disputar atenção.
 */
export default function EventoApresentacao() {
	const detalhes = detalhesPreenchidos();

	return (
		<section className="ch-apresentacao" aria-labelledby="ch-titulo">
			<h1 className="ch-title" id="ch-titulo">
				Churrasco <span>da Alcateia</span>
			</h1>

			<p className="ch-subtitle">{CHURRASCO_EVENTO.subtitulo}</p>

			{/* Duas faixas porque o valor é uma condição (que curso você faz),
			    não uma sequência de etapas. */}
			<div className="ch-valores">
				<p className="ch-valores-label" id="ch-valores-label">
					Valor da inscrição
				</p>
				<div className="ch-valores-linha" role="group" aria-labelledby="ch-valores-label">
					<div className="ch-tier ch-tier-si">
						<span className="ch-tier-label">{SI_COURSE}</span>
						<span className="ch-tier-price">{formatBRL(PRICE_SI_CENTS)}</span>
					</div>
					<div className="ch-tier">
						<span className="ch-tier-label">Demais participantes</span>
						<span className="ch-tier-price">{formatBRL(PRICE_OTHER_CENTS)}</span>
					</div>
				</div>
			</div>

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

			<div className="ch-lobo">
				<picture>
					<source srcSet={LOBO_IMAGE.webp} type="image/webp" />
					<img
						src={LOBO_IMAGE.fallback}
						alt={LOBO_IMAGE.alt}
						width={LOBO_IMAGE.width}
						height={LOBO_IMAGE.height}
						fetchpriority="high"
						decoding="async"
					/>
				</picture>
			</div>
		</section>
	);
}
