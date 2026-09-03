import {
	AlertCircle,
	CheckCircle2,
	ChevronRight,
	Copy,
	CreditCard,
	Loader2,
	Lock,
	QrCode,
	ShoppingCart,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PRODUCTS } from '../shared/products.js';
import { createEmptySelection } from '../shared/order.js';
import { montarCamposCartao } from './checkout-mp.js';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (cents) => currency.format((Number(cents) || 0) / 100);

/* O carrinho (estado do App) → o formato `selection` que o backend recalcula.
   Espelha `cartToSelection` do App.jsx: o backend é a autoridade dos preços. */
function cartToSelection(cart) {
	const sel = createEmptySelection();
	for (const item of cart) {
		const { productId, _sel, qty } = item;
		const product = PRODUCTS.find((p) => p.id === productId);
		if (!product) continue;
		if (product.kind === 'sizedVariants') {
			const v = product.variants[0];
			sel[productId].variants[v.code][_sel.size] =
				(sel[productId].variants[v.code][_sel.size] || 0) + qty;
		} else if (product.kind === 'sizedProduct') {
			sel[productId].size = _sel.size;
			sel[productId].quantity = (sel[productId].quantity || 0) + qty;
		} else if (product.kind === 'twoPieceSet') {
			sel[productId].combinations[_sel.shirtSize][_sel.shortsSize] += qty;
		} else if (product.kind === 'doubleHoodie') {
			sel[productId].verdeSize = _sel.verde;
			sel[productId].begeSize = _sel.bege;
			sel[productId].quantity = (sel[productId].quantity || 0) + qty;
		} else if (product.kind === 'modelQuantity') {
			sel[productId].models[_sel.model] = (sel[productId].models[_sel.model] || 0) + qty;
		} else if (product.kind === 'configuredBundle') {
			sel[productId].hoodieVariant = _sel.variant;
			sel[productId].hoodieSize = _sel.size;
			if (_sel.backpack) sel[productId].backpackModel = _sel.backpack;
			sel[productId].quantity = (sel[productId].quantity || 0) + qty;
		} else {
			sel[productId].quantity = (sel[productId].quantity || 0) + qty;
		}
	}
	return sel;
}

const CAMPOS = ['number', 'expiration', 'security'];
const novoAttemptId = () =>
	(window.crypto?.randomUUID?.() || `a-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function CheckoutMercadoPago({ cart, appliedCupom, onBack, onDone }) {
	const [config, setConfig] = useState(null);
	const [configErro, setConfigErro] = useState('');

	const [metodo, setMetodo] = useState('cartao'); // 'cartao' | 'pix'
	const [parcelas, setParcelas] = useState(1);

	const [form, setForm] = useState({
		nome: '',
		sobrenome: '',
		email: '',
		telefone: '',
		docTipo: 'CPF',
		docNumero: '',
		titular: '',
	});

	const [quote, setQuote] = useState(null);
	const [quoteCarregando, setQuoteCarregando] = useState(false);

	const [enviando, setEnviando] = useState(false);
	const [erro, setErro] = useState('');
	const [resultado, setResultado] = useState(null); // resposta de /checkout ou /status

	const cartaoRef = useRef(null);
	const [cartaoPronto, setCartaoPronto] = useState(false);
	const attemptRef = useRef(novoAttemptId());

	const selection = useMemo(() => cartToSelection(cart), [cart]);
	const cupom = appliedCupom?.codigo || '';

	/* ── Configuração pública ── */
	useEffect(() => {
		let vivo = true;
		fetch(`${API_BASE}/api/loja/config`)
			.then((r) => r.json())
			.then((data) => {
				if (!vivo) return;
				if (!data?.pagamentoDisponivel || !data.publicKey) {
					setConfigErro('O pagamento está indisponível no momento. Tente novamente mais tarde.');
					return;
				}
				setConfig(data);
			})
			.catch(() => vivo && setConfigErro('Não foi possível iniciar o pagamento. Verifique sua conexão.'));
		return () => {
			vivo = false;
		};
	}, []);

	/* ── Secure Fields do cartão ── */
	useEffect(() => {
		if (!config || metodo !== 'cartao' || resultado) return undefined;

		let vivo = true;
		setCartaoPronto(false);
		montarCamposCartao(config.publicKey, {
			number: 'mp-card-number',
			expiration: 'mp-card-expiration',
			security: 'mp-card-security',
		})
			.then((controlador) => {
				if (!vivo) {
					controlador.destroy();
					return;
				}
				cartaoRef.current = controlador;
				setCartaoPronto(true);
			})
			.catch((err) => vivo && setErro(err.message));

		return () => {
			vivo = false;
			cartaoRef.current?.destroy();
			cartaoRef.current = null;
		};
	}, [config, metodo, resultado]);

	/* ── Simulação: sempre que método ou parcelas mudam ── */
	const simular = useCallback(async () => {
		setQuoteCarregando(true);
		try {
			const res = await fetch(`${API_BASE}/api/loja/checkout/quote`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					selection,
					cupom,
					paymentMethod: metodo === 'pix' ? 'pix' : 'credit_card',
					installments: parcelas,
				}),
			});
			const data = await res.json();
			if (res.ok && data.ok) {
				setQuote(data);
				setErro('');
			} else {
				setErro(data.error || 'Não foi possível calcular o valor do pagamento.');
			}
		} catch {
			setErro('Não foi possível calcular o valor do pagamento.');
		} finally {
			setQuoteCarregando(false);
		}
	}, [selection, cupom, metodo, parcelas]);

	useEffect(() => {
		if (!config || resultado) return;
		simular();
	}, [config, resultado, simular]);

	/* ── Polling do Pix ── */
	useEffect(() => {
		if (!resultado || resultado.paymentMethod !== 'pix' || resultado.final) return undefined;
		const token = resultado.token;
		const orderId = resultado.orderId;
		let vivo = true;
		const timer = setInterval(async () => {
			try {
				const res = await fetch(
					`${API_BASE}/api/loja/pedidos/${encodeURIComponent(orderId)}/status`,
					{ headers: { 'X-Pedido-Token': token } },
				);
				const data = await res.json();
				if (vivo && res.ok && data.ok) {
					setResultado((r) => ({ ...data, token: r.token }));
				}
			} catch {
				/* tenta de novo no próximo ciclo */
			}
		}, 6000);
		return () => {
			vivo = false;
			clearInterval(timer);
		};
	}, [resultado]);

	const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

	const cartaoOpcoes = quote?.opcoes || config?.parcelasCartao?.map((n) => ({ installments: n })) || [];
	const ativo = metodo === 'pix' ? quote?.pix : quote?.cartao;

	const contatoValido =
		form.nome.trim() &&
		form.sobrenome.trim() &&
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) &&
		form.telefone.replace(/\D/g, '').length >= 10;
	const cartaoValido =
		metodo !== 'cartao' ||
		(cartaoPronto && form.titular.trim() && form.docNumero.replace(/\D/g, '').length >= 11);
	const podePagar = Boolean(config) && contatoValido && cartaoValido && ativo && !enviando;

	async function pagar() {
		if (!podePagar) return;
		setEnviando(true);
		setErro('');
		try {
			const corpo = {
				attemptId: attemptRef.current,
				customer: {
					name: `${form.nome} ${form.sobrenome}`.trim(),
					email: form.email.trim(),
					phone: form.telefone.trim(),
				},
				selection,
				cupom,
				paymentMethod: metodo === 'pix' ? 'pix' : 'credit_card',
			};

			if (metodo === 'cartao') {
				const paymentMethodId = cartaoRef.current?.getPaymentMethodId();
				if (!paymentMethodId) {
					throw new Error('Não reconhecemos a bandeira do cartão. Confira o número.');
				}
				const token = await cartaoRef.current.createToken({
					cardholderName: form.titular.trim(),
					identificationType: form.docTipo,
					identificationNumber: form.docNumero.replace(/\D/g, ''),
				});
				corpo.cardToken = token;
				corpo.paymentMethodId = paymentMethodId;
				corpo.installments = parcelas;
			}

			const res = await fetch(`${API_BASE}/api/loja/checkout`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(corpo),
			});
			const data = await res.json();
			if (!res.ok || !data.ok) {
				throw new Error(data.error || 'Não foi possível concluir o pagamento.');
			}
			setResultado(data);
		} catch (err) {
			setErro(err.message || 'Não foi possível concluir o pagamento.');
		} finally {
			setEnviando(false);
		}
	}

	function tentarDeNovo() {
		attemptRef.current = novoAttemptId();
		setResultado(null);
		setErro('');
	}

	/* ── Telas de resultado ── */
	if (resultado) {
		return (
			<ResultadoPagamento
				resultado={resultado}
				onTentarDeNovo={tentarDeNovo}
				onVoltarLoja={onDone}
			/>
		);
	}

	if (configErro) {
		return (
			<div className="page content-pad">
				<div className="panel confirm-panel">
					<div className="confirm-icon pc-error-icon">
						<AlertCircle size={32} />
					</div>
					<h1>Pagamento indisponível</h1>
					<p style={{ color: 'var(--text-dim)' }}>{configErro}</p>
					<div className="confirm-actions">
						<button type="button" className="btn btn-primary btn-sm" onClick={onBack}>
							Voltar ao carrinho
						</button>
					</div>
				</div>
			</div>
		);
	}

	const CRUMBS = ['Carrinho', 'Informações', 'Pagamento', 'Confirmação'];

	return (
		<div className="page content-pad">
			<nav className="breadcrumb" aria-label="Etapas">
				{CRUMBS.map((s, i) => (
					<span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
						{i > 0 && <ChevronRight size={13} style={{ opacity: 0.4 }} />}
						<span className={i === 2 ? 'crumb-active' : ''}>{s}</span>
					</span>
				))}
			</nav>

			<div className="checkout-grid">
				<section className="panel form-panel">
					<h2>Informações de contato</h2>
					<div className="form-stack">
						<div className="row-2">
							<input
								className="input"
								placeholder="Nome"
								value={form.nome}
								onChange={(e) => set('nome', e.target.value)}
								autoComplete="given-name"
							/>
							<input
								className="input"
								placeholder="Sobrenome"
								value={form.sobrenome}
								onChange={(e) => set('sobrenome', e.target.value)}
								autoComplete="family-name"
							/>
						</div>
						<input
							className="input"
							placeholder="E-mail"
							value={form.email}
							onChange={(e) => set('email', e.target.value)}
							inputMode="email"
							autoComplete="email"
						/>
						<input
							className="input"
							placeholder="Telefone"
							value={form.telefone}
							onChange={(e) => set('telefone', e.target.value)}
							inputMode="tel"
							autoComplete="tel"
						/>
					</div>
				</section>

				<section className="panel form-panel">
					<h2>Pagamento</h2>

					<div className="mp-metodos" role="tablist" aria-label="Forma de pagamento">
						<button
							type="button"
							role="tab"
							aria-selected={metodo === 'cartao'}
							className={`mp-metodo${metodo === 'cartao' ? ' is-ativo' : ''}`}
							onClick={() => setMetodo('cartao')}
						>
							<CreditCard size={16} /> Cartão de crédito
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={metodo === 'pix'}
							className={`mp-metodo${metodo === 'pix' ? ' is-ativo' : ''}`}
							onClick={() => setMetodo('pix')}
						>
							<QrCode size={16} /> Pix
						</button>
					</div>

					{metodo === 'cartao' && (
						<div className="mp-cartao">
							<label className="mp-label">
								Número do cartão
								<div id="mp-card-number" className="mp-field" />
							</label>
							<div className="row-2">
								<label className="mp-label">
									Validade
									<div id="mp-card-expiration" className="mp-field" />
								</label>
								<label className="mp-label">
									Código de segurança
									<div id="mp-card-security" className="mp-field" />
								</label>
							</div>
							<input
								className="input"
								placeholder="Nome impresso no cartão"
								value={form.titular}
								onChange={(e) => set('titular', e.target.value)}
								autoComplete="cc-name"
							/>
							<div className="row-2">
								<select
									className="input"
									value={form.docTipo}
									onChange={(e) => set('docTipo', e.target.value)}
									aria-label="Tipo de documento"
								>
									<option value="CPF">CPF</option>
									<option value="CNPJ">CNPJ</option>
								</select>
								<input
									className="input"
									placeholder="Número do documento"
									value={form.docNumero}
									onChange={(e) => set('docNumero', e.target.value)}
									inputMode="numeric"
								/>
							</div>

							<label className="mp-label" style={{ marginTop: 4 }}>
								Parcelas
								<select
									className="input"
									value={parcelas}
									onChange={(e) => setParcelas(Number(e.target.value))}
								>
									{cartaoOpcoes.map((opcao) => (
										<option key={opcao.installments} value={opcao.installments}>
											{opcao.installments}x
											{opcao.installmentCents
												? ` de ${fmt(opcao.installmentCents)}`
												: ''}
											{opcao.totalCents ? ` — ${fmt(opcao.totalCents)}` : ''}
										</option>
									))}
								</select>
							</label>
						</div>
					)}

					{metodo === 'pix' && (
						<p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', lineHeight: 1.6 }}>
							Ao continuar, geramos um QR Code Pix aqui mesmo. A confirmação é
							automática assim que o pagamento cai.
						</p>
					)}

					<div className="mp-resumo-pagamento">
						<Linha rotulo="Subtotal dos produtos" valor={fmt(quote?.subtotalCents)} />
						<Linha
							rotulo="Pagamento"
							valor={metodo === 'pix' ? 'Pix' : 'Cartão de crédito'}
						/>
						{metodo === 'cartao' && <Linha rotulo="Parcelas" valor={`${parcelas}x`} />}
						<Linha
							rotulo="Acréscimo do pagamento"
							valor={quoteCarregando ? '—' : fmt(ativo?.paymentFeeCents)}
						/>
						<div className="mp-resumo-total">
							<span>Total</span>
							<strong>{quoteCarregando ? '—' : fmt(ativo?.totalCents)}</strong>
						</div>
						{metodo === 'cartao' && ativo?.installmentCents && (
							<p className="mp-resumo-parcela">
								{parcelas}x de {fmt(ativo.installmentCents)}
								{parcelas > 1 ? ' sem juros da Atlética (taxa do cartão já inclusa)' : ''}
							</p>
						)}
					</div>

					<div className="pay-badges" style={{ margin: '14px 0' }}>
						<span>
							<Lock size={12} /> Pagamento seguro
						</span>
						<span>Mercado Pago</span>
					</div>

					{erro && (
						<div className="messages" role="alert">
							<span>{erro}</span>
						</div>
					)}

					<button
						type="button"
						className="btn btn-primary btn-block"
						onClick={pagar}
						disabled={!podePagar}
					>
						{enviando ? (
							<>
								<Loader2 size={16} className="pc-spin" /> Processando…
							</>
						) : (
							<>
								Pagar {ativo?.totalCents ? fmt(ativo.totalCents) : ''}
							</>
						)}
					</button>
					<button type="button" className="btn btn-ghost btn-block" onClick={onBack}>
						Voltar ao carrinho
					</button>
				</section>

				<aside className="panel summary checkout-summary">
					<h2>Resumo</h2>
					<div className="summary-mini">
						{cart.map((item) => (
							<div className="summary-mini-item" key={item.key}>
								<div className="summary-mini-info">
									<div className="nm">{item.name}</div>
									{item.meta && <div className="px">{item.meta}</div>}
								</div>
								<span className="summary-mini-qty">x{item.qty}</span>
							</div>
						))}
					</div>
					<div className="summary-divider" />
					<div className="summary-total">
						<span className="lbl">Total</span>
						<span className="val">{quoteCarregando ? '—' : fmt(ativo?.totalCents)}</span>
					</div>
				</aside>
			</div>
		</div>
	);
}

function Linha({ rotulo, valor }) {
	return (
		<div className="mp-resumo-linha">
			<span>{rotulo}</span>
			<span>{valor}</span>
		</div>
	);
}

/* ── Resultado ── */
function ResultadoPagamento({ resultado, onTentarDeNovo, onVoltarLoja }) {
	const { status, paymentMethod, pix } = resultado;

	if (status === 'pago') {
		return (
			<div className="page content-pad">
				<div className="panel confirm-panel">
					<div className="confirm-icon">
						<CheckCircle2 size={32} />
					</div>
					<span className="confirm-eyebrow">Pedido #{resultado.orderId}</span>
					<h1>Pagamento confirmado!</h1>
					<p style={{ color: 'var(--text-dim)' }}>
						Seu pedido foi registrado. Entraremos em contato assim que os itens
						estiverem prontos para entrega.
					</p>
					<div className="pc-summary-box">
						<div className="pc-summary-row">
							<span>Forma de pagamento</span>
							<strong>
								{paymentMethod === 'pix' ? 'Pix' : `Cartão · ${resultado.installments}x`}
							</strong>
						</div>
						<div className="pc-summary-row">
							<span>Produtos</span>
							<strong>{resultado.subtotal}</strong>
						</div>
						<div className="pc-summary-row">
							<span>Acréscimo do pagamento</span>
							<strong>{resultado.paymentFee}</strong>
						</div>
						<div className="pc-summary-divider" />
						<div className="pc-summary-row pc-summary-total">
							<span>Total pago</span>
							<strong>{resultado.total}</strong>
						</div>
					</div>
					<div className="confirm-actions">
						<button type="button" className="btn btn-primary btn-sm" onClick={onVoltarLoja}>
							<ShoppingCart size={15} /> Voltar para a loja
						</button>
					</div>
				</div>
			</div>
		);
	}

	if (paymentMethod === 'pix' && (status === 'pendente' || status === 'processando')) {
		return (
			<div className="page content-pad">
				<div className="panel confirm-panel">
					<span className="confirm-eyebrow">Pedido #{resultado.orderId}</span>
					<h1>Pague {resultado.total} por Pix</h1>
					<p style={{ color: 'var(--text-dim)', margin: '0 0 8px' }}>
						Abra o app do banco, escolha Pix e escaneie o código. Esta página
						confirma sozinha.
					</p>
					{pix?.qrCodeBase64 && (
						<img
							className="pix-image"
							src={`data:image/png;base64,${pix.qrCodeBase64}`}
							alt="QR Code Pix"
						/>
					)}
					{pix?.qrCode && (
						<div className="pix-copy" style={{ maxWidth: 460 }}>
							<textarea value={pix.qrCode} readOnly aria-label="Código Pix" />
							<button
								type="button"
								className="btn btn-ghost btn-sm"
								onClick={() => navigator.clipboard?.writeText(pix.qrCode)}
							>
								<Copy size={14} /> Copiar código Pix
							</button>
						</div>
					)}
					<p className="mp-resumo-parcela" role="status">
						<Loader2 size={13} className="pc-spin" /> Aguardando pagamento…
					</p>
				</div>
			</div>
		);
	}

	// falhou / cancelado / revisão / erro
	const revisao = status === 'revisao_manual';
	return (
		<div className="page content-pad">
			<div className="panel confirm-panel">
				<div className="confirm-icon pc-error-icon">
					<AlertCircle size={32} />
				</div>
				<h1>{revisao ? 'Pagamento em análise' : 'Pagamento não concluído'}</h1>
				<p style={{ color: 'var(--text-dim)', margin: '0 0 16px' }}>
					{revisao
						? 'Estamos conferindo seu pagamento manualmente. Guarde o número do pedido.'
						: 'Nada foi cobrado. Você pode tentar outra forma de pagamento ou outro cartão.'}
				</p>
				<div className="pc-order-ref">
					<span>Número do pedido</span>
					<strong>{resultado.orderId}</strong>
				</div>
				<div className="confirm-actions">
					{!revisao && (
						<button type="button" className="btn btn-primary btn-sm" onClick={onTentarDeNovo}>
							Tentar de novo
						</button>
					)}
					<button type="button" className="btn btn-ghost btn-sm" onClick={onVoltarLoja}>
						Voltar para a loja
					</button>
				</div>
			</div>
		</div>
	);
}
