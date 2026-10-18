import PageIcon from '../settings/PageIcon.jsx';
import { pageName, pageIcon, synchronizePages } from '../../../backend/shared/page-settings.js';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Eye, Gamepad2, Image, LayoutTemplate, LogOut, Menu, Palette, Save, Settings2, ShieldCheck, ShoppingBag, Trophy, Users, X } from 'lucide-react';
import { API_BASE, SITE_DEFAULTS } from '../settings/site.js';
import { validateSiteConfig } from '../../../backend/shared/site-validation.js';
import AdminEditors from './AdminEditors.jsx';
import TournamentAdmin from './TournamentAdmin.jsx';
import './admin.css';
import './admin-redesign.css';

const sections = [
  { id: 'tournament', title: 'Torneio ao vivo', icon: Trophy, description: 'Placares, classificação, mata-mata e equipes da Copa AASIAM. Cada placar é salvo na hora e aparece no site em até 20 segundos, sem precisar publicar.' },
  { id: 'brand', title: 'Identidade', icon: Settings2, description: 'Nome da marca, logo, descrição e rodapé.' },
  { id: 'appearance', title: 'Aparência', icon: Palette, description: 'Cores, fonte e arredondamento em cada página e tema.' },
  { id: 'navigation', title: 'Barra de navegação', icon: Menu, description: 'Nomes das categorias e botões de eventos, links e visibilidade.' },
  { id: 'home', title: 'Banners', icon: LayoutTemplate, description: 'Imagens, ordem, destinos e intervalo do carrossel da página inicial.' },
  { id: 'media', title: 'Ajustes de imagens', icon: Image, description: 'Adicione a URL de uma imagem usada no site para ajustar enquadramento, posição, zoom, proporção e bordas.' },
  { id: 'store', title: 'Loja e produtos', icon: ShoppingBag, description: 'Abertura da loja, preços, textos, imagens, variações e estoque. Os preços publicados também são aplicados no servidor.' },
  { id: 'page-1', title: 'Botão 1', icon: Gamepad2, description: 'Personalize o botão e todo o conteúdo da primeira página.' },
  { id: 'page-2', title: 'Botão 2', icon: Users, description: 'Personalize o botão e todo o conteúdo da segunda página.' },
];

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(null);
  const [revision, setRevision] = useState(0);
  const [active, setActive] = useState(() => { let section = new URLSearchParams(location.search).get('section'); section = ({ rocket: 'page-1', events: 'page-2', barbecue: 'page-2', torneio: 'tournament' })[section] || section; return sections.some(item => item.id === section) ? section : 'tournament'; });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [storage, setStorage] = useState('');
  const [preview, setPreview] = useState(false);
  const [previewPath, setPreviewPath] = useState('/');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const frame = useRef(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const visibleSections = sections.map(item => {
    const key = item.id === 'page-1' ? 'rocket' : item.id === 'page-2' ? 'churrasco' : null;
    return key && draft ? { ...item, title: pageName(draft, key), icon: props => <PageIcon name={pageIcon(draft, key)} {...props} /> } : item;
  });
  const section = visibleSections.find(item => item.id === active);

  useEffect(() => {
    document.title = 'Administração | AASIAM';
    document.getElementById('splash-screen')?.remove();
    const meta = document.createElement('meta'); meta.name = 'robots'; meta.content = 'noindex, nofollow, noarchive'; document.head.append(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    const handler = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  function updatePreview() {
    if (draftRef.current && !validateSiteConfig(draftRef.current)) frame.current?.contentWindow?.postMessage({ type: 'aasiam-admin-preview', config: draftRef.current }, location.origin);
  }
  useEffect(() => {
    const listener = event => { if (event.origin === location.origin && event.source === frame.current?.contentWindow && event.data?.type === 'aasiam-preview-ready') updatePreview(); };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => { const timer = setTimeout(updatePreview, 600); return () => clearTimeout(timer); }, [draft, preview]);

  async function request(path, options = {}, auth = token) {
    const response = await fetch(`${API_BASE}/api/admin${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...options.headers }, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && auth) { setToken(''); setDraft(null); setSaved(null); }
    if (!response.ok) throw new Error(data.error || 'Não foi possível conectar ao servidor. Tente novamente.');
    return data;
  }
  async function load(auth = token) {
    const data = await request('/config', {}, auth);
    const config = synchronizePages(data.config || SITE_DEFAULTS);
    setDraft(config); setSaved(structuredClone(config)); setRevision(data.revision); setStorage(data.storage); setConfirmDiscard(false);
  }
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const data = await request('/login', { method: 'POST', body: JSON.stringify({ username, password }) }, ''); setToken(data.token); setPassword(''); await load(data.token); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function publish() {
    const validation = validateSiteConfig(draft);
    if (validation) { setError(validation); return; }
    setBusy(true); setError(''); setNotice('');
    try { const data = await request('/config', { method: 'POST', body: JSON.stringify({ revision, config: draft }) }); setSaved(structuredClone(data.config)); setRevision(data.revision); setNotice('Alterações publicadas. O site já usa a nova configuração nas próximas visitas.'); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function upload(file) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 3 * 1024 * 1024) throw new Error('Escolha PNG, JPEG, WebP ou GIF com até 3 MB.');
    const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Não foi possível ler a imagem.')); reader.readAsDataURL(file); });
    return (await request('/media', { method: 'POST', body: JSON.stringify({ mime: file.type, base64 }) })).url;
  }
  async function logout() {
    setBusy(true);
    try { await request('/logout', { method: 'POST', body: '{}' }); setToken(''); setDraft(null); setSaved(null); setPreview(false); setNotice(''); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  if (!token) return <div className="adm-page adm-login-page"><main className="adm-login"><div className="adm-emblem"><ShieldCheck size={28} /></div><span className="adm-eyebrow">AASIAM · ACESSO RESTRITO</span><h1>Seu site, do seu jeito.</h1><p>Entre para administrar o conteúdo e a aparência da loja.</p><form onSubmit={login}><label className="adm-field"><span>Usuário</span><input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required /></label><label className="adm-field"><span>Senha</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className="adm-error" role="alert">{error}</p>}<button className="adm-primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar no painel'} <ArrowUpRight size={17} /></button></form><small>Área privada da administração.</small></main></div>;
  if (!draft) return <div className="adm-page adm-login-page"><div className="adm-login"><h1>Carregando configurações…</h1>{error && <p className="adm-error" role="alert">{error}</p>}<button onClick={() => { setError(''); load().catch(error => setError(error.message)); }}>Tentar novamente</button></div></div>;
  return <div className="adm-page"><aside className="adm-sidebar"><div className="adm-brand"><ShieldCheck size={22} /><div>AASIAM <span>Administração</span></div></div><span className="adm-nav-caption">CONFIGURAÇÕES DO SITE</span><nav aria-label="Configurações administrativas">{visibleSections.map(item => <button type="button" key={item.id} className={active === item.id ? 'is-active' : ''} aria-current={active === item.id ? 'page' : undefined} onClick={() => { setActive(item.id); setNotice(''); window.history.replaceState(null, '', `${location.pathname}?section=${item.id}`); window.scrollTo({ top: 0 }); }}><item.icon size={18} />{item.title}</button>)}</nav><div className="adm-sidebar-footer"><span><ShieldCheck size={14} /> Sessão protegida · 4 horas</span><button type="button" disabled={busy} onClick={() => dirty ? setConfirmDiscard('logout') : logout()}><LogOut size={16} /> Sair do painel</button></div></aside>
    <div className="adm-workspace">{(active !== 'tournament' || dirty) && <header className="adm-topbar"><div><span className={`adm-status ${dirty ? 'is-dirty' : ''}`} />{dirty ? 'Alterações não publicadas' : 'Tudo publicado'}<small>{dirty ? 'Confira a prévia e publique quando estiver pronto.' : 'As configurações estão sincronizadas.'}</small></div><div className="adm-top-actions"><button type="button" onClick={() => setPreview(true)}><Eye size={16} /> Prévia do site</button><button type="button" className="adm-primary" disabled={busy || !dirty} onClick={publish}><Save size={16} />{busy ? 'Publicando…' : 'Publicar alterações'}</button></div></header>}
      <main className="adm-main"><div className="adm-page-heading"><span className="adm-eyebrow">SEU SITE, DO SEU JEITO</span><h1>{section.title}</h1><p>{section.description}</p></div>
        {error && <div className="adm-feedback adm-error" role="alert">{error}<button aria-label="Fechar erro" onClick={() => setError('')}><X size={16} /></button></div>}{notice && <div className="adm-feedback adm-success" role="status"><Check size={17} />{notice}</div>}
        <div className="adm-editor adm-editor-workspace" key={active}>{active === 'tournament' ? <TournamentAdmin request={request} /> : <AdminEditors onConfigChange={next => { setDraft(synchronizePages(next)); setNotice(''); }} section={active} value={draft[active]} config={draft} upload={upload} onChange={value => { setDraft(current => synchronizePages({ ...current, [active]: value })); setNotice(''); }} />}</div>
        {active !== 'tournament' && <div className="adm-bottom-actions"><p>As alterações só entram no site depois de publicar.</p><button type="button" disabled={busy || !dirty} onClick={() => setConfirmDiscard('reload')}>Descartar alterações</button></div>}
      </main></div>
    {confirmDiscard && <div className="adm-overlay"><div className="adm-confirm" role="alertdialog" aria-modal="true" aria-labelledby="adm-discard-title"><h2 id="adm-discard-title">Descartar alterações?</h2><p>As alterações ainda não publicadas serão perdidas.</p><div><button onClick={() => setConfirmDiscard(false)}>Continuar editando</button><button className="adm-primary" onClick={() => { const action = confirmDiscard; setConfirmDiscard(false); if (action === 'logout') logout(); else load().catch(error => setError(error.message)); }}>Descartar e continuar</button></div></div></div>}
    {preview && <div className="adm-preview" role="dialog" aria-modal="true" aria-label="Prévia do site"><header><strong><Eye size={17} /> Prévia das alterações</strong><select aria-label="Página da prévia" value={previewPath} onChange={event => setPreviewPath(event.target.value)}><option value="/">Loja</option><option value={draft.navigation.rocket.href}>{draft.navigation.rocket.label || 'Botão 1'}</option><option value="/torneio-rocket-league/regulamento">Regulamento</option><option value={draft.navigation.churrasco.href}>{draft.navigation.churrasco.label || 'Botão 2'}</option><option value="/churrasco">Outra página de evento</option></select><button type="button" onClick={() => setPreview(false)} aria-label="Fechar prévia"><X size={20} /></button></header>{validateSiteConfig(draft) && <p className="adm-error">Corrija os campos para atualizar a prévia: {validateSiteConfig(draft)}</p>}<iframe ref={frame} key={previewPath} src={`${previewPath}?admin-preview=1`} title="Prévia do site antes de publicar" /></div>}
  </div>;
}
