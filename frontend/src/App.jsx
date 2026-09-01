import {
	AlertCircle,
	ArrowLeft,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Copy,
	CreditCard,
	ExternalLink,
	Loader2,
	Lock,
	Minus,
	Moon,
	PackageCheck,
	Plus,
	QrCode,
	Ruler,
	Share2,
	ShoppingBag,
	ShoppingCart,
	Sun,
	X,
	Zap,
} from 'lucide-react';
import gsap from 'gsap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PRODUCTS } from './shared/products.js';
import { createEmptySelection } from './shared/order.js';
import ChurrascoPage from './churrasco/ChurrascoPage.jsx';

/* ─── constants ─── */
const currency = new Intl.NumberFormat('pt-BR', {
	style: 'currency',
	currency: 'BRL',
});
const fmt = cents => currency.format(cents / 100);

// Em dev o Vite proxy redireciona /api → localhost:3333.
// Em produção (Vercel) VITE_API_URL aponta para o backend no Render.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const BANNER_SLIDES = [
	{ src: '/imgs/anuncio.png', alt: 'AASIAM – Nova Coleção' },
	{ src: '/imgs/combo-alcateia.png', alt: 'Combo Alcateia' },
	{ src: '/imgs/combo-alpha.png', alt: 'Combo Alpha' },
	{ src: '/imgs/combo-essencial.png', alt: 'Combo Essencial' },
];

const CATEGORIES = [
	{ id: 'moletom', label: 'Moletons' },
	{ id: 'camiseta', label: 'Camisetas' },
	{ id: 'acessorios', label: 'Acessórios' },
	{ id: 'kits', label: 'Combos' },
];

const CATEGORY_MAP = {
	'moletom-verde': 'moletom',
	'moletom-bege': 'moletom',
	'camiseta-aasiam': 'camiseta',
	'camiseta-goleiro-aasiam': 'camiseta',
	'kit-2-moletons': 'kits',
	'kit-moletom-caneca': 'kits',
	'kit-completo': 'kits',
	caneca: 'acessorios',
	'mochila-listras': 'acessorios',
	'mochila-estampa': 'acessorios',
	manta: 'acessorios',
};

// Ordem de renderização do catálogo (categorias × produtos) → prioridade de imagem.
// Posições 1–4: alta (eager/high) · 5–8: média (lazy/auto) · 9+: baixa (lazy/low).
const CATALOG_ORDER = CATEGORIES.flatMap(cat =>
	PRODUCTS.filter(p => CATEGORY_MAP[p.id] === cat.id).map(p => p.id),
);
const IMG_PRIORITY_BY_ID = Object.fromEntries(
	CATALOG_ORDER.map((id, i) => [id, i < 4 ? 'high' : i < 8 ? 'auto' : 'low']),
);

const MATERIAL_MAP = {
	moletom: '50% Algodão, 50% Poliéster. Conforto premium para treino e lazer.',
	kits: 'Itens da atlética reunidos com desconto de combo.',
	acessorios: 'Item oficial da atlética com identidade AASIAM.',
};

/* ─── helpers ─── */
function normalizeQty(v) {
	const q = Number.parseInt(v, 10);
	return !Number.isFinite(q) || q < 0 ? 0 : Math.min(q, 99);
}

function cartTotals(cart, cupomAplicado = false) {
	const subtotal = cart.reduce((t, i) => t + i.unitCents * i.qty, 0);
	if (!cupomAplicado) return { subtotal, total: subtotal, discount: 0 };
	const totalComDesconto = cart.reduce((t, i) => {
		const product = PRODUCTS.find(p => p.id === i.productId);
		const custo = product?.costCents ?? i.unitCents;
		return t + custo * i.qty;
	}, 0);
	return {
		subtotal,
		total: totalComDesconto,
		discount: subtotal - totalComDesconto,
	};
}

function cartToSelection(cart) {
	const sel = createEmptySelection();
	for (const item of cart) {
		const { productId, _sel, qty } = item;
		const product = PRODUCTS.find(p => p.id === productId);
		if (!product) continue;

		if (product.kind === 'sizedVariants') {
			const v = product.variants[0];
			sel[productId].variants[v.code][_sel.size] =
				(sel[productId].variants[v.code][_sel.size] || 0) + qty;
		} else if (product.kind === 'doubleHoodie') {
			sel[productId].verdeSize = _sel.verde;
			sel[productId].begeSize = _sel.bege;
			sel[productId].quantity = (sel[productId].quantity || 0) + qty;
		} else if (product.kind === 'modelQuantity') {
			sel[productId].models[_sel.model] =
				(sel[productId].models[_sel.model] || 0) + qty;
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

function buildCartItem(product, sel) {
	const base = {
		productId: product.id,
		name: product.name,
		image: product.images?.[0] || null,
		unitCents: product.priceCents,
		qty: 1,
		_sel: sel,
	};
	if (product.kind === 'sizedVariants') {
		return {
			...base,
			key: `${product.id}-${sel.size}`,
			meta: `Tamanho: ${sel.size}`,
		};
	}
	if (product.kind === 'doubleHoodie') {
		return {
			...base,
			key: `${product.id}-${sel.verde}-${sel.bege}`,
			meta: `Verde ${sel.verde} · Off-white ${sel.bege}`,
		};
	}
	if (product.kind === 'modelQuantity') {
		const mName =
			product.models?.find(m => m.code === sel.model)?.name || sel.model;
		return {
			...base,
			key: `${product.id}-${sel.model}`,
			meta: `Modelo: ${mName}`,
		};
	}
	if (product.kind === 'configuredBundle') {
		const vName =
			product.variants?.find(v => v.code === sel.variant)?.name || sel.variant;
		const parts = [
			`${vName} ${sel.size}`,
			product.hasBackpack && `Mochila ${sel.backpack}`,
		].filter(Boolean);
		return {
			...base,
			key: `${product.id}-${sel.variant}-${sel.size}`,
			meta: parts.join(' · '),
		};
	}
	return { ...base, key: product.id, meta: null };
}

function getStatusCopy(status) {
	const map = {
		approved: {
			title: 'Pagamento aprovado!',
			desc: 'Pedido registrado e pagamento confirmado.',
		},
		pending: {
			title: 'Aguardando pagamento',
			desc: 'Conclua o pagamento pelo QR Code Pix.',
		},
		in_process: {
			title: 'Pagamento em análise',
			desc: 'O Mercado Pago está processando.',
		},
		rejected: {
			title: 'Pagamento recusado',
			desc: 'Tente outra forma de pagamento.',
		},
		simulated: {
			title: 'Pedido registrado',
			desc: 'Modo de teste. Configure as credenciais para pagamentos reais.',
		},
	};
	return (
		map[status] || {
			title: 'Pedido registrado',
			desc: 'Acompanhe a confirmação pela planilha.',
		}
	);
}

/* ─── fly-to-cart animation ─── */
function flyToCart(sourceImg) {
	const cartBtn = document.querySelector('.cart-btn');
	if (!cartBtn || !sourceImg) return;
	const fr = sourceImg.getBoundingClientRect();
	const to = cartBtn.getBoundingClientRect();
	const size = Math.min(fr.width, fr.height, 64);
	const el = document.createElement('div');
	el.style.cssText = `position:fixed;top:${fr.top + fr.height / 2 - size / 2}px;left:${fr.left + fr.width / 2 - size / 2}px;width:${size}px;height:${size}px;background:url(${sourceImg.src}) center/cover;border-radius:10px;z-index:9999;pointer-events:none;`;
	document.body.appendChild(el);
	gsap.to(el, {
		duration: 0.62,
		x: to.left + to.width / 2 - (fr.left + fr.width / 2),
		y: to.top + to.height / 2 - (fr.top + fr.height / 2),
		width: 22,
		height: 22,
		borderRadius: '50%',
		opacity: 0,
		ease: 'power2.in',
		onComplete() {
			el.remove();
			gsap.fromTo(
				'.cart-btn',
				{ scale: 1 },
				{
					scale: 1.4,
					duration: 0.12,
					yoyo: true,
					repeat: 1,
					ease: 'power1.inOut',
				},
			);
		},
	});
}

/* ─── page transition ─── */
function AnimatedPage({ view, children }) {
	const ref = useRef(null);
	useLayoutEffect(() => {
		const ctx = gsap.context(() => {
			gsap.fromTo(
				'.fade-in',
				{ y: 12, opacity: 0 },
				{ y: 0, opacity: 1, duration: 0.36, ease: 'power2.out', stagger: 0.04 },
			);
		}, ref);
		return () => ctx.revert();
	}, [view]);
	return <div ref={ref}>{children}</div>;
}

/* ══════════════════════════════════════════════════════
   APP
══════════════════════════════════════════════════════ */
export default function App() {
	const [view, setView] = useState(() => {
		const path = window.location.pathname;
		const params = new URLSearchParams(window.location.search);
		// Tudo sob /churrasco é a página do evento — inclusive o endereço
		// antigo /churrasco/pagamento-concluido, que a própria página redireciona
		// para /churrasco (o pagamento Pix acontece dentro dela, sem sair).
		if (path === '/churrasco' || path.startsWith('/churrasco/')) return 'churrasco';
		if (
			path === '/pagamento-concluido' ||
			(params.has('pedido') && params.has('status'))
		) {
			return 'pagamento-concluido';
		}
		return 'catalog';
	});
	const [selectedProduct, setProduct] = useState(null);
	const [cart, setCart] = useState([]);
	const [paymentResult, setResult] = useState(null);
	const [theme, setTheme] = useState(
		() => localStorage.getItem('aasiam-theme') || 'dark',
	);
	const [appliedCupom, setAppliedCupom] = useState(null);

	/* apply theme class to <html> */
	useEffect(() => {
		const html = document.documentElement;
		html.classList.toggle('dark', theme === 'dark');
		html.classList.toggle('light', theme === 'light');
		localStorage.setItem('aasiam-theme', theme);
	}, [theme]);

	/* hide splash screen once React has mounted (fallback de 2.5s no index.html) */
	useEffect(() => {
		const splash = document.getElementById('splash-screen');
		if (splash) {
			splash.style.opacity = '0';
			setTimeout(() => splash.remove(), 400);
		}
	}, []);

	function toggleTheme() {
		setTheme(t => (t === 'dark' ? 'light' : 'dark'));
	}

	function go(nextView) {
		setView(nextView);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function scrollToCategory(catId) {
		if (view !== 'catalog') {
			setView('catalog');
			setTimeout(() => {
				document
					.getElementById(`cat-${catId}`)
					?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}, 80);
		} else {
			document
				.getElementById(`cat-${catId}`)
				?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	function openProduct(product) {
		setProduct(product);
		go('detail');
	}

	function addToCart(item) {
		setCart(prev => {
			const existing = prev.find(i => i.key === item.key);
			if (existing)
				return prev.map(i =>
					i.key === item.key ? { ...i, qty: i.qty + 1 } : i,
				);
			return [...prev, item];
		});
	}

	function updateQty(key, delta) {
		setCart(prev =>
			prev
				.map(i =>
					i.key === key ? { ...i, qty: Math.max(0, i.qty + delta) } : i,
				)
				.filter(i => i.qty > 0),
		);
	}

	function removeItem(key) {
		setCart(prev => prev.filter(i => i.key !== key));
	}

	function resetAll() {
		setCart([]);
		setResult(null);
		go('catalog');
	}

	const cartCount = cart.reduce((t, i) => t + i.qty, 0);

	// /churrasco é uma página própria da AASIAM: sem header da loja, sem
	// carrinho e sem alternância de tema. Fica fora do app-shell de propósito.
	if (view === 'churrasco') return <ChurrascoPage />;

	return (
		<div className="app-shell">
			<SiteHeader
				view={view}
				cartCount={cartCount}
				theme={theme}
				onScrollTo={scrollToCategory}
				onHome={() => go('catalog')}
				onCart={() => go('cart')}
				onToggleTheme={toggleTheme}
			/>

			<main style={{ flex: 1 }}>
				<AnimatedPage view={view}>
					{view === 'catalog' && (
						<CatalogView onOpen={openProduct} className="fade-in" />
					)}
					{view === 'detail' && selectedProduct && (
						<DetailView
							product={selectedProduct}
							onBack={() => go('catalog')}
							onAdd={item => addToCart(item)}
							onBuyNow={item => {
								addToCart(item);
								go('checkout');
							}}
							className="fade-in"
						/>
					)}
					{view === 'cart' && (
						<CartView
							cart={cart}
							onQty={updateQty}
							onRemove={removeItem}
							onShop={() => go('catalog')}
							onCheckout={() => go('checkout')}
							appliedCupom={appliedCupom}
							onApplyCupom={setAppliedCupom}
							className="fade-in"
						/>
					)}
					{view === 'checkout' && (
						<CheckoutView
							cart={cart}
							onBack={() => go('cart')}
							onResult={r => {
								setResult(r);
								go('confirmation');
							}}
							appliedCupom={appliedCupom}
							className="fade-in"
						/>
					)}
					{view === 'confirmation' && (
						<ConfirmationView
							result={paymentResult}
							onNew={resetAll}
							className="fade-in"
						/>
					)}
					{view === 'pagamento-concluido' && (
						<PagamentoConcluido
							onBack={resetAll}
							className="fade-in"
						/>
					)}
				</AnimatedPage>
			</main>

			<footer className="site-footer-copy">
				<p>© 2026 AASIAM. Todos os direitos reservados.</p>
				<p>
					Desenvolvido por Arthur Zanon, Marcelo Telles e Milton Bortolanza.
				</p>
			</footer>
		</div>
	);
}

/* ══════════════════════════════════════════════════════
   HEADER
══════════════════════════════════════════════════════ */
function SiteHeader({
	view,
	cartCount,
	theme,
	onScrollTo,
	onHome,
	onCart,
	onToggleTheme,
}) {
	const [brokenDesktop, setBrokenDesktop] = useState(false);
	const [brokenMobile, setBrokenMobile] = useState(false);

	const fallbackSpan = (
		<span
			style={{
				width: 36,
				height: 36,
				display: 'grid',
				placeItems: 'center',
				background: 'var(--green-softer)',
				borderRadius: 8,
				fontWeight: 800,
				fontSize: '0.7rem',
				color: 'var(--green-bright)',
			}}
		>
			SI
		</span>
	);

	return (
		<>
			{/* Logo bar — visible only on mobile via CSS */}
			<div className="mobile-top-bar">
				<button
					type="button"
					className="brand-lockup mobile-brand"
					onClick={onHome}
					aria-label="Início"
				>
					{brokenMobile ? (
						fallbackSpan
					) : (
						<SmartImage
							src="/logo-aasiam.jpg"
							alt="AASIAM"
							className="brand-logo"
							priority="high"
							skeleton={false}
							onError={() => setBrokenMobile(true)}
						/>
					)}
					<span className="wordmark">AASIAM</span>
				</button>
			</div>

			<header className="site-header">
				<div className="header-inner">
					<div className="header-bar">
						{/* Brand + logo — hidden on mobile */}
						<button
							type="button"
							className="brand-lockup"
							onClick={onHome}
							aria-label="Início"
						>
							{brokenDesktop ? (
								fallbackSpan
							) : (
								<SmartImage
									src="/logo-aasiam.jpg"
									alt="AASIAM"
									className="brand-logo"
									priority="high"
									skeleton={false}
									onError={() => setBrokenDesktop(true)}
								/>
							)}
							<span className="wordmark">AASIAM</span>
						</button>

						{/* Category nav */}
						<nav className="main-nav" aria-label="Categorias">
							{CATEGORIES.map(c => (
								<button
									key={c.id}
									type="button"
									className="nav-link"
									onClick={() => onScrollTo(c.id)}
								>
									{c.label}
								</button>
							))}
						</nav>

						{/* Theme toggle + cart */}
						<div className="header-actions">
							<button
								type="button"
								className="theme-btn"
								onClick={onToggleTheme}
								aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
							>
								{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
							</button>

							<button
								type="button"
								className="cart-btn"
								onClick={onCart}
								aria-label="Carrinho"
							>
								<ShoppingCart size={18} />
								{cartCount > 0 && (
									<span className="cart-badge">{cartCount}</span>
								)}
							</button>
						</div>
					</div>
				</div>
			</header>
		</>
	);
}

/* ══════════════════════════════════════════════════════
   CATALOG VIEW — all categories on one page
══════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════
   HERO BANNER — auto-rotating promotional carousel
══════════════════════════════════════════════════════ */
const SLIDE_POS = {
	center: {
		transform: 'translateX(0) translateZ(0px)   rotateY(0deg)',
		opacity: 1,
		zIndex: 4,
		filter: 'brightness(1)',
	},
	right: {
		transform: 'translateX(54%) translateZ(-160px) rotateY(-52deg)',
		opacity: 0.5,
		zIndex: 3,
		filter: 'brightness(0.5)',
	},
	left: {
		transform: 'translateX(-54%) translateZ(-160px) rotateY(52deg)',
		opacity: 0.5,
		zIndex: 3,
		filter: 'brightness(0.5)',
	},
	hidden: {
		transform: 'translateX(0)   translateZ(-300px) rotateY(0deg)',
		opacity: 0,
		zIndex: 1,
		filter: 'brightness(0)',
	},
};

function HeroBanner() {
	const [current, setCurrent] = useState(0);
	const dragStartX = useRef(0);
	const wasDrag = useRef(false);
	const n = BANNER_SLIDES.length;

	useEffect(() => {
		const t = setInterval(() => setCurrent(c => (c + 1) % n), 4500);
		return () => clearInterval(t);
	}, [n]);

	function go(dir) {
		setCurrent(c => (c + dir + n) % n);
	}

	function onPointerDown(e) {
		dragStartX.current = e.touches?.[0]?.clientX ?? e.clientX;
		wasDrag.current = false;
	}

	function onPointerUp(e) {
		const endX = e.changedTouches?.[0]?.clientX ?? e.clientX;
		const delta = dragStartX.current - endX;
		if (Math.abs(delta) > 40) {
			go(delta > 0 ? 1 : -1);
			wasDrag.current = true;
		}
	}

	function slidePos(i) {
		const off = (((i - current) % n) + n) % n;
		const norm = off > Math.floor(n / 2) ? off - n : off;
		if (norm === 0) return SLIDE_POS.center;
		if (norm === 1) return SLIDE_POS.right;
		if (norm === -1) return SLIDE_POS.left;
		return SLIDE_POS.hidden;
	}

	return (
		<div
			className="hero-carousel"
			onMouseDown={onPointerDown}
			onMouseUp={onPointerUp}
			onTouchStart={onPointerDown}
			onTouchEnd={onPointerUp}
		>
			<div className="hero-stage">
				{BANNER_SLIDES.map((slide, i) => (
					<div
						key={slide.src}
						className="hero-slide"
						style={slidePos(i)}
						onClick={() => {
							if (!wasDrag.current) setCurrent(i);
						}}
					>
						<SmartImage src={slide.src} alt={slide.alt} priority="high" />
					</div>
				))}
			</div>

			<button
				type="button"
				className="hero-arrow hero-prev"
				onClick={() => go(-1)}
				aria-label="Anterior"
			/>
			<button
				type="button"
				className="hero-arrow hero-next"
				onClick={() => go(1)}
				aria-label="Próximo"
			/>

			<div className="hero-dots">
				{BANNER_SLIDES.map((_, i) => (
					<button
						key={i}
						type="button"
						className={`hero-dot${i === current ? ' active' : ''}`}
						onClick={() => setCurrent(i)}
						aria-label={`Slide ${i + 1}`}
					/>
				))}
			</div>
		</div>
	);
}

function CatalogView({ onOpen, className }) {
	const [activeFilter, setActiveFilter] = useState('todos');
	const visibleCats =
		activeFilter === 'todos'
			? CATEGORIES
			: CATEGORIES.filter(c => c.id === activeFilter);

	return (
		<div className={`page content-pad ${className || ''}`}>
			<HeroBanner />

			<div className="cat-filter">
				<button
					type="button"
					className={`cat-pill${activeFilter === 'todos' ? ' active' : ''}`}
					onClick={() => setActiveFilter('todos')}
				>
					Todos
				</button>
				{CATEGORIES.map(c => (
					<button
						key={c.id}
						type="button"
						className={`cat-pill${activeFilter === c.id ? ' active' : ''}`}
						onClick={() => setActiveFilter(c.id)}
					>
						{c.label}
					</button>
				))}
			</div>

			{visibleCats.map(cat => {
				const list = PRODUCTS.filter(p => CATEGORY_MAP[p.id] === cat.id);
				return (
					<section
						key={cat.id}
						id={`cat-${cat.id}`}
						className="catalog-section"
					>
						<div className="section-head">
							<h2 className="section-title">{cat.label}</h2>
							<span className="section-count">
								{list.length} {list.length === 1 ? 'produto' : 'produtos'}
							</span>
						</div>
						<div className="catalog-grid">
							{list.map(p => (
								<ProductTile key={p.id} product={p} onOpen={onOpen} />
							))}
						</div>
					</section>
				);
			})}
		</div>
	);
}

function toWebp(src) {
	return src.replace(/\.(png|jpe?g)$/i, '.webp');
}

/**
 * <picture> com WebP (source principal) + fallback PNG/JPG, prioridade de
 * carregamento e skeleton com pulse enquanto a imagem não carrega.
 * priority: 'high' (eager) | 'auto' (lazy) | 'low' (lazy)
 */
function SmartImage({
	src,
	alt,
	priority = 'low',
	className,
	imgRef,
	onLoad,
	onError,
	skeleton = true,
}) {
	const [loaded, setLoaded] = useState(false);
	function handleLoaded(e) {
		setLoaded(true);
		onLoad?.(e);
	}
	function handleError(e) {
		setLoaded(true);
		onError?.(e);
	}
	return (
		<>
			{skeleton && (
				<span
					className={`img-skeleton${loaded ? ' is-hidden' : ''}`}
					aria-hidden="true"
				/>
			)}
			<picture className="smart-picture">
				<source srcSet={toWebp(src)} type="image/webp" />
				<img
					ref={imgRef}
					src={src}
					alt={alt}
					className={className}
					draggable={false}
					decoding="async"
					loading={priority === 'high' ? 'eager' : 'lazy'}
					fetchPriority={priority}
					onLoad={handleLoaded}
					onError={handleError}
				/>
			</picture>
		</>
	);
}

function ProductTile({ product, onOpen }) {
	const img = product.images?.[0];
	const soldOut = product.soldOut === true;
	const priority = IMG_PRIORITY_BY_ID[product.id] || 'low';
	// Combos (têm lista `includes`) não exibem badge de texto sobreposto na imagem
	const isCombo = Array.isArray(product.includes) && product.includes.length > 0;
	return (
		<button
			type="button"
			className={`tile${soldOut ? ' tile-sold-out' : ''}`}
			onClick={() => !soldOut && onOpen(product)}
			disabled={soldOut}
			aria-disabled={soldOut}
		>
			<div className="tile-media">
				{img ? (
					<SmartImage src={img} alt={product.name} priority={priority} />
				) : (
					<div className="tile-placeholder">
						<ShoppingBag size={48} />
					</div>
				)}
				{soldOut ? (
					<span className="tile-badge-sold-out">Esgotado</span>
				) : isCombo ? null : (
					<span className="tile-tag">{product.tag}</span>
				)}
			</div>
			<div className="tile-name">{product.name}</div>
			<div className="tile-foot">
				{soldOut ? (
					<span className="tile-price tile-price-sold-out">Esgotado</span>
				) : (
					<>
						<span className="tile-price">{fmt(product.priceCents)}</span>
						<span className="tile-cta">
							Ver <ChevronRight size={14} />
						</span>
					</>
				)}
			</div>
		</button>
	);
}

/* ══════════════════════════════════════════════════════
   PRODUCT DETAIL VIEW
══════════════════════════════════════════════════════ */
function DetailView({ product, onBack, onAdd, onBuyNow, className }) {
	const [imgIndex, setImgIndex] = useState(0);
	const [sel, setSel] = useState(() => buildInitialSel(product));
	const [added, setAdded] = useState(false);
	const imgRef = useRef(null);
	const swipeRef = useRef(0);

	const images = product.images || [];
	const cat = CATEGORY_MAP[product.id] || 'acessorios';
	// Combos (têm lista `includes`) usam object-fit: cover para a imagem preencher o frame
	const isCombo = Array.isArray(product.includes) && product.includes.length > 0;

	useEffect(() => {
		setImgIndex(0);
	}, [product.id]);

	function prevImg() {
		setImgIndex(i => (i - 1 + images.length) % images.length);
	}
	function nextImg() {
		setImgIndex(i => (i + 1) % images.length);
	}

	/* swipe on the image */
	function onSwipeStart(e) {
		swipeRef.current = e.touches?.[0]?.clientX ?? e.clientX;
	}
	function onSwipeEnd(e) {
		const dx = swipeRef.current - (e.changedTouches?.[0]?.clientX ?? e.clientX);
		if (Math.abs(dx) > 40) dx > 0 ? nextImg() : prevImg();
	}

	function set(k, v) {
		setSel(s => ({ ...s, [k]: v }));
	}

	function handleAdd() {
		onAdd(buildCartItem(product, sel));
		flyToCart(imgRef.current);
		setAdded(true);
		setTimeout(() => setAdded(false), 1800);
	}

	function handleBuyNow() {
		onBuyNow(buildCartItem(product, sel));
	}

	async function handleShare() {
		const url = window.location.origin;
		const text = `${product.name} — ${fmt(product.priceCents)} | AASIAM`;
		if (navigator.share) {
			try {
				await navigator.share({ title: product.name, text, url });
			} catch {}
		} else {
			window.open(
				`https://wa.me/?text=${encodeURIComponent(text + '\n' + url)}`,
				'_blank',
				'noopener',
			);
		}
	}

	return (
		<div className={`page content-pad ${className || ''}`}>
			<button type="button" className="back-link" onClick={onBack}>
				<ArrowLeft size={16} /> Voltar
			</button>

			<div className="detail-grid">
				{/* media */}
				<div
					className={`detail-media${isCombo ? ' is-combo' : ''}`}
					onMouseDown={onSwipeStart}
					onMouseUp={onSwipeEnd}
					onTouchStart={onSwipeStart}
					onTouchEnd={onSwipeEnd}
				>
					{images.length > 0 ? (
						<SmartImage
							src={images[imgIndex]}
							alt={product.name}
							priority="low"
							imgRef={imgRef}
							skeleton={false}
						/>
					) : (
						<div className="detail-placeholder">
							<ShoppingBag size={88} />
						</div>
					)}

					{images.length > 1 && (
						<>
							<button
								type="button"
								className="media-arrow media-arrow-prev"
								onClick={prevImg}
								aria-label="Imagem anterior"
							/>
							<button
								type="button"
								className="media-arrow media-arrow-next"
								onClick={nextImg}
								aria-label="Próxima imagem"
							/>
							<div className="media-dots">
								{images.map((_, i) => (
									<button
										key={i}
										type="button"
										className={`dot${i === imgIndex ? ' active' : ''}`}
										onClick={() => setImgIndex(i)}
										aria-label={`Imagem ${i + 1}`}
									/>
								))}
							</div>
						</>
					)}
				</div>

				{/* info */}
				<div className="detail-info">
					<div className="detail-title-row">
						<h1 className="detail-title">{product.name}</h1>
						<button
							type="button"
							className="share-btn"
							onClick={handleShare}
							aria-label="Compartilhar"
						>
							<Share2 size={17} />
						</button>
					</div>

					<div className="detail-price">{fmt(product.priceCents)}</div>

					<ProductSelectors product={product} sel={sel} onChange={set} />

					{productHasHoodie(product) && <MedidaTabela />}

					<div className="detail-actions">
						{product.soldOut ? (
							<button
								type="button"
								className="btn btn-block btn-sold-out"
								disabled
							>
								Esgotado
							</button>
						) : (
							<>
								<button
									type="button"
									className={`btn btn-block${added ? ' btn-added' : ' btn-primary'}`}
									onClick={handleAdd}
								>
									{added ? (
										<>
											<Check size={17} /> Adicionado
										</>
									) : (
										<>
											<ShoppingCart size={17} /> Adicionar ao carrinho
										</>
									)}
								</button>

								<button
									type="button"
									className="btn btn-buy-now btn-block"
									onClick={handleBuyNow}
								>
									<Zap size={16} /> Comprar agora
								</button>
							</>
						)}
					</div>

					<div className="pay-badges">
						<span>
							<Lock size={12} /> Pagamento seguro
						</span>
						<span>
							<QrCode size={12} /> Pix
						</span>
						<span>
							<CreditCard size={12} /> Cartão
						</span>
					</div>

					<div className="detail-desc">
						<h3>Descrição</h3>
						<p>{product.description || MATERIAL_MAP[cat]}</p>
					</div>
				</div>
			</div>
		</div>
	);
}

function buildInitialSel(product) {
	if (product.kind === 'sizedVariants') return { size: 'M' };
	if (product.kind === 'doubleHoodie') return { verde: 'M', bege: 'M' };
	if (product.kind === 'modelQuantity')
		return { model: product.models[0].code };
	if (product.kind === 'configuredBundle') {
		return {
			variant: product.variants[0].code,
			size: 'M',
			backpack: product.hasBackpack ? product.models[0].code : null,
		};
	}
	return {};
}

function ProductSelectors({ product, sel, onChange }) {
	if (product.kind === 'sizedVariants') {
		return (
			<div className="field-group">
				<span className="group-label">Tamanho</span>
				<SizePills
					sizes={product.sizes}
					value={sel.size}
					onChange={v => onChange('size', v)}
				/>
			</div>
		);
	}

	if (product.kind === 'doubleHoodie') {
		const verde = product.variants?.find(v => v.code === 'verde');
		const bege = product.variants?.find(v => v.code === 'bege');
		return (
			<div className="field-group">
				<span className="group-label">Tamanhos</span>
				<div className="kit-sizes">
					{verde && (
						<div className="kit-size-block">
							<span className="kit-size-head">
								<span
									className="color-swatch"
									style={{ background: verde.swatch }}
								/>
								{verde.name}
							</span>
							<SizePills
								sizes={product.sizes}
								value={sel.verde}
								onChange={v => onChange('verde', v)}
							/>
						</div>
					)}
					{bege && (
						<div className="kit-size-block">
							<span className="kit-size-head">
								<span
									className="color-swatch"
									style={{ background: bege.swatch }}
								/>
								{bege.name}
							</span>
							<SizePills
								sizes={product.sizes}
								value={sel.bege}
								onChange={v => onChange('bege', v)}
							/>
						</div>
					)}
				</div>
			</div>
		);
	}

	if (product.kind === 'modelQuantity') {
		return (
			<div className="field-group">
				<span className="group-label">Modelo</span>
				<div className="pill-row">
					{product.models.map(m => (
						<button
							key={m.code}
							type="button"
							className={`variant-pill${sel.model === m.code ? ' active' : ''}`}
							onClick={() => onChange('model', m.code)}
						>
							{m.name}
							{sel.model === m.code && <Check size={13} />}
						</button>
					))}
				</div>
			</div>
		);
	}

	if (product.kind === 'configuredBundle') {
		return (
			<>
				<div className="field-group">
					<span className="group-label">Cor do moletom</span>
					<div className="pill-row">
						{product.variants.map(v => (
							<button
								key={v.code}
								type="button"
								className={`variant-pill${sel.variant === v.code ? ' active' : ''}`}
								onClick={() => onChange('variant', v.code)}
							>
								<span
									className="color-swatch"
									style={{ background: v.swatch }}
								/>
								{v.name}
							</button>
						))}
					</div>
				</div>
				<div className="field-group">
					<span className="group-label">Tamanho</span>
					<SizePills
						sizes={product.sizes}
						value={sel.size}
						onChange={v => onChange('size', v)}
					/>
				</div>
				{product.hasBackpack && (
					<div className="field-group">
						<span className="group-label">Modelo de mochila</span>
						<div className="pill-row">
							{product.models.map(m => (
								<button
									key={m.code}
									type="button"
									className={`variant-pill${sel.backpack === m.code ? ' active' : ''}`}
									onClick={() => onChange('backpack', m.code)}
								>
									{m.name}
									{sel.backpack === m.code && <Check size={13} />}
								</button>
							))}
						</div>
					</div>
				)}
			</>
		);
	}

	return null;
}

function SizePills({ sizes, value, onChange }) {
	return (
		<div className="pill-row">
			{sizes.map(s => (
				<button
					key={s}
					type="button"
					className={`size-pill${value === s ? ' active' : ''}`}
					onClick={() => onChange(s)}
				>
					{s}
				</button>
			))}
		</div>
	);
}

/* ── Guia de medidas (moletons) ── */
const MEDIDAS_MOLETOM = [
	{ size: 'PP', a: 60, b: 50 },
	{ size: 'P', a: 63, b: 53 },
	{ size: 'M', a: 67, b: 56 },
	{ size: 'G', a: 70, b: 59 },
	{ size: 'GG', a: 74, b: 63 },
	{ size: 'XG', a: 77, b: 66 },
];

// Produtos que incluem moletom exibem o guia de medidas.
function productHasHoodie(product) {
	return (
		product.kind === 'sizedVariants' ||
		product.kind === 'doubleHoodie' ||
		(product.kind === 'configuredBundle' && product.hasHoodie)
	);
}

function MedidaTabela() {
	const [open, setOpen] = useState(false);

	return (
		<div className="size-guide">
			<button
				type="button"
				className={`size-guide-toggle${open ? ' open' : ''}`}
				onClick={() => setOpen(o => !o)}
				aria-expanded={open}
			>
				<span className="size-guide-toggle-label">
					<Ruler size={16} /> Ver medidas
				</span>
				<ChevronDown size={16} className="size-guide-chevron" />
			</button>

			{open && (
				<div className="size-guide-panel">
					<h4 className="size-guide-title">
						<Ruler size={16} /> Guia de Medidas
					</h4>

					<div className="size-guide-table-wrap">
						<table className="size-guide-table">
							<thead>
								<tr>
									<th>Tamanho</th>
									<th>A (cm)</th>
									<th>B (cm)</th>
								</tr>
							</thead>
							<tbody>
								{MEDIDAS_MOLETOM.map(row => (
									<tr key={row.size}>
										<td>{row.size}</td>
										<td>{row.a}</td>
										<td>{row.b}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<p className="size-guide-legend">
						A = Comprimento | B = Largura (em centímetros)
					</p>

					<div className="size-guide-notes">
						<p>
							<AlertCircle size={13} /> Os valores podem variar de 3cm a 5cm
						</p>
						<p className="size-guide-note-strong">
							<AlertCircle size={13} /> Não realizamos trocas por tamanho
						</p>
					</div>
				</div>
			)}
		</div>
	);
}

/* ══════════════════════════════════════════════════════
   CART VIEW
══════════════════════════════════════════════════════ */
function CartView({ cart, onQty, onRemove, onShop, onCheckout, appliedCupom, onApplyCupom, className }) {
	const [cupomInput, setCupomInput] = useState(appliedCupom?.codigo || '');
	const [cupomLoading, setCupomLoading] = useState(false);
	const [cupomMsg, setCupomMsg] = useState(appliedCupom ? 'success' : '');

	const t = cartTotals(cart, !!appliedCupom);

	async function handleAplicarCupom() {
		const codigo = cupomInput.trim();
		if (!codigo) return;
		setCupomLoading(true);
		setCupomMsg('');
		try {
			const res = await fetch(`${API_BASE}/api/validar-cupom`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ codigo }),
			});
			const data = await res.json();
			if (data.valido) {
				onApplyCupom({ codigo });
				setCupomMsg('success');
			} else if (data.motivo === 'ja_utilizado') {
				onApplyCupom(null);
				setCupomMsg('used');
			} else {
				onApplyCupom(null);
				setCupomMsg('invalid');
			}
		} catch {
			onApplyCupom(null);
			setCupomMsg('invalid');
		} finally {
			setCupomLoading(false);
		}
	}

	return (
		<div className={`page content-pad ${className || ''}`}>
			<h1 className="page-title">Carrinho</h1>

			{cart.length === 0 ? (
				<div className="panel cart-empty-panel">
					<ShoppingCart
						size={42}
						style={{
							display: 'block',
							margin: '0 auto 14px',
							opacity: 0.3,
							color: 'var(--muted)',
						}}
					/>
					<p>Seu carrinho está vazio</p>
					<div style={{ marginTop: 18 }}>
						<button
							type="button"
							className="btn btn-primary btn-sm"
							onClick={onShop}
						>
							Ver produtos
						</button>
					</div>
				</div>
			) : (
				<div className="cart-layout">
					<div className="panel cart-items-panel">
						{cart.map(item => (
							<CartItem
								key={item.key}
								item={item}
								onQty={onQty}
								onRemove={onRemove}
							/>
						))}

						<div className="cupom-section">
							<div className="cupom-row">
								<input
									className="input cupom-input"
									placeholder="Código do cupom"
									value={cupomInput}
									onChange={e => setCupomInput(e.target.value)}
									onKeyDown={e => e.key === 'Enter' && handleAplicarCupom()}
									disabled={cupomLoading}
								/>
								<button
									type="button"
									className="btn btn-ghost btn-sm cupom-btn"
									onClick={handleAplicarCupom}
									disabled={cupomLoading || !cupomInput.trim()}
								>
									{cupomLoading ? <Loader2 size={15} className="pc-spin" /> : 'Aplicar'}
								</button>
							</div>
							{cupomMsg === 'success' && (
								<p className="cupom-msg cupom-msg-ok">
									<Check size={14} /> Cupom aplicado! Preço de associado ativado.
								</p>
							)}
							{cupomMsg === 'used' && (
								<p className="cupom-msg cupom-msg-err">Este cupom já foi utilizado.</p>
							)}
							{cupomMsg === 'invalid' && (
								<p className="cupom-msg cupom-msg-err">Cupom inválido.</p>
							)}
						</div>
					</div>

					<aside className="panel summary">
						<h2>Resumo</h2>
						<div className="summary-rows">
							<div className="summary-row">
								<span>Subtotal</span>
								{appliedCupom ? (
									<strong className="cupom-strike">{fmt(t.subtotal)}</strong>
								) : (
									<strong>{fmt(t.subtotal)}</strong>
								)}
							</div>
							{appliedCupom && t.discount > 0 && (
								<div className="summary-row cupom-discount-row">
									<span>Desconto</span>
									<strong>- {fmt(t.discount)}</strong>
								</div>
							)}
						</div>
						<div className="summary-divider" />
						<div className="summary-total">
							<span className="lbl">Total</span>
							<span className="val">{fmt(t.total)}</span>
						</div>
						<button
							type="button"
							className="btn btn-primary btn-block"
							onClick={onCheckout}
						>
							Finalizar Compra
						</button>
					</aside>
				</div>
			)}
		</div>
	);
}

function CartItem({ item, onQty, onRemove }) {
	return (
		<div className="cart-item">
			<div className="cart-thumb">
				{item.image ? (
					<SmartImage
						src={item.image}
						alt={item.name}
						priority="low"
						skeleton={false}
					/>
				) : (
					<div className="cart-thumb-ph">
						<PackageCheck size={26} />
					</div>
				)}
			</div>

			<div className="cart-item-info">
				<span className="cart-item-name">{item.name}</span>
				{item.meta && <span className="cart-item-meta">{item.meta}</span>}
				<Stepper
					qty={item.qty}
					onDec={() => onQty(item.key, -1)}
					onInc={() => onQty(item.key, 1)}
				/>
			</div>

			<div className="cart-item-right">
				<button
					type="button"
					className="cart-remove"
					onClick={() => onRemove(item.key)}
					aria-label="Remover"
				>
					<X size={17} />
				</button>
				<span className="cart-item-price">
					{fmt(item.unitCents * item.qty)}
				</span>
			</div>
		</div>
	);
}

function Stepper({ qty, onDec, onInc }) {
	return (
		<div className="stepper">
			<button type="button" aria-label="Diminuir" onClick={onDec}>
				<Minus size={13} />
			</button>
			<span>{qty}</span>
			<button type="button" aria-label="Aumentar" onClick={onInc}>
				<Plus size={13} />
			</button>
		</div>
	);
}

/* ══════════════════════════════════════════════════════
   CHECKOUT VIEW
   Form: Nome, Sobrenome, E-mail, Telefone
══════════════════════════════════════════════════════ */
function CheckoutView({ cart, onBack, onResult, appliedCupom, className }) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [submitAttempted, setSubmitAttempted] = useState(false);
	const [form, setForm] = useState({
		nome: '',
		sobrenome: '',
		email: '',
		telefone: '',
	});

	const t = cartTotals(cart, !!appliedCupom);
	const emailValue = form.email.trim();
	const fieldStatus = {
		nome: form.nome.trim().length > 0,
		sobrenome: form.sobrenome.trim().length > 0,
		email:
			emailValue.length > 0 &&
			emailValue.includes('@') &&
			emailValue.includes('.'),
		telefone: form.telefone.trim().length > 0,
	};
	const isFormValid = Object.values(fieldStatus).every(Boolean);
	const isPaymentDisabled = loading || !isFormValid;

	const customer = useMemo(
		() => ({
			name: `${form.nome} ${form.sobrenome}`.trim(),
			phone: form.telefone,
			email: form.email,
		}),
		[form],
	);

	const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
	const inputClass = field =>
		`input${submitAttempted && !fieldStatus[field] ? ' input-error' : ''}`;

	function markInvalidSubmit() {
		if (!loading && !isFormValid) {
			setSubmitAttempted(true);
		}
	}

	async function handleCheckout() {
		setError('');
		setSubmitAttempted(true);
		if (!isFormValid || loading) return;

		setLoading(true);
		try {
			const selection = cartToSelection(cart);
			const res = await fetch(`${API_BASE}/api/checkout`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					customer,
					selection,
					cupom: appliedCupom?.codigo || '',
				}),
			});
			const data = await res.json();
			if (!res.ok)
				throw new Error(data.error || 'Erro ao gerar link de pagamento.');
			if (data.url) {
				window.location.href = data.url;
			} else {
				onResult(data);
			}
		} catch (err) {
			console.error('Erro no checkout:', err);
			setError(
				'Não foi possível processar o pagamento. Tente novamente ou entre em contato com o suporte.',
			);
		} finally {
			setLoading(false);
		}
	}

	const CRUMBS = ['Carrinho', 'Informações', 'Pagamento', 'Confirmação'];

	return (
		<div className={`page content-pad ${className || ''}`}>
			{/* breadcrumb */}
			<nav className="breadcrumb" aria-label="Etapas">
				{CRUMBS.map((s, i) => (
					<span
						key={s}
						style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
					>
						{i > 0 && <ChevronRight size={13} style={{ opacity: 0.4 }} />}
						<span className={i === 1 ? 'crumb-active' : ''}>{s}</span>
					</span>
				))}
			</nav>

			<div className="checkout-grid">
				{/* contact info */}
				<section className="panel form-panel">
					<h2>Informações de Contato</h2>
					<div className="form-stack">
						<div className="row-2">
							<input
								className={inputClass('nome')}
								placeholder="Nome"
								value={form.nome}
								onChange={e => set('nome', e.target.value)}
								autoComplete="given-name"
							/>
							<input
								className={inputClass('sobrenome')}
								placeholder="Sobrenome"
								value={form.sobrenome}
								onChange={e => set('sobrenome', e.target.value)}
								autoComplete="family-name"
							/>
						</div>
						<input
							className={inputClass('email')}
							placeholder="E-mail"
							value={form.email}
							onChange={e => set('email', e.target.value)}
							inputMode="email"
							autoComplete="email"
						/>
						<input
							className={inputClass('telefone')}
							placeholder="Telefone"
							value={form.telefone}
							onChange={e => set('telefone', e.target.value)}
							inputMode="tel"
							autoComplete="tel"
						/>
					</div>
				</section>

				{/* payment */}
				<section className="panel form-panel">
					<h2>Pagamento</h2>

					{error && (
						<div className="messages">
							<span>{error}</span>
						</div>
					)}

					<p
						style={{
							color: 'var(--text-dim)',
							fontSize: '0.88rem',
							lineHeight: 1.6,
							margin: '0 0 16px',
						}}
					>
						Você será redirecionado para a página de pagamento seguro da
						InfinitePay (Pix, cartão de crédito e débito).
					</p>

					<div className="pay-badges" style={{ marginBottom: 20 }}>
						<span>
							<Lock size={12} /> Pagamento seguro
						</span>
						<span>
							<QrCode size={12} /> Pix
						</span>
						<span>
							<CreditCard size={12} /> Cartão
						</span>
					</div>

					<div
						className={`checkout-submit-wrap${isPaymentDisabled ? ' disabled' : ''}`}
						onClick={markInvalidSubmit}
						role="presentation"
					>
						<button
							type="button"
							className="btn btn-primary btn-block"
							onClick={handleCheckout}
							disabled={isPaymentDisabled}
						>
							{loading ? (
								'Aguarde...'
							) : (
								<>
									<Zap size={16} /> Ir para pagamento — {fmt(t.total)}
								</>
							)}
						</button>
					</div>

					<button
						type="button"
						className="btn btn-ghost btn-block"
						onClick={onBack}
					>
						Voltar ao carrinho
					</button>
				</section>

				{/* summary sidebar */}
				<aside className="panel summary checkout-summary">
					<h2>Resumo</h2>
					<div className="summary-mini">
						{cart.map(item => (
							<div className="summary-mini-item" key={item.key}>
								<div className="summary-mini-thumb">
									{item.image ? (
										<SmartImage
											src={item.image}
											alt={item.name}
											priority="low"
											skeleton={false}
										/>
									) : (
										<div className="summary-mini-ph">
											<PackageCheck size={18} />
										</div>
									)}
								</div>
								<div className="summary-mini-info">
									<div className="nm">{item.name}</div>
									<div className="px">{fmt(item.unitCents)}</div>
								</div>
								<span className="summary-mini-qty">x{item.qty}</span>
							</div>
						))}
					</div>
					<div className="summary-divider" />
					<div className="summary-rows">
						<div className="summary-row">
							<span>Subtotal</span>
							{appliedCupom ? (
								<strong className="cupom-strike">{fmt(t.subtotal)}</strong>
							) : (
								<strong>{fmt(t.subtotal)}</strong>
							)}
						</div>
						{appliedCupom && t.discount > 0 && (
							<div className="summary-row cupom-discount-row">
								<span>Desconto</span>
								<strong>- {fmt(t.discount)}</strong>
							</div>
						)}
					</div>
					<div className="summary-divider" />
					<div className="summary-total">
						<span className="lbl">Total</span>
						<span className="val">{fmt(t.total)}</span>
					</div>
				</aside>
			</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════
   CONFIRMATION VIEW
══════════════════════════════════════════════════════ */
function ConfirmationView({ result, onNew, className }) {
	const payment = result?.payment || {};
	const pixData = payment.point_of_interaction?.transaction_data || {};
	const copy = getStatusCopy(payment.status);
	const total = result?.order?.totalAmount || 0;

	return (
		<div className={`page content-pad ${className || ''}`}>
			<div className="panel confirm-panel">
				<div className="confirm-icon">
					<CheckCircle2 size={32} />
				</div>

				{result?.orderId && (
					<span className="confirm-eyebrow">Pedido #{result.orderId}</span>
				)}

				<h1>{copy.title}</h1>
				<p>{copy.desc}</p>
				<p className="confirm-total">
					Total: <span>{currency.format(total)}</span>
				</p>

				{pixData.qr_code_base64 && (
					<img
						className="pix-image"
						src={`data:image/png;base64,${pixData.qr_code_base64}`}
						alt="QR Code Pix"
					/>
				)}

				{pixData.qr_code && (
					<div className="pix-copy" style={{ maxWidth: 460 }}>
						<textarea
							value={pixData.qr_code}
							readOnly
							aria-label="Código Pix"
						/>
						<button
							type="button"
							className="btn btn-ghost btn-sm"
							onClick={() => navigator.clipboard?.writeText(pixData.qr_code)}
						>
							<Copy size={14} /> Copiar código Pix
						</button>
					</div>
				)}

				{pixData.ticket_url && (
					<a
						className="ticket-link"
						href={pixData.ticket_url}
						target="_blank"
						rel="noreferrer"
					>
						Abrir instrução de pagamento
					</a>
				)}

				<div className="confirm-actions">
					<button
						type="button"
						className="btn btn-primary btn-sm"
						onClick={onNew}
					>
						<PackageCheck size={16} /> Novo pedido
					</button>
				</div>
			</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════
   PAGAMENTO CONCLUÍDO
   Exibida quando o usuário retorna do checkout InfinitePay.
   URL: /pagamento-concluido?pedido=AASIAM-...&status=concluido
        &transaction_nsu=...&slug=...&receipt_url=...
══════════════════════════════════════════════════════ */
function PagamentoConcluido({ onBack, className }) {
	const [state, setState]   = useState('loading'); // 'loading' | 'success' | 'error'
	const [pedido, setPedido] = useState(null);
	const [errMsg, setErrMsg] = useState('');

	useEffect(() => {
		const params  = new URLSearchParams(window.location.search);
		const orderId = params.get('pedido');

		if (!orderId) {
			setState('error');
			setErrMsg('Número de pedido não encontrado na URL.');
			return;
		}

		// Params completos (usados para carregar itens/cliente da tela)
		const qs = new URLSearchParams();
		['transaction_nsu', 'slug', 'receipt_url', 'status', 'capture_method', 'transaction_id'].forEach(k => {
			if (params.has(k)) qs.set(k, params.get(k));
		});

		// Params para o polling de status (payment_check da InfinitePay)
		const statusQs = new URLSearchParams();
		['transaction_nsu', 'slug', 'capture_method'].forEach(k => {
			if (params.has(k)) statusQs.set(k, params.get(k));
		});

		let cancelled = false;
		let pollTimer = null;
		const startedAt = Date.now();
		const POLL_INTERVAL = 5000;          // 5 segundos
		const MAX_DURATION  = 2 * 60 * 1000; // 2 minutos

		async function loadFull() {
			const res = await fetch(`${API_BASE}/api/pedido/${encodeURIComponent(orderId)}?${qs.toString()}`);
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Erro ao consultar pedido.');
			return data;
		}

		// Verificação ativa de status a cada 5s, até 2 min
		async function poll() {
			if (cancelled) return;
			try {
				const res = await fetch(`${API_BASE}/api/pedido/${encodeURIComponent(orderId)}/status?${statusQs.toString()}`);
				const data = await res.json();
				if (cancelled) return;

				if (data.paid) {
					// Pagamento confirmado → recarrega dados completos e mostra sucesso
					try {
						const full = await loadFull();
						if (!cancelled) { setPedido({ ...full, paid: true }); setState('success'); }
					} catch {
						if (!cancelled) { setPedido(p => ({ ...(p || {}), orderId, paid: true })); setState('success'); }
					}
					return; // para o polling
				}
			} catch (err) {
				console.error('Erro no polling de status:', err);
			}

			// Ainda não confirmado
			if (Date.now() - startedAt >= MAX_DURATION) {
				if (!cancelled) setState('processing'); // 2 min sem confirmação
				return;
			}
			pollTimer = setTimeout(poll, POLL_INTERVAL);
		}

		// Carga inicial: se já estiver pago, mostra sucesso; senão inicia o polling
		loadFull()
			.then(data => {
				if (cancelled) return;
				setPedido(data);
				if (data.paid) {
					setState('success');
				} else {
					setState('loading');
					pollTimer = setTimeout(poll, POLL_INTERVAL);
				}
			})
			.catch(err => {
				if (cancelled) return;
				console.error('Erro ao consultar pedido:', err);
				setState('error');
				setErrMsg(
					'Não foi possível confirmar seu pagamento. Guarde o número do pedido e entre em contato com o suporte.',
				);
			});

		return () => { cancelled = true; if (pollTimer) clearTimeout(pollTimer); };
	}, []);

	const orderId = new URLSearchParams(window.location.search).get('pedido') ?? '—';

	return (
		<div className={`page content-pad ${className || ''}`}>
			<div className="panel confirm-panel">

				{/* ── LOADING ── */}
				{state === 'loading' && (
					<>
						<div className="confirm-icon pc-loading-icon">
							<Loader2 size={32} className="pc-spin" />
						</div>
						<h1>Verificando pagamento…</h1>
						<p style={{ color: 'var(--text-dim)' }}>
							Aguarde enquanto confirmamos seu pedido.
						</p>
					</>
				)}

				{/* ── SUCESSO ── */}
				{state === 'success' && pedido && (
					<>
						<div className="confirm-icon">
							<CheckCircle2 size={32} />
						</div>

						<span className="confirm-eyebrow">Pedido #{pedido.orderId}</span>
						<h1>Pagamento confirmado!</h1>
						<p style={{ color: 'var(--text-dim)', margin: '0 0 24px' }}>
							{(() => {
								const nome = pedido.customer?.name
									? pedido.customer.name.split(' ')[0]
									: null;

								const itensTexto = (() => {
									const itens = pedido.items;
									if (!Array.isArray(itens) || itens.length === 0) return null;
									const partes = itens.map(it => `${it.quantity}x ${it.name}`);
									if (partes.length === 1) return partes[0];
									if (partes.length === 2) return `${partes[0]} e ${partes[1]}`;
									return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
								})();

								if (nome && itensTexto) {
									return (
										<>
											Parabéns,{' '}
											<strong style={{ color: 'var(--grass-11)' }}>{nome}</strong>!
											{' '}Você acabou de adquirir {itensTexto} da Atlética de Sistemas
											da AMF. Entraremos em contato assim que os itens estiverem
											prontos para entrega.
										</>
									);
								}
								if (nome) {
									return (
										<>
											Parabéns,{' '}
											<strong style={{ color: 'var(--grass-11)' }}>{nome}</strong>!
											{' '}Seu pedido foi registrado com sucesso. Entraremos em contato
											assim que os itens estiverem prontos para entrega.
										</>
									);
								}
								return 'Seu pedido foi registrado com sucesso. Em breve você receberá a confirmação.';
							})()}
						</p>

						{/* Detalhes do pagamento (quando disponíveis via verificarPagamento) */}
						{(pedido.paid_amount != null || pedido.amount != null) && (
							<div className="pc-summary-box">
								{pedido.capture_method && (
									<div className="pc-summary-row">
										<span>Método</span>
										<strong>
											{pedido.capture_method === 'credit' ? 'Cartão de Crédito' :
											 pedido.capture_method === 'debit'  ? 'Cartão de Débito'  :
											 pedido.capture_method === 'pix'    ? 'Pix'               :
											 pedido.capture_method}
										</strong>
									</div>
								)}
								{pedido.installments > 1 && (
									<div className="pc-summary-row">
										<span>Parcelas</span>
										<strong>{pedido.installments}x</strong>
									</div>
								)}
								<div className="pc-summary-divider" />
								<div className="pc-summary-row pc-summary-total">
									<span>Total pago</span>
									<strong>
										{fmt(pedido.paid_amount ?? pedido.amount ?? 0)}
									</strong>
								</div>
							</div>
						)}

						{/* Itens do pedido */}
						{Array.isArray(pedido.items) && pedido.items.length > 0 && (
							<div className="pc-summary-box" style={{ marginTop: '1rem' }}>
								<p style={{ margin: '0 0 0.5rem', fontWeight: 600, fontSize: '0.85rem', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Itens do pedido</p>
								{pedido.items.map((item, i) => (
									<div key={i} className="pc-summary-row" style={{ fontSize: '0.9rem' }}>
										<span>{item.quantity}× {item.name}</span>
										<strong>{fmt(item.unitPriceCents * item.quantity)}</strong>
									</div>
								))}
								<div className="pc-summary-divider" />
								<div className="pc-summary-row pc-summary-total">
									<span>Total</span>
									<strong>{fmt(pedido.totalCents ?? pedido.items.reduce((acc, i) => acc + i.unitPriceCents * i.quantity, 0))}</strong>
								</div>
							</div>
						)}

						<div className="confirm-actions">
							{pedido.receipt_url && (
								<a
									className="btn btn-ghost btn-sm"
									href={pedido.receipt_url}
									target="_blank"
									rel="noreferrer"
								>
									<ExternalLink size={15} /> Ver comprovante
								</a>
							)}
							<button
								type="button"
								className="btn btn-primary btn-sm"
								onClick={onBack}
							>
								<ShoppingCart size={15} /> Voltar para a loja
							</button>
						</div>
					</>
				)}

				{/* ── EM PROCESSAMENTO (2 min sem confirmação) ── */}
				{state === 'processing' && (
					<>
						<div className="confirm-icon pc-loading-icon">
							<Loader2 size={32} className="pc-spin" />
						</div>

						<span className="confirm-eyebrow">Pedido #{orderId}</span>
						<h1>Pagamento em processamento</h1>
						<p style={{ color: 'var(--text-dim)', margin: '0 0 16px' }}>
							Seu pagamento está sendo processado. Você receberá uma
							confirmação em breve. Pode fechar esta página com segurança —
							guarde o número do pedido abaixo.
						</p>

						<div className="pc-order-ref">
							<span>Número do pedido</span>
							<strong>{orderId}</strong>
						</div>

						<div className="confirm-actions">
							<button
								type="button"
								className="btn btn-primary btn-sm"
								onClick={onBack}
							>
								<ShoppingCart size={15} /> Voltar para a loja
							</button>
						</div>
					</>
				)}

				{/* ── ERRO / NÃO CONFIRMADO ── */}
				{state === 'error' && (
					<>
						<div className="confirm-icon pc-error-icon">
							<AlertCircle size={32} />
						</div>

						<h1 style={{ color: 'var(--text)' }}>
							Pagamento não confirmado
						</h1>
						<p style={{ color: 'var(--text-dim)', margin: '0 0 16px' }}>
							{errMsg ||
								'Não foi possível confirmar seu pagamento. Guarde o número do pedido e entre em contato com o suporte.'}
						</p>

						<div className="pc-order-ref">
							<span>Número do pedido</span>
							<strong>{orderId}</strong>
						</div>

						<div className="confirm-actions">
							<button
								type="button"
								className="btn btn-primary btn-sm"
								onClick={onBack}
							>
								<ShoppingCart size={15} /> Voltar para a loja
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
