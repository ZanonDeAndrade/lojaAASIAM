import { AlertCircle, ArrowLeft, CheckCircle2, Copy, Download, ExternalLink, FileText, Gamepad2, Loader2, QrCode, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import rocketBanner from '../../../BannerRocket.png';
import officialRegulation from '../../../Regulamento Oficial - Campeonato Rocket League AASIAM.pdf_20260925_153129_0000.pdf';
import './rocket.css';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const STORAGE_ORDER = 'aasiam-rocket-registration';
const STORAGE_DRAFT = 'aasiam-rocket-draft';
const RELATIONSHIPS = ['Aluno atual', 'Professor', 'Egresso'];
const EMPTY_PLAYER = { nome: '', ra: '', vinculo: '', identificacaoAlternativa: '', semRa: false };
const EMPTY_DRAFT = {
	nomeEquipe: '', jogadores: [{ ...EMPTY_PLAYER }, { ...EMPTY_PLAYER }, { ...EMPTY_PLAYER }], temReserva: false,
	capitao: { nome: '', whatsapp: '', email: '' }, aceiteRegulamento: false,
};

function load(key, fallback) {
	try { const value = JSON.parse(localStorage.getItem(key) || ''); return value || fallback; } catch { return fallback; }
}
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* armazenamento opcional */ } }
function clear(key) { try { localStorage.removeItem(key); } catch { /* idem */ } }
function formatPhone(value) {
	const d = String(value || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
	if (d.length < 3) return d ? `(${d}` : '';
	if (d.length < 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
	return d.length < 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function hasName(value) { return String(value).trim().split(/\s+/).filter(Boolean).length >= 2; }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim()); }
function validPhone(value) { return String(value).replace(/\D/g, '').replace(/^55/, '').length >= 10; }
function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

function Header() {
	return <header className="rl-header"><a href="/" className="rl-brand"><img src="/logo-aasiam.webp" alt="" /><span>AASIAM</span></a><a className="rl-store-link" href="/"><ArrowLeft size={16} /> Loja oficial</a></header>;
}

export function RocketRegulationPage() {
	useEffect(() => { document.title = 'Regulamento Oficial | Rocket League AASIAM'; }, []);
	return <div className="rl-page"><Header /><main className="rl-regulation-wrap"><a className="rl-back-link" href="/torneio-rocket-league"><ArrowLeft size={17} /> Voltar ao torneio</a><div className="rl-regulation-head"><span className="rl-eyebrow"><FileText size={16} /> Documento oficial</span><h1>Regulamento do Torneio Rocket League 2x2</h1><p>Consulte o PDF oficial antes de inscrever sua equipe.</p><a className="rl-button rl-button-primary" href={officialRegulation} download="Regulamento Oficial - Campeonato Rocket League AASIAM.pdf"><Download size={18} /> Baixar regulamento</a></div><section className="rl-pdf-card" aria-label="Leitor do regulamento oficial"><object data={officialRegulation} type="application/pdf" className="rl-pdf"><p>Seu navegador não conseguiu abrir o PDF. <a href={officialRegulation} download>Baixe o Regulamento Oficial</a>.</p></object></section></main></div>;
}

function Overview({ availability, onRegister }) {
	return <section className="rl-overview"><div className="rl-banner" style={{ backgroundImage: `linear-gradient(90deg, rgba(3, 9, 6, .9), rgba(3, 9, 6, .28)), url(${rocketBanner})` }}><div><span className="rl-eyebrow"><Gamepad2 size={16} /> AASIAM apresenta</span><h1>Torneio Rocket League <strong>2x2</strong></h1><p>Monte sua dupla e entre na arena.</p><button className="rl-button rl-button-primary" type="button" onClick={onRegister} disabled={availability && !availability.open}>{availability?.reason === 'esgotadas' ? 'Vagas esgotadas' : availability?.reason === 'encerradas' ? 'Inscrições encerradas' : 'Inscrever equipe'}</button></div></div><div className="rl-info-grid"><article><span>Valor por equipe</span><b>R$ 50,00</b><small>Com ou sem reserva</small></article><article><span>Prazo de inscrição</span><b>10/10/2026</b><small>Consulte o regulamento</small></article><article><span>Vagas</span><b>20 equipes</b><small>{availability ? `${availability.seatsRemaining} restante${availability.seatsRemaining === 1 ? '' : 's'}` : 'Consultando vagas...'}</small></article><article><span>Formação</span><b>2 titulares</b><small>+ 1 reserva opcional</small></article></div><div className="rl-regulation-cta"><div><FileText size={22} /><span><strong>Leia o regulamento oficial</strong><small>Elegibilidade, formato e premiações estão exclusivamente no documento.</small></span></div><a href="/torneio-rocket-league/regulamento">Abrir regulamento <ExternalLink size={16} /></a></div></section>;
}

function PlayerFields({ index, player, onChange, errors, disabled }) {
	const role = index === 2 ? 'Jogador reserva' : `Jogador ${index + 1}`;
	const showAlternative = player.semRa || (player.vinculo !== 'Aluno atual' && !player.ra);
	function change(field, value) { onChange(index, { ...player, [field]: value }); }
	return <fieldset className="rl-player"><legend>{role}{index === 2 && <em>Opcional</em>}</legend><div className="rl-fields-grid"><Field label="Nome completo" error={errors?.nome}><input value={player.nome} onChange={e => change('nome', e.target.value)} autoComplete="name" disabled={disabled} /></Field><Field label="Vínculo com a AMF" error={errors?.vinculo}><select value={player.vinculo} onChange={e => change('vinculo', e.target.value)} disabled={disabled}><option value="">Selecione</option>{RELATIONSHIPS.map(item => <option key={item}>{item}</option>)}</select></Field><Field label="RA" error={errors?.ra}><input value={player.ra} onChange={e => change('ra', e.target.value)} disabled={disabled || player.semRa} inputMode="text" placeholder="Informe o RA" /></Field>{player.vinculo !== 'Aluno atual' && <label className="rl-check rl-inline-check"><input type="checkbox" checked={player.semRa} onChange={e => change('semRa', e.target.checked)} disabled={disabled} /> Não possuo RA disponível</label>}{showAlternative && <Field label="Identificação AMF alternativa" error={errors?.identificacaoAlternativa}><input value={player.identificacaoAlternativa} onChange={e => change('identificacaoAlternativa', e.target.value)} disabled={disabled} placeholder="Ex.: matrícula funcional ou curso/ano" /></Field>}</div>{typeof errors === 'string' && <p className="rl-field-error" role="alert">{errors}</p>}{player.vinculo !== 'Aluno atual' && <p className="rl-field-hint">Professores e egressos sem RA podem informar uma identificação alternativa. O PDF atual ainda pede RA de todos; essa adequação depende da atualização do regulamento.</p>}</fieldset>;
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
		if (!p.vinculo) entry.vinculo = 'Selecione o vínculo.';
		if (p.vinculo === 'Aluno atual' && !p.ra.trim()) entry.ra = 'O RA é obrigatório para aluno atual.';
		if (!p.ra.trim() && p.vinculo && !p.identificacaoAlternativa.trim()) entry.identificacaoAlternativa = 'Informe a identificação alternativa.';
		if (Object.keys(entry).length) errors[`jogadores.${index}`] = entry;
	});
	if (!hasName(draft.capitao.nome)) errors['capitao.nome'] = 'Informe nome e sobrenome.';
	if (!validPhone(draft.capitao.whatsapp)) errors['capitao.whatsapp'] = 'Informe WhatsApp com DDD.';
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
	const closed = availability && !availability.open;
	return <section className="rl-form-card" id="inscricao"><div className="rl-panel-head"><span className="rl-eyebrow"><Users size={16} /> Inscrição da equipe</span><h2>Dados para a inscrição</h2><p>Os dois titulares são obrigatórios; o reserva não altera o valor.</p></div>{closed ? <div className="rl-alert"><AlertCircle size={18} /> {availability.reason === 'esgotadas' ? 'As 20 vagas estão reservadas ou confirmadas.' : 'As inscrições foram encerradas.'}</div> : <form onSubmit={submit} noValidate><Field label="Nome da equipe" error={errors.nomeEquipe}><input value={draft.nomeEquipe} onChange={e => setDraft(prev => ({ ...prev, nomeEquipe: e.target.value }))} maxLength="70" disabled={sending} placeholder="Nome que aparecerá na tabela" /></Field><PlayerFields index={0} player={draft.jogadores[0]} onChange={changePlayer} errors={errors['jogadores.0']} disabled={sending} /><PlayerFields index={1} player={draft.jogadores[1]} onChange={changePlayer} errors={errors['jogadores.1']} disabled={sending} /><label className="rl-toggle"><input type="checkbox" checked={draft.temReserva} onChange={e => setDraft(prev => ({ ...prev, temReserva: e.target.checked }))} disabled={sending} /><span><strong>Adicionar jogador reserva</strong><small>Opcional e sem custo adicional.</small></span></label>{draft.temReserva && <PlayerFields index={2} player={draft.jogadores[2]} onChange={changePlayer} errors={errors['jogadores.2']} disabled={sending} />}<fieldset className="rl-captain"><legend>Capitão da equipe</legend><p>Usaremos estes contatos exclusivamente para comunicações sobre a inscrição.</p><div className="rl-fields-grid"><Field label="Nome completo" error={errors['capitao.nome']}><input value={draft.capitao.nome} onChange={e => setDraft(prev => ({ ...prev, capitao: { ...prev.capitao, nome: e.target.value } }))} disabled={sending} autoComplete="name" /></Field><Field label="WhatsApp" error={errors['capitao.whatsapp']}><input value={draft.capitao.whatsapp} onChange={e => setDraft(prev => ({ ...prev, capitao: { ...prev.capitao, whatsapp: formatPhone(e.target.value) } }))} disabled={sending} inputMode="tel" autoComplete="tel" /></Field><Field label="E-mail" error={errors['capitao.email']}><input value={draft.capitao.email} onChange={e => setDraft(prev => ({ ...prev, capitao: { ...prev.capitao, email: e.target.value } }))} disabled={sending} type="email" autoComplete="email" /></Field></div></fieldset><label className="rl-consent"><input type="checkbox" checked={draft.aceiteRegulamento} onChange={e => setDraft(prev => ({ ...prev, aceiteRegulamento: e.target.checked }))} disabled={sending} /><span>Li e concordo com o <a href="/torneio-rocket-league/regulamento" target="_blank" rel="noreferrer">Regulamento Oficial</a> do Torneio de Rocket League da AASIAM.</span></label>{errors.aceiteRegulamento && <p className="rl-field-error" role="alert">{errors.aceiteRegulamento}</p>}{serverError && <div className="rl-alert" role="alert"><AlertCircle size={18} /> {serverError}</div>}<button className="rl-button rl-button-primary rl-pay" type="submit" disabled={sending}>{sending ? <><Loader2 className="rl-spin" size={18} /> Abrindo pagamento...</> : <>Ir para o pagamento de R$ 50,00</>}</button></form>}</section>;
}

function copy(text, onDone) { navigator.clipboard?.writeText(text).then(() => onDone?.()).catch(() => {}); }
function PaymentPanel({ order, onBack }) {
	const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [copied, setCopied] = useState(false); const [error, setError] = useState('');
	useEffect(() => {
		let alive = true;
		async function poll() { try { const response = await fetch(`${API_BASE}/api/rocket-league/inscricoes/${encodeURIComponent(order.registrationId)}/status`, { headers: { 'X-Inscricao-Token': order.token } }); const body = await response.json(); if (!response.ok) throw new Error(body.error); if (alive) { setData(body); setError(''); } } catch (e) { if (alive) setError(e.message || 'Não foi possível verificar o pagamento.'); } finally { if (alive) setLoading(false); } }
		poll(); const timer = setInterval(poll, 7000); return () => { alive = false; clearInterval(timer); };
	}, [order]);
	async function download() { const response = await fetch(`${API_BASE}/api/rocket-league/inscricoes/${encodeURIComponent(order.registrationId)}/comprovante.pdf`, { headers: { 'X-Inscricao-Token': order.token } }); if (!response.ok) return setError('Não foi possível gerar o comprovante agora.'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `comprovante-rocket-${order.registrationId}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
	if (loading) return <section className="rl-payment-card"><Loader2 className="rl-spin" /> Consultando o pagamento...</section>;
	if (!data) return <section className="rl-payment-card"><div className="rl-alert"><AlertCircle size={18} /> {error || 'Não encontramos esta inscrição.'}</div><button className="rl-button rl-button-secondary" onClick={onBack}>Voltar à inscrição</button></section>;
	if (data.confirmed) return <section className="rl-payment-card rl-confirmed"><CheckCircle2 size={48} /><span className="rl-eyebrow">Inscrição confirmada</span><h2>{data.teamName}</h2><p>O pagamento de <strong>{data.amount}</strong> foi confirmado pelo Mercado Pago.</p><div className="rl-summary"><span>Participantes</span>{data.participants.map(p => <p key={`${p.nome}-${p.vinculo}`}>{p.nome} <small>{p.vinculo}</small></p>)}<span>Status</span><p><strong>Confirmada</strong>{data.paidAt && <small>{data.paidAt}</small>}</p></div><button className="rl-button rl-button-primary" onClick={download}><Download size={18} /> Baixar comprovante</button>{error && <p className="rl-field-error">{error}</p>}</section>;
	const terminal = data.final;
	return <section className="rl-payment-card"><span className="rl-eyebrow"><ShieldCheck size={16} /> Pagamento {data.statusLabel.toLowerCase()}</span><h2>{data.teamName}</h2>{terminal ? <><div className="rl-alert"><AlertCircle size={18} /> {data.status === 'Expirado' ? 'Esta tentativa expirou e a vaga foi liberada.' : 'O pagamento não foi confirmado. Você pode tentar novamente.'}</div><button className="rl-button rl-button-primary" onClick={onBack}>Voltar à inscrição</button></> : <><p>Sua vaga fica reservada enquanto este Pix estiver válido. A confirmação só ocorre após a verificação do Mercado Pago no servidor.</p>{data.pix?.qrCodeBase64 ? <img className="rl-qr" src={`data:image/png;base64,${data.pix.qrCodeBase64}`} alt="QR Code Pix para pagamento" /> : <QrCode className="rl-qr-placeholder" size={96} />}{data.pix?.qrCode && <div className="rl-copy-code"><code>{data.pix.qrCode}</code><button type="button" onClick={() => { copy(data.pix.qrCode, () => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }}><Copy size={16} /> {copied ? 'Copiado' : 'Copiar Pix'}</button></div>}<p className="rl-payment-status"><Loader2 className="rl-spin" size={17} /> Aguardando confirmação do pagamento...</p></>}{error && <p className="rl-field-error">{error}</p>}</section>;
}

export default function RocketPage() {
	const [draft, setDraft] = useState(() => load(STORAGE_DRAFT, EMPTY_DRAFT)); const [order, setOrder] = useState(() => load(STORAGE_ORDER, null)); const [availability, setAvailability] = useState(null);
	useEffect(() => { document.title = 'Torneio Rocket League 2x2 | AASIAM'; fetch(`${API_BASE}/api/rocket-league/availability`).then(r => r.json()).then(data => data.ok && setAvailability(data)).catch(() => {}); }, []);
	useEffect(() => save(STORAGE_DRAFT, draft), [draft]);
	async function checkout(values) {
		const payload = { ...values, jogadores: values.jogadores.map(p => ({ nome: p.nome, ra: p.semRa ? '' : p.ra, vinculo: p.vinculo, identificacaoAlternativa: p.identificacaoAlternativa })), };
		try { const response = await fetch(`${API_BASE}/api/rocket-league/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok || !data.ok) return { ok: false, error: data.error, field: data.field }; const next = { registrationId: data.registrationId, token: data.token }; setOrder(next); save(STORAGE_ORDER, next); setAvailability(prev => prev ? { ...prev, seatsRemaining: data.seatsRemaining, open: data.seatsRemaining > 0 } : prev); scrollTop(); return { ok: true }; } catch { return { ok: false, error: 'Não foi possível conectar ao servidor. Tente novamente.' }; }
	}
	function edit() { setOrder(null); clear(STORAGE_ORDER); scrollTop(); }
	return <div className="rl-page"><Header /><main className="rl-main">{order ? <PaymentPanel order={order} onBack={edit} /> : <div className="rl-layout"><Overview availability={availability} onRegister={() => document.getElementById('inscricao')?.scrollIntoView({ behavior: 'smooth' })} /><RegistrationForm draft={draft} setDraft={setDraft} availability={availability} onCheckout={checkout} /></div>}</main><footer className="rl-footer">© 2026 AASIAM · Torneio Rocket League 2x2</footer></div>;
}
