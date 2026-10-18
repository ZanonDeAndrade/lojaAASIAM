import { PageSections } from '../settings/CustomPage.jsx';
import PageIcon from '../settings/PageIcon.jsx';
import { pageIcon, pageName, pageSettings } from '../../../backend/shared/page-settings.js';
import { AlertCircle, ArrowLeft, Award, CheckCircle2, Copy, Download, ExternalLink, FileText, Gamepad2, Loader2, Medal, QrCode, ShieldCheck, Trophy, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import officialRegulation from '../../../Regulamento Oficial - Campeonato Rocket League AASIAM.pdf_20260925_153129_0000.pdf';
import { formatPhoneBR, validatePhone } from '../shared/churrasco.js';
import './rocket.css';

import MatchSchedule from './MatchSchedule.jsx';
import { site, assetUrl, tournamentInfo } from '../settings/site.js';
import SiteImage from '../settings/SiteImage.jsx';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const STORAGE_ORDER = 'aasiam-rocket-registration';
const STORAGE_DRAFT = 'aasiam-rocket-draft';
const RELATIONSHIPS = ['Aluno atual', 'Professor', 'Egresso'];
const EMPTY_PLAYER = { nome: '', ra: '', vinculo: '', identificacaoAlternativa: '', semRa: false, outraInstituicao: false, nomeInstituicao: '' };
const EMPTY_DRAFT = {
	nomeEquipe: '', jogadores: [{ ...EMPTY_PLAYER }, { ...EMPTY_PLAYER }, { ...EMPTY_PLAYER }], temReserva: false,
	capitao: { nome: '', whatsapp: '', email: '' }, aceiteRegulamento: false,
};

/* Os três destaques que o PDF oficial traz logo abaixo do título — abrem
   também o regulamento nesta página. */

function load(key, fallback) {
	try { const value = JSON.parse(localStorage.getItem(key) || ''); return value || fallback; } catch { return fallback; }
}
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* armazenamento opcional */ } }
function clear(key) { try { localStorage.removeItem(key); } catch { /* idem */ } }
/* A inscrição em andamento também fica no fragmento da URL (nunca enviado a
   servidores). Assim a tela de pagamento volta mesmo quando o navegador do
   celular, um navegador embutido ou uma aba privada não guarda localStorage. */
const HASH_ORDER = /^#inscricao=(ROCKET-[A-Z0-9-]+):([A-Za-z0-9_-]{16,64})$/;
function orderFromHash() { const match = HASH_ORDER.exec(window.location.hash); return match ? { registrationId: match[1], token: match[2] } : null; }
function orderToHash(order) { try { window.history.replaceState(window.history.state, '', order ? `#inscricao=${order.registrationId}:${order.token}` : window.location.pathname + window.location.search); } catch { /* idem */ } }
function hasName(value) { return String(value).trim().split(/\s+/).filter(Boolean).length >= 2; }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim()); }
function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

function Header({ wide = false }) {
	return <header className={`rl-header ${wide ? 'rl-header-wide' : ''}`}><a href="/" className="rl-brand"><img src={assetUrl(site.brand.logo)} alt="" /><span>{site.brand.name}</span></a><a className="rl-store-link" href="/"><ArrowLeft size={16} /> Loja oficial</a></header>;
}

/* Faixa reaproveitada em cima da inscrição (valor/prazo/vagas) e do
   regulamento (valor/prazo/modalidade) — mesmos três destaques do PDF oficial. */
function InfoStrip({ items }) {
	return <div className="rl-info-grid">{items.map(item => <article key={item.label}><span>{item.label}</span><b>{item.value}</b><small>{item.hint}</small></article>)}</div>;
}

function RegulationSection({ section }) {
	const callout = section.callout && <div className="rl-callout"><AlertCircle size={18} aria-hidden="true" /><p>{section.callout}</p></div>;
	const items = section.items && <ul className="rl-reg-list">{section.items.map(item => { const Icon = { Trophy, Medal, Award }[item.icon]; return <li key={item.label}>{Icon && <Icon size={18} className="rl-reg-icon" aria-hidden="true" />}<div><strong>{item.label}:</strong> {item.text}{item.list && <ul className="rl-reg-sublist">{item.list.map(entry => <li key={entry}>{entry}</li>)}</ul>}</div></li>; })}</ul>;
	return <section className="rl-reg-section"><h2>{section.title}</h2>{section.paragraphs?.map(p => <p key={p}>{p}</p>)}{section.calloutFirst ? <>{callout}{items}</> : <>{items}{callout}</>}</section>;
}

export function RocketRegulationPage() {
	useEffect(() => { document.title = `Regulamento | ${site.rocket.title}`; }, []);
	return <div className="rl-page"><Header /><main className="rl-regulation-wrap"><a className="rl-back-link" href="/torneio-rocket-league"><ArrowLeft size={17} /> Voltar para {pageName(site, 'rocket')}</a><div className="rl-regulation-head"><span className="rl-eyebrow"><FileText size={16} /> Documento oficial</span><h1>Regulamento Oficial: {site.rocket.title}</h1><p>Associação Atlética de Sistemas de Informação Antonio Meneghetti (AASIAM — Alcateia de Chernobyl)</p><a className="rl-button rl-button-primary" href={site.rocket.regulationUrl || officialRegulation} download="Regulamento Oficial - Campeonato Rocket League AASIAM.pdf"><Download size={18} /> Baixar regulamento em PDF</a></div><InfoStrip items={tournamentInfo()} /><div className="rl-reg-body">{site.rocket.regulation.map(section => <RegulationSection key={section.title} section={section} />)}</div></main><footer className="rl-footer">{site.brand.footer} · {site.rocket.title}</footer></div>;
}

/* A arte já traz o título pintado (TORNEIO DE ROCKET LEAGUE — AASIAM), então
   ela entra inteira, sem corte e sem legenda por cima — mesmo tratamento do
   banner da home. O H1 de verdade (para leitor de tela e SEO) vem logo
   abaixo, sobre o fundo da própria página. */
function Hero({ availability, onRegister }) {
	return <section className="rl-hero-block"><div className="rl-hero"><SiteImage className="rl-hero-img" src={site.rocket.banner} alt={site.rocket.bannerAlt} /></div><div className="rl-hero-intro"><span className="rl-eyebrow"><PageIcon name={pageIcon(site, 'rocket')} size={16} /> {site.brand.name} apresenta</span><h1>{site.rocket.title}</h1><p>{site.rocket.subtitle}</p>{pageSettings(site, 'rocket').showRegistration && <button className="rl-button rl-button-primary" type="button" onClick={onRegister} disabled={availability && !availability.open}>{availability?.reason === 'encerradas' ? 'Inscrições encerradas' : site.rocket.registerLabel}</button>}</div></section>;
}

function About() {

	return <section className="rl-about"><div className="rl-panel-head"><span className="rl-eyebrow"><Trophy size={16} /> Sobre {pageName(site, 'rocket')}</span><h2>{site.rocket.aboutTitle}</h2><p>{site.rocket.aboutDescription}</p></div><InfoStrip items={tournamentInfo()} /></section>;
}

function PrizeCard({ prize }) {
	return <article className={`rl-prize-card rl-prize-${prize.medal}`}>
		<figure className="rl-prize-media">
			<picture>

				<SiteImage src={/\.[a-z]+$/i.test(prize.image) || prize.image.startsWith('/api/') ? prize.image : `${prize.image}.png`} alt={prize.alt} width="1080" height="1350" loading="lazy" decoding="async" />
			</picture>
			<figcaption className="rl-prize-trophy-note">{prize.note}</figcaption>
		</figure>
		<div className="rl-prize-body">
			<span className="rl-prize-place">{prize.place}</span>
			<p>{prize.text}</p>
		</div>
	</article>;
}

/* Premiação em cards — um por colocação, cada um com a arte oficial inteira
   (4:5) e o aviso de que os itens mostrados são ilustrativos. */
function Prizes() {
	return <section className="rl-prizes"><div className="rl-panel-head"><span className="rl-eyebrow"><Award size={16} /> Premiação oficial</span><h2>O que sua equipe leva pra casa</h2></div><div className="rl-prize-grid">{site.rocket.prizes.map(prize => <PrizeCard key={prize.place} prize={prize} />)}</div></section>;
}

/* Fecha a hierarquia da página: depois de ler sobre o torneio e preencher a
   inscrição, o último passo é abrir o regulamento oficial. */
function RegulationAccess() {
	return <section className="rl-regulation-cta"><div><FileText size={22} /><span><strong>Leia o regulamento oficial</strong><small>Elegibilidade, formato e premiações, em detalhe.</small></span></div><a href="/torneio-rocket-league/regulamento">Abrir regulamento <ExternalLink size={16} /></a></section>;
}

function PlayerFields({ index, player, onChange, errors, disabled }) {
	const role = index === 2 ? 'Jogador reserva' : `Jogador ${index + 1}`;
	const external = !!player.outraInstituicao;
	const showAlternative = player.semRa || (player.vinculo !== 'Aluno atual' && !player.ra);
	function change(field, value) { onChange(index, { ...player, [field]: value }); }
	return <fieldset className="rl-player"><legend>{role}{index === 2 && <em>Opcional</em>}</legend><div className="rl-fields-grid"><Field label="Nome completo" error={errors?.nome}><input value={player.nome} onChange={e => change('nome', e.target.value)} autoComplete="name" disabled={disabled} /></Field><label className="rl-check rl-inline-check"><input type="checkbox" checked={external} onChange={e => onChange(index, { ...player, outraInstituicao: e.target.checked, nomeInstituicao: '' })} disabled={disabled} /> Pertenço a outra instituição</label>{external ? <Field label="Nome da instituição" error={errors?.nomeInstituicao}><input value={player.nomeInstituicao || ''} onChange={e => change('nomeInstituicao', e.target.value)} disabled={disabled} maxLength="100" required placeholder="Instituição de ensino" /></Field> : <><Field label="Vínculo com a AMF" error={errors?.vinculo}><select value={player.vinculo} onChange={e => change('vinculo', e.target.value)} disabled={disabled}><option value="">Selecione</option>{RELATIONSHIPS.map(item => <option key={item}>{item}</option>)}</select></Field><Field label="RA" error={errors?.ra}><input value={player.ra} onChange={e => change('ra', e.target.value)} disabled={disabled || player.semRa} inputMode="text" placeholder="Informe o RA" /></Field>{player.vinculo !== 'Aluno atual' && <label className="rl-check rl-inline-check"><input type="checkbox" checked={player.semRa} onChange={e => change('semRa', e.target.checked)} disabled={disabled} /> Não possuo RA disponível</label>}{showAlternative && <Field label="Identificação AMF alternativa" error={errors?.identificacaoAlternativa}><input value={player.identificacaoAlternativa} onChange={e => change('identificacaoAlternativa', e.target.value)} disabled={disabled} placeholder="Ex.: matrícula funcional ou curso/ano" /></Field>}</>}</div>{typeof errors === 'string' && <p className="rl-field-error" role="alert">{errors}</p>}{!external && player.vinculo !== 'Aluno atual' && <p className="rl-field-hint">Professores e egressos sem RA podem informar uma identificação alternativa. O PDF atual ainda pede RA de todos; essa adequação depende da atualização do regulamento.</p>}</fieldset>;
}

function Field({ label, error, children }) {
	return <label className="rl-field"><span>{label}</span>{children}{error && <small role="alert"><AlertCircle size={14} /> {error}</small>}</label>;
}

function validateDraft(draft) {
	const errors = {};
	if (draft.nomeEquipe.trim().length < 2) errors.nomeEquipe = 'Informe o nome da equipe.';
	const players = draft.jogadores.slice(0, draft.temReserva ? 3 : 2);
	players.forEach((p, index) => {
		const entry = {};
		if (!hasName(p.nome)) entry.nome = 'Informe nome e sobrenome.';
		if (p.outraInstituicao) {
			if ((p.nomeInstituicao || '').trim().length < 2) entry.nomeInstituicao = 'Informe o nome da instituição.';
			if (Object.keys(entry).length) errors[`jogadores.${index}`] = entry;
			return;
		}
		if (!p.vinculo) entry.vinculo = 'Selecione o vínculo.';
		if (p.vinculo === 'Aluno atual' && !p.ra.trim()) entry.ra = 'O RA é obrigatório para aluno atual.';
		if (!p.ra.trim() && p.vinculo && !p.identificacaoAlternativa.trim()) entry.identificacaoAlternativa = 'Informe a identificação alternativa.';
		if (Object.keys(entry).length) errors[`jogadores.${index}`] = entry;
	});
	if (!hasName(draft.capitao.nome)) errors['capitao.nome'] = 'Informe nome e sobrenome.';
	const phoneError = validatePhone(draft.capitao.whatsapp);
	if (phoneError) errors['capitao.whatsapp'] = phoneError;
	if (!validEmail(draft.capitao.email)) errors['capitao.email'] = 'Informe um e-mail válido.';
	if (!draft.aceiteRegulamento) errors.aceiteRegulamento = 'Você precisa concordar com o regulamento oficial.';
	return errors;
}

function RegistrationForm({ draft, setDraft, availability, onCheckout }) {
	const [errors, setErrors] = useState({}); const [sending, setSending] = useState(false); const [serverError, setServerError] = useState('');
	function changePlayer(index, player) { setDraft(prev => ({ ...prev, jogadores: prev.jogadores.map((item, i) => i === index ? player : item) })); }
	async function submit(event) {
		event.preventDefault(); const nextErrors = validateDraft(draft); setErrors(nextErrors); setServerError('');
		if (Object.keys(nextErrors).length) return;
		setSending(true);
		try { const result = await onCheckout(draft); if (!result.ok) { setServerError(result.error); if (result.field) setErrors(prev => ({ ...prev, [result.field]: result.error })); } }
		finally { setSending(false); }
	}
	const closed = !site.rocket.registration.enabled || Date.now() > Date.parse(site.rocket.registration.deadline) || (availability && !availability.open);
	return <section className="rl-form-card" id="inscricao"><div className="rl-panel-head"><span className="rl-eyebrow"><Users size={16} /> Inscrição da equipe</span><h2>Dados para a inscrição</h2><p>Os dois titulares são obrigatórios; o reserva não altera o valor.</p></div>{closed ? <div className="rl-alert"><AlertCircle size={18} /> As inscrições foram encerradas.</div> : <form onSubmit={submit} noValidate><Field label="Nome da equipe" error={errors.nomeEquipe}><input value={draft.nomeEquipe} onChange={e => setDraft(prev => ({ ...prev, nomeEquipe: e.target.value }))} maxLength="70" disabled={sending} placeholder="Nome que aparecerá na tabela" /></Field><PlayerFields index={0} player={draft.jogadores[0]} onChange={changePlayer} errors={errors['jogadores.0']} disabled={sending} /><PlayerFields index={1} player={draft.jogadores[1]} onChange={changePlayer} errors={errors['jogadores.1']} disabled={sending} /><label className="rl-toggle"><input type="checkbox" checked={draft.temReserva} onChange={e => setDraft(prev => ({ ...prev, temReserva: e.target.checked }))} disabled={sending} /><span><strong>Adicionar jogador reserva</strong><small>Opcional e sem custo adicional.</small></span></label>{draft.temReserva && <PlayerFields index={2} player={draft.jogadores[2]} onChange={changePlayer} errors={errors['jogadores.2']} disabled={sending} />}<fieldset className="rl-captain"><legend>Capitão da equipe</legend><p>Usaremos estes contatos exclusivamente para comunicações sobre a inscrição.</p><div className="rl-fields-grid"><Field label="Nome completo" error={errors['capitao.nome']}><input value={draft.capitao.nome} onChange={e => setDraft(prev => ({ ...prev, capitao: { ...prev.capitao, nome: e.target.value } }))} disabled={sending} autoComplete="name" /></Field><Field label="WhatsApp" error={errors['capitao.whatsapp']}><input value={draft.capitao.whatsapp} onChange={e => setDraft(prev => ({ ...prev, capitao: { ...prev.capitao, whatsapp: formatPhoneBR(e.target.value) } }))} disabled={sending} inputMode="tel" autoComplete="tel" /></Field><Field label="E-mail" error={errors['capitao.email']}><input value={draft.capitao.email} onChange={e => setDraft(prev => ({ ...prev, capitao: { ...prev.capitao, email: e.target.value } }))} disabled={sending} type="email" autoComplete="email" /></Field></div></fieldset><label className="rl-consent"><input type="checkbox" checked={draft.aceiteRegulamento} onChange={e => setDraft(prev => ({ ...prev, aceiteRegulamento: e.target.checked }))} disabled={sending} /><span>Li e concordo com o <a href="/torneio-rocket-league/regulamento" target="_blank" rel="noreferrer">Regulamento Oficial</a> de {pageName(site, 'rocket')}.</span></label>{errors.aceiteRegulamento && <p className="rl-field-error" role="alert">{errors.aceiteRegulamento}</p>}{serverError && <div className="rl-alert" role="alert"><AlertCircle size={18} /> {serverError}</div>}<button className="rl-button rl-button-primary rl-pay" type="submit" disabled={sending}>{sending ? <><Loader2 className="rl-spin" size={18} /> Abrindo pagamento...</> : <>Ir para o pagamento de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(site.rocket.registration.amountCents / 100)}</>}</button></form>}</section>;
}

function copy(text, onDone) { navigator.clipboard?.writeText(text).then(() => onDone?.()).catch(() => {}); }
function PaymentPanel({ order, onBack }) {
	const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [copied, setCopied] = useState(false); const [error, setError] = useState(''); const [verifying, setVerifying] = useState(false);
	const checkRef = useRef(async () => {});
	/* Consulta o status enquanto a página está aberta: a cada 4 s, na hora em que
	   a pessoa volta do app do banco (o celular congela os timers em segundo
	   plano) e quando a rede volta. Cada consulta tem prazo de 15 s para que uma
	   requisição pendurada nunca trave as seguintes. Para de consultar ao chegar
	   num status final. */
	useEffect(() => {
		let alive = true; let running = false; let finished = false; let timer = null;
		async function poll() {
			if (!alive || running || finished) return;
			running = true; const controller = new AbortController(); const deadline = setTimeout(() => controller.abort(), 15000);
			try {
				const response = await fetch(`${API_BASE}/api/rocket-league/inscricoes/${encodeURIComponent(order.registrationId)}/status`, { headers: { 'X-Inscricao-Token': order.token }, signal: controller.signal, cache: 'no-store' });
				const body = await response.json(); if (!response.ok) throw new Error(body.error);
				if (alive) { setData(body); setError(''); }
				if (body.final) { finished = true; clearInterval(timer); }
			} catch (e) { if (alive) setError(e.name === 'AbortError' ? 'A verificação demorou. Tentando de novo...' : (e.message || 'Não foi possível verificar o pagamento.')); }
			finally { clearTimeout(deadline); running = false; if (alive) setLoading(false); }
		}
		const wake = () => { if (document.visibilityState !== 'hidden') poll(); };
		checkRef.current = poll; poll(); timer = setInterval(poll, 4000);
		document.addEventListener('visibilitychange', wake); window.addEventListener('focus', wake); window.addEventListener('online', wake); window.addEventListener('pageshow', wake);
		return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); window.removeEventListener('online', wake); window.removeEventListener('pageshow', wake); };
	}, [order]);
	async function verifyNow() { setVerifying(true); try { await checkRef.current(); } finally { setVerifying(false); } }
	async function download() { const response = await fetch(`${API_BASE}/api/rocket-league/inscricoes/${encodeURIComponent(order.registrationId)}/comprovante.pdf`, { headers: { 'X-Inscricao-Token': order.token } }); if (!response.ok) return setError('Não foi possível gerar o comprovante agora.'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `comprovante-rocket-${order.registrationId}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
	if (loading) return <section className="rl-payment-card"><Loader2 className="rl-spin" /> Consultando o pagamento...</section>;
	if (!data) return <section className="rl-payment-card"><div className="rl-alert"><AlertCircle size={18} /> {error || 'Não encontramos esta inscrição.'}</div><button className="rl-button rl-button-secondary" onClick={onBack}>Voltar à inscrição</button></section>;
	if (data.confirmed) return <section className="rl-payment-card rl-confirmed" role="status" aria-live="polite"><CheckCircle2 size={48} /><span className="rl-eyebrow">Pagamento efetuado</span><h2>Inscrição confirmada</h2><p>O pagamento de <strong>{data.amount}</strong> foi confirmado pelo Mercado Pago e a equipe <strong>{data.teamName}</strong> está inscrita no torneio.</p><div className="rl-summary"><span>Participantes</span>{data.participants.map(p => <p key={`${p.nome}-${p.vinculo}`}>{p.nome} <small>{p.vinculo}</small></p>)}<span>Status</span><p><strong>Pagamento confirmado</strong>{data.paidAt && <small>{data.paidAt}</small>}</p><span>Código da inscrição</span><p><small>{data.registrationId}</small></p></div><button className="rl-button rl-button-primary" onClick={download}><Download size={18} /> Baixar comprovante</button>{error && <p className="rl-field-error">{error}</p>}</section>;
	const terminal = data.final; const review = data.status === 'Revisão manual';
	const heading = review ? 'Pagamento em conferência' : `Pagamento ${data.statusLabel.toLowerCase()}`;
	const finalMessage = data.status === 'Expirado' ? 'Esta tentativa expirou e a vaga foi liberada.' : review ? 'Recebemos o seu pagamento e a organização vai conferi-lo para confirmar a inscrição. Não faça um novo pagamento.' : 'O pagamento não foi confirmado. Você pode tentar novamente.';
	return <section className="rl-payment-card" role="status" aria-live="polite"><span className="rl-eyebrow"><ShieldCheck size={16} /> {heading}</span><h2>{data.teamName}</h2>{terminal ? <>{<div className="rl-alert"><AlertCircle size={18} /> {finalMessage}</div>}{review && <p><small>Código da inscrição: {data.registrationId}</small></p>}{!review && <button className="rl-button rl-button-primary" onClick={onBack}>Voltar à inscrição</button>}</> : <><p>Sua vaga fica reservada enquanto este Pix estiver válido. A confirmação só ocorre após a verificação do Mercado Pago no servidor.</p>{data.pix?.qrCodeBase64 ? <img className="rl-qr" src={`data:image/png;base64,${data.pix.qrCodeBase64}`} alt="QR Code Pix para pagamento" /> : <QrCode className="rl-qr-placeholder" size={96} />}{data.pix?.qrCode && <div className="rl-copy-code"><code>{data.pix.qrCode}</code><button type="button" onClick={() => { copy(data.pix.qrCode, () => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }}><Copy size={16} /> {copied ? 'Copiado' : 'Copiar Pix'}</button></div>}<p className="rl-payment-status"><Loader2 className="rl-spin" size={17} /> Aguardando confirmação do pagamento...</p><button type="button" className="rl-button rl-button-secondary" onClick={verifyNow} disabled={verifying}>{verifying ? 'Verificando...' : 'Já paguei, verificar agora'}</button></>}{error && <p className="rl-field-error">{error}</p>}</section>;
}

export default function RocketPage({ preview = false }) {
	// Com as inscrições encerradas, quem abre a página quer acompanhar os jogos.
	const [activeTab, setActiveTab] = useState(() => pageSettings(site, 'rocket').showSchedule && (!site.rocket.registration.enabled || Date.now() > Date.parse(site.rocket.registration.deadline)) ? 'jogos' : 'torneio');
	const [draft, setDraft] = useState(() => preview ? structuredClone(EMPTY_DRAFT) : load(STORAGE_DRAFT, EMPTY_DRAFT)); const [order, setOrder] = useState(() => preview ? null : load(STORAGE_ORDER, null) || orderFromHash()); const [availability, setAvailability] = useState(null);
	useEffect(() => { document.title = `${site.rocket.title} | ${site.brand.name}`; fetch(`${API_BASE}/api/rocket-league/availability`).then(r => r.json()).then(data => data.ok && setAvailability(data)).catch(() => {}); }, []);
	useEffect(() => { if (!preview) save(STORAGE_DRAFT, draft); }, [draft, preview]);
	async function checkout(values) {
		const payload = { ...values, jogadores: values.jogadores.map(p => p.outraInstituicao
				? { nome: p.nome, ra: '', vinculo: '', identificacaoAlternativa: '', outraInstituicao: true, nomeInstituicao: (p.nomeInstituicao || '').trim() }
				: { nome: p.nome, ra: p.semRa ? '' : p.ra, vinculo: p.vinculo, identificacaoAlternativa: p.identificacaoAlternativa, outraInstituicao: false, nomeInstituicao: '' }), };
		try { const response = await fetch(`${API_BASE}/api/rocket-league/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok || !data.ok) return { ok: false, error: data.error, field: data.field }; const next = { registrationId: data.registrationId, token: data.token }; setOrder(next); save(STORAGE_ORDER, next); orderToHash(next); scrollTop(); return { ok: true }; } catch { return { ok: false, error: 'Não foi possível conectar ao servidor. Tente novamente.' }; }
	}
	function edit() { setOrder(null); clear(STORAGE_ORDER); orderToHash(null); scrollTop(); }
	return <div className="rl-page"><Header wide /><main className="rl-main">{order ? <PaymentPanel order={order} onBack={edit} /> : <div className="rl-layout"><Hero availability={availability} onRegister={() => { setActiveTab('torneio'); requestAnimationFrame(() => document.getElementById('inscricao')?.scrollIntoView({ behavior: 'smooth' })); }} /><nav className="rl-section-tabs" aria-label={`Seções de ${pageName(site, 'rocket')}`}><button type="button" aria-pressed={activeTab === 'torneio'} aria-controls="rl-tournament-content" onClick={() => setActiveTab('torneio')}>{site.rocket.registrationTab}</button>{pageSettings(site, 'rocket').showSchedule && <button type="button" aria-pressed={activeTab === 'jogos'} aria-controls="rl-tournament-content" onClick={() => setActiveTab('jogos')}>{site.rocket.gamesTab}</button>}</nav><div id="rl-tournament-content" className={`rl-tab-content ${activeTab === 'jogos' ? 'is-games' : 'is-about'}`}>{activeTab === 'jogos' ? <MatchSchedule /> : <>{pageSettings(site, 'rocket').showAbout && <About />}{pageSettings(site, 'rocket').showPrizes && <Prizes />}{pageSettings(site, 'rocket').showRegistration && <RegistrationForm draft={draft} setDraft={setDraft} availability={availability} onCheckout={checkout} />}</>}</div><PageSections pageKey="rocket" />{pageSettings(site, 'rocket').showRegulation && <RegulationAccess />}</div>}</main><footer className="rl-footer">{site.brand.footer} · {site.rocket.title}</footer></div>;
}
