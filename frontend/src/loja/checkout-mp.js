/**
 * Ponte com o MercadoPago.js V2 — carrega o SDK oficial sob demanda e tokeniza
 * o cartão pelos Secure Fields (iframes hospedados pelo Mercado Pago).
 *
 * O número do cartão e o CVV NUNCA passam pelo nosso JavaScript nem pelo nosso
 * backend: os campos são iframes do Mercado Pago e o que sai daqui é só o
 * `token` opaco. A Public Key é pública por definição — vem de /api/loja/config.
 */

const SDK_URL = 'https://sdk.mercadopago.com/js/v2';

let sdkPromise = null;

/** Carrega o script do SDK uma única vez. */
export function loadMercadoPagoSdk() {
	if (typeof window !== 'undefined' && window.MercadoPago) {
		return Promise.resolve(window.MercadoPago);
	}
	if (sdkPromise) return sdkPromise;

	sdkPromise = new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = SDK_URL;
		script.async = true;
		script.onload = () => {
			if (window.MercadoPago) resolve(window.MercadoPago);
			else reject(new Error('SDK do Mercado Pago carregou sem MercadoPago global.'));
		};
		script.onerror = () => {
			sdkPromise = null;
			reject(new Error('Não foi possível carregar o Mercado Pago. Verifique sua conexão.'));
		};
		document.head.appendChild(script);
	});
	return sdkPromise;
}

/**
 * Monta os três Secure Fields dentro dos contêineres informados e devolve um
 * controlador com `createToken`, `getPaymentMethodId` e `destroy`.
 *
 * @param {string} publicKey
 * @param {{ number:string, expiration:string, security:string }} containers - ids dos <div>
 */
export async function montarCamposCartao(publicKey, containers) {
	const MercadoPago = await loadMercadoPagoSdk();
	const mp = new MercadoPago(publicKey, { locale: 'pt-BR' });

	const estiloBase = {
		color: 'inherit',
		'font-size': '15px',
		'font-family': 'inherit',
		placeholderColor: '#8a9a90',
	};

	const numberField = mp.fields
		.create('cardNumber', { placeholder: '0000 0000 0000 0000', style: estiloBase })
		.mount(containers.number);
	const expirationField = mp.fields
		.create('expirationDate', { placeholder: 'MM/AA', style: estiloBase })
		.mount(containers.expiration);
	const securityField = mp.fields
		.create('securityCode', { placeholder: 'CVV', style: estiloBase })
		.mount(containers.security);

	let paymentMethodId = null;
	let onMetodo = null;

	numberField.on('binChange', async (data) => {
		const bin = data?.bin;
		if (!bin) {
			paymentMethodId = null;
			onMetodo?.(null);
			return;
		}
		try {
			const { results } = await mp.getPaymentMethods({ bin });
			paymentMethodId = results?.[0]?.id || null;
		} catch {
			paymentMethodId = null;
		}
		onMetodo?.(paymentMethodId);
	});

	return {
		/** Registra um callback para saber a bandeira assim que o BIN é digitado. */
		aoDetectarMetodo(cb) {
			onMetodo = cb;
		},
		getPaymentMethodId() {
			return paymentMethodId;
		},
		/**
		 * Gera o token do cartão. Lança um Error com mensagem amigável se os
		 * dados estiverem incompletos ou inválidos.
		 */
		async createToken({ cardholderName, identificationType, identificationNumber }) {
			try {
				const { id } = await mp.fields.createCardToken({
					cardholderName,
					identificationType,
					identificationNumber,
				});
				if (!id) throw new Error('sem id');
				return id;
			} catch (err) {
				const causa = Array.isArray(err?.cause) ? err.cause[0]?.description : null;
				throw new Error(
					causa
						? 'Confira os dados do cartão e tente novamente.'
						: 'Não foi possível validar o cartão. Confira os dados e tente novamente.'
				);
			}
		},
		destroy() {
			for (const campo of [numberField, expirationField, securityField]) {
				try {
					campo.unmount();
				} catch {
					/* já desmontado */
				}
			}
		},
	};
}
