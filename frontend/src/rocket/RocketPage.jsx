import { AlertCircle, ArrowLeft, Award, CheckCircle2, Copy, Download, ExternalLink, FileText, Gamepad2, Loader2, Medal, QrCode, ShieldCheck, Trophy, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import rocketBanner from '../../../BannerRocket.png';
import officialRegulation from '../../../Regulamento Oficial - Campeonato Rocket League AASIAM.pdf_20260925_153129_0000.pdf';
import './rocket.css';

const AVISO_TROFEU = 'Imagem do troféu meramente ilustrativa. O modelo final pode sofrer alterações.';
const AVISO_MEDALHAS = 'Imagens das medalhas meramente ilustrativas. Os modelos finais podem sofrer alterações.';

/* Artes oficiais da premiação (1º, 2º e 3º lugar), 4:5, com os itens de cada
   colocação (só o 1º lugar tem troféu) e o selo "IMAGEM ILUSTRATIVA" dentro da própria arte. Ficam em
   /public/imgs (webp com fallback png) e entram inteiras, sem corte. */
const PRIZES = [
	{
		place: '1º lugar', medal: 'ouro', text: '1 troféu, 2 medalhas e 2 Jerseys AASIAM.', note: AVISO_TROFEU,
		image: '/imgs/premio-1o-lugar', alt: 'Premiação do 1º lugar: troféu, duas jerseys oficiais da AASIAM e medalhas',
	},
	{
		place: '2º lugar', medal: 'prata', text: '2 medalhas e 2 camisetas AASIAM.', note: AVISO_MEDALHAS,
		image: '/imgs/premio-2o-lugar', alt: 'Premiação do 2º lugar: duas camisas oficiais da AASIAM e medalhas',
	},
	{
		place: '3º lugar', medal: 'bronze', text: '2 medalhas e 2 canecas AASIAM.', note: AVISO_MEDALHAS,
		image: '/imgs/premio-3o-lugar', alt: 'Premiação do 3º lugar: duas canecas com tirante da AASIAM e medalhas',
	},
];

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const STORAGE_ORDER = 'aasiam-rocket-registration';
const STORAGE_DRAFT = 'aasiam-rocket-draft';
const RELATIONSHIPS = ['Aluno atual', 'Professor', 'Egresso'];
const EMPTY_PLAYER = { nome: '', ra: '', vinculo: '', identificacaoAlternativa: '', semRa: false };
const EMPTY_DRAFT = {
	nomeEquipe: '', jogadores: [{ ...EMPTY_PLAYER }, { ...EMPTY_PLAYER }, { ...EMPTY_PLAYER }], temReserva: false,
	capitao: { nome: '', whatsapp: '', email: '' }, aceiteRegulamento: false,
};

/* Os três destaques que o PDF oficial traz logo abaixo do título — abrem
   também o regulamento nesta página. */
const TORNEIO_INFO = [
	{ label: 'Valor por equipe', value: 'R$ 50,00', hint: 'Com ou sem reserva' },
	{ label: 'Prazo de inscrição', value: '10/10/2026', hint: 'Consulte o regulamento' },
	{ label: 'Modalidade', value: '2x2', hint: 'Sem limite de equipes' },
];

/* Transcrição fiel do Regulamento Oficial (PDF anexo) — nenhuma regra, número
   ou palavra das seções 1 a 4 foi alterada. A seção 5 (Premiação) é a
   exceção deliberada: veja a nota junto a ela. Estrutura em dados, e não em
   texto solto, só para reaproveitar o mesmo componente de seção no documento
   inteiro. */
const REGULATION_SECTIONS = [
	{
		title: '1. Organização e apresentação',
		paragraphs: [
			'O presente regulamento rege o campeonato de Rocket League 2x2 promovido pela AASIAM (Associação Atlética de Sistemas de Informação Antonio Meneghetti - Alcateia de Chernobyl). O evento tem como objetivos integrar a comunidade acadêmica, fomentar os e-sports na instituição e arrecadar fundos para as iniciativas da atlética.',
		],
	},
	{
		title: '2. Inscrições, elegibilidade e jogador reserva',
		items: [
			{ label: 'Composição da Equipe', text: 'Cada equipe deve ser formada obrigatoriamente por 2 (dois) jogadores titulares.' },
			{ label: 'Atleta Reserva (Opcional)', text: 'A inscrição de 1 (um) jogador reserva por equipe é totalmente opcional, não sendo obrigatória para a participação no campeonato. Caso inscrito, o reserva deve ser cadastrado previamente junto aos titulares.' },
			{ label: 'Requisito Acadêmico', text: 'Todos os integrantes (titulares e eventuais reservas) devem ser alunos atuais, professores ou egressos (ex-alunos) da instituição de ensino.' },
			{ label: 'Dados Obrigatórios', text: 'No ato da inscrição, a equipe deve fornecer: Nome da Equipe, Nome Completo e RA de todos os integrantes (e do reserva, se houver), além do contato do capitão.' },
			{ label: 'Confirmação de Vaga', text: 'A inscrição é validada estritamente mediante o envio do comprovante de pagamento da taxa de R$ 50,00 aos canais oficiais da AASIAM (https://www.aasiam.com.br/) até 10/10/2026.' },
		],
		callout: 'Atenção: Vagas limitadas a 20 equipes. O preenchimento obedece à ordem de envio do comprovante de pagamento à organização.',
		pendencia: 'O limite de 20 equipes deixou de valer nas inscrições feitas neste site. O trecho acima segue igual ao PDF oficial e precisa de nova versão da organização.',
	},
	{
		title: '3. Formato do campeonato e sistema de pontuação',
		items: [
			{ label: 'Fase de Grupos (Online)', text: 'As 20 equipes serão divididas em 4 grupos de 5 equipes. Todos jogam contra todos em partida única. Cada vitória soma +1 ponto na tabela de classificação. Para agilidade, 4 partidas simultâneas ocorrerão por blocos de horários. Avançam os 2 melhores de cada grupo (Total: 8 equipes).', pendencia: 'Este formato depende de 20 equipes. Como as inscrições não têm mais limite, a organização precisa definir e publicar o formato oficial atualizado.' },
			{
				label: 'Critérios de Desempate (Fase de Grupos)',
				text: 'Em caso de empate em pontos entre duas ou mais equipes, os critérios aplicados em ordem estrita são:',
				list: [
					'1) Confronto Direto;',
					'2) Saldo de Gols (SG);',
					'3) Maior Número de Gols Marcados (GM);',
					'4) Menor Número de Gols Sofridos (GS);',
					'5) Partida de desempate (Tiebreaker) organizada pela Comissão Organizador.',
				],
			},
			{ label: 'Quartas de Final e Semifinais (Online)', text: 'Sistema eliminatório simples em MD3 (Melhor de 3 partidas).' },
			{ label: 'Grande Final (Presencial)', text: 'Realizada na faculdade em confronto decisivo MD5 (Melhor de 5 partidas).' },
		],
	},
	{
		title: '4. Regras de queda de conexão e W.O.',
		callout: 'Regra de Queda de Conexão: Se houver queda de conexão, a partida será reiniciada mantendo o placar atual proporcional ao momento da queda. Caso a queda ocorra com menos de 1 minuto de jogo decorrido, a partida será reiniciada do zero. Se a queda do mesmo jogador ocorrer mais de uma vez na mesma série, o uso do jogador reserva (caso cadastrado) será obrigatório para a continuidade.',
		calloutFirst: true,
		items: [
			{ label: 'Regra Rigorosa de W.O.', text: 'Tolerância máxima de 15 minutos a partir do horário oficial da partida. A ausência de jogadores suficientes acarreta W.O. (derrota por 1x0) ou seja o time que ganhar a partida por W.O soma +1 ponto e +1x gol para o saldo de gols, consequentemente a equipe penalizada por W.O não soma pontos e recebe -1 gol no saldo de gols.' },
			{ label: 'Conduta e Integridade', text: 'Ofensas no chat, toxicidade ou tentativas de burlar regras resultam em advertência e desclassificação imediata sem reembolso.' },
		],
	},
	{
		/* Premiação atualizada em 2026-09-29 (igual aos cards da página). O PDF
		   oficial para download traz outra lista — ver `pendenciaFinal`. */
		title: '5. Premiação oficial',
		items: [
			{ icon: Trophy, label: '1º Lugar (Campeões)', text: '1 troféu, 2 medalhas e 2 Jerseys AASIAM.' },
			{ icon: Medal, label: '2º Lugar (Vice-campeões)', text: '2 medalhas e 2 camisetas AASIAM.' },
			{ icon: Award, label: '3º Lugar', text: '2 medalhas e 2 canecas AASIAM.' },
		],
		pendenciaFinal: 'O PDF para download ainda traz a premiação anterior: 1º lugar sem medalhas, 2º lugar com "Duas Camisas Oficiais (verde/cinza)" sem medalhas e 3º lugar sem medalhas. A organização precisa publicar uma nova versão do PDF com a lista acima.',
	},
];

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

/* Faixa reaproveitada em cima da inscrição (valor/prazo/vagas) e do
   regulamento (valor/prazo/modalidade) — mesmos três destaques do PDF oficial. */
function InfoStrip({ items }) {
	return <div className="rl-info-grid">{items.map(item => <article key={item.label}><span>{item.label}</span><b>{item.value}</b><small>{item.hint}</small></article>)}</div>;
}

function RegulationSection({ section }) {
	const pending = note => <p className="rl-pending" role="note"><AlertCircle size={16} aria-hidden="true" /><span><strong>Pendente de revisão pela organização.</strong> {note}</span></p>;
	const callout = section.callout && <><div className="rl-callout"><AlertCircle size={18} aria-hidden="true" /><p>{section.callout}</p></div>{section.pendencia && pending(section.pendencia)}</>;
	const items = section.items && <ul className="rl-reg-list">{section.items.map(item => { const Icon = item.icon; return <li key={item.label}>{Icon && <Icon size={18} className="rl-reg-icon" aria-hidden="true" />}<div><strong>{item.label}:</strong> {item.text}{item.pendencia && pending(item.pendencia)}{item.list && <ul className="rl-reg-sublist">{item.list.map(entry => <li key={entry}>{entry}</li>)}</ul>}</div></li>; })}</ul>;
	return <section className="rl-reg-section"><h2>{section.title}</h2>{section.paragraphs?.map(p => <p key={p}>{p}</p>)}{section.calloutFirst ? <>{callout}{items}</> : <>{items}{callout}</>}{section.pendenciaFinal && pending(section.pendenciaFinal)}</section>;
}

export function RocketRegulationPage() {
	useEffect(() => { document.title = 'Regulamento Oficial | Rocket League AASIAM'; }, []);
	return <div className="rl-page"><Header /><main className="rl-regulation-wrap"><a className="rl-back-link" href="/torneio-rocket-league"><ArrowLeft size={17} /> Voltar ao torneio</a><div className="rl-regulation-head"><span className="rl-eyebrow"><FileText size={16} /> Documento oficial</span><h1>Regulamento Oficial: Torneio Rocket League 2x2</h1><p>Associação Atlética de Sistemas de Informação Antonio Meneghetti (AASIAM — Alcateia de Chernobyl)</p><a className="rl-button rl-button-primary" href={officialRegulation} download="Regulamento Oficial - Campeonato Rocket League AASIAM.pdf"><Download size={18} /> Baixar regulamento em PDF</a></div><InfoStrip items={TORNEIO_INFO} /><div className="rl-reg-body">{REGULATION_SECTIONS.map(section => <RegulationSection key={section.title} section={section} />)}</div></main><footer className="rl-footer">© 2026 AASIAM · Torneio Rocket League 2x2</footer></div>;
}

/* A arte já traz o título pintado (TORNEIO DE ROCKET LEAGUE — AASIAM), então
   ela entra inteira, sem corte e sem legenda por cima — mesmo tratamento do
   banner da home. O H1 de verdade (para leitor de tela e SEO) vem logo
   abaixo, sobre o fundo da própria página. */
function Hero({ availability, onRegister }) {
	return <section className="rl-hero-block"><div className="rl-hero"><img className="rl-hero-img" src={rocketBanner} alt="Arte oficial do Torneio de Rocket League da AASIAM" /></div><div className="rl-hero-intro"><span className="rl-eyebrow"><Gamepad2 size={16} /> AASIAM apresenta</span><h1>Torneio Rocket League 2x2</h1><p>Monte sua dupla e entre na arena.</p><button className="rl-button rl-button-primary" type="button" onClick={onRegister} disabled={availability && !availability.open}>{availability?.reason === 'encerradas' ? 'Inscrições encerradas' : 'Inscrever equipe'}</button></div></section>;
}

function About() {
	const info = [
		{ label: 'Valor por equipe', value: 'R$ 50,00', hint: 'Com ou sem reserva' },
		{ label: 'Prazo de inscrição', value: '10/10/2026', hint: 'Consulte o regulamento' },
		{ label: 'Formação', value: '2 titulares', hint: '+ 1 reserva opcional' },
	];
	return <section className="rl-about"><div className="rl-panel-head"><span className="rl-eyebrow"><Trophy size={16} /> Sobre o torneio</span><h2>Grupos e mata-mata online, grande final presencial</h2><p>Rocket League 2x2 promovido pela AASIAM — Alcateia de Chernobyl. As equipes inscritas se enfrentam em grupos e mata-mata online; a grande final acontece presencialmente na faculdade.</p></div><InfoStrip items={info} /></section>;
}

function PrizeCard({ prize }) {
	return <article className={`rl-prize-card rl-prize-${prize.medal}`}>
		<figure className="rl-prize-media">
			<picture>
				<source srcSet={`${prize.image}.webp`} type="image/webp" />
				<img src={`${prize.image}.png`} alt={prize.alt} width="1080" height="1350" loading="lazy" decoding="async" />
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
	return <section className="rl-prizes"><div className="rl-panel-head"><span className="rl-eyebrow"><Award size={16} /> Premiação oficial</span><h2>O que sua equipe leva pra casa</h2></div><div className="rl-prize-grid">{PRIZES.map(prize => <PrizeCard key={prize.place} prize={prize} />)}</div></section>;
}

/* Fecha a hierarquia da página: depois de ler sobre o torneio e preencher a
   inscrição, o último passo é abrir o regulamento oficial. */
function RegulationAccess() {
	return <section className="rl-regulation-cta"><div><FileText size={22} /><span><strong>Leia o regulamento oficial</strong><small>Elegibilidade, formato e premiações, em detalhe.</small></span></div><a href="/torneio-rocket-league/regulamento">Abrir regulamento <ExternalLink size={16} /></a></section>;
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
	return <section className="rl-form-card" id="inscricao"><div className="rl-panel-head"><span className="rl-eyebrow"><Users size={16} /> Inscrição da equipe</span><h2>Dados para a inscrição</h2><p>Os dois titulares são obrigatórios; o reserva não altera o valor.</p></div>{closed ? <div className="rl-alert"><AlertCircle size={18} /> As inscrições foram encerradas.</div> : <form onSubmit={submit} noValidate><Field label="Nome da equipe" error={errors.nomeEquipe}><input value={draft.nomeEquipe} onChange={e => setDraft(prev => ({ ...prev, nomeEquipe: e.target.value }))} maxLength="70" disabled={sending} placeholder="Nome que aparecerá na tabela" /></Field><PlayerFields index={0} player={draft.jogadores[0]} onChange={changePlayer} errors={errors['jogadores.0']} disabled={sending} /><PlayerFields index={1} player={draft.jogadores[1]} onChange={changePlayer} errors={errors['jogadores.1']} disabled={sending} /><label className="rl-toggle"><input type="checkbox" checked={draft.temReserva} onChange={e => setDraft(prev => ({ ...prev, temReserva: e.target.checked }))} disabled={sending} /><span><strong>Adicionar jogador reserva</strong><small>Opcional e sem custo adicional.</small></span></label>{draft.temReserva && <PlayerFields index={2} player={draft.jogadores[2]} onChange={changePlayer} errors={errors['jogadores.2']} disabled={sending} />}<fieldset className="rl-captain"><legend>Capitão da equipe</legend><p>Usaremos estes contatos exclusivamente para comunicações sobre a inscrição.</p><div className="rl-fields-grid"><Field label="Nome completo" error={errors['capitao.nome']}><input value={draft.capitao.nome} onChange={e => setDraft(prev => ({ ...prev, capitao: { ...prev.capitao, nome: e.target.value } }))} disabled={sending} autoComplete="name" /></Field><Field label="WhatsApp" error={errors['capitao.whatsapp']}><input value={draft.capitao.whatsapp} onChange={e => setDraft(prev => ({ ...prev, capitao: { ...prev.capitao, whatsapp: formatPhone(e.target.value) } }))} disabled={sending} inputMode="tel" autoComplete="tel" /></Field><Field label="E-mail" error={errors['capitao.email']}><input value={draft.capitao.email} onChange={e => setDraft(prev => ({ ...prev, capitao: { ...prev.capitao, email: e.target.value } }))} disabled={sending} type="email" autoComplete="email" /></Field></div></fieldset><label className="rl-consent"><input type="checkbox" checked={draft.aceiteRegulamento} onChange={e => setDraft(prev => ({ ...prev, aceiteRegulamento: e.target.checked }))} disabled={sending} /><span>Li e concordo com o <a href="/torneio-rocket-league/regulamento" target="_blank" rel="noreferrer">Regulamento Oficial</a> do Torneio de Rocket League da AASIAM.</span></label>{errors.aceiteRegulamento && <p className="rl-field-error" role="alert">{errors.aceiteRegulamento}</p>}{serverError && <div className="rl-alert" role="alert"><AlertCircle size={18} /> {serverError}</div>}<button className="rl-button rl-button-primary rl-pay" type="submit" disabled={sending}>{sending ? <><Loader2 className="rl-spin" size={18} /> Abrindo pagamento...</> : <>Ir para o pagamento de R$ 50,00</>}</button></form>}</section>;
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
	return <div className="rl-page"><Header /><main className="rl-main">{order ? <PaymentPanel order={order} onBack={edit} /> : <div className="rl-layout"><Hero availability={availability} onRegister={() => document.getElementById('inscricao')?.scrollIntoView({ behavior: 'smooth' })} /><About /><Prizes /><RegistrationForm draft={draft} setDraft={setDraft} availability={availability} onCheckout={checkout} /><RegulationAccess /></div>}</main><footer className="rl-footer">© 2026 AASIAM · Torneio Rocket League 2x2</footer></div>;
}
