/**
 * O que cada página de churrasco precisa além das regras compartilhadas
 * (`shared/churrasco-eventos.js`): textos, arte e a chave do armazenamento.
 *
 * O Churrasco da Alcateia (AMF Games) continua com os textos e a chave de
 * sempre — a página dele não muda.
 */
import { CHURRASCO_EVENTO } from './config.js';
import { CHAVE_PADRAO } from './armazenamento.js';
import {
	EVENTOS_CHURRASCO,
	EVENTO_AMF,
	EVENTO_SEMANA_SI,
} from '../shared/churrasco-eventos.js';

export const PAGINAS_CHURRASCO = {
	[EVENTO_AMF]: {
		...EVENTOS_CHURRASCO[EVENTO_AMF],
		tituloDaAba: `${CHURRASCO_EVENTO.titulo} | AASIAM`,
		chaveArmazenamento: CHAVE_PADRAO,
		dicaDoFormulario:
			'Quatro campos e pronto. O valor vem do seu curso e o pagamento é por Pix, aqui mesmo nesta página.',
		banner: null,
	},

	[EVENTO_SEMANA_SI]: {
		...EVENTOS_CHURRASCO[EVENTO_SEMANA_SI],
		tituloDaAba: 'Churrasco da AASIAM — Semana Acadêmica de SI | AASIAM',
		chaveArmazenamento: 'aasiam-churrasco-semana-si-pedido',
		dicaDoFormulario:
			'Quatro campos e pronto. R$ 20,00 por pessoa, pago por Pix aqui mesmo nesta página.',
		banner: {
			src: '/imgs/banner-churrasco-semana-academica.png',
			webp: '/imgs/banner-churrasco-semana-academica.webp',
			largura: 2172,
			altura: 724,
			alt:
				'Churrasco da AASIAM na Semana Acadêmica de Sistemas de Informação, 24/10 ao meio-dia: ' +
				'três lobos verdes da atlética, com o emblema SI no peito, assando carne, salsichão e ' +
				'frango numa churrasqueira ao ar livre.',
		},
	},
};

export function paginaDoEvento(eventoId) {
	return PAGINAS_CHURRASCO[eventoId] || PAGINAS_CHURRASCO[EVENTO_AMF];
}
