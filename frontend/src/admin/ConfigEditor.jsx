import { useState } from 'react';
import { ImagePlus, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { assetUrl } from '../settings/site.js';

const labels = {
  name: 'Nome', description: 'Descrição', logo: 'Logo', title: 'Título', footer: 'Texto do rodapé', credits: 'Créditos',
  defaultTheme: 'Tema inicial', font: 'Fonte', radius: 'Arredondamento (px)', light: 'Modo claro', dark: 'Modo escuro', rocket: 'Torneio', churrasco: 'Churrasco',
  accent: 'Cor de destaque', accentHover: 'Destaque ao passar o mouse', background: 'Fundo', panel: 'Painéis', text: 'Texto principal', muted: 'Texto secundário',
  categories: 'Categorias', label: 'Nome do botão', href: 'Destino do link', visible: 'Visível', banners: 'Banners da página inicial', interval: 'Intervalo entre banners (ms)', showBanners: 'Exibir banners',
  titulo: 'Título', src: 'Imagem', alt: 'Descrição acessível da imagem', largura: 'Largura original (px)', altura: 'Altura original (px)', primeiroAte: 'Priorizar até (data ISO com fuso)',
  closed: 'Loja encerrada', products: 'Produtos', shortName: 'Nome curto', priceCents: 'Preço (R$)', costCents: 'Custo (R$)', tag: 'Etiqueta', images: 'Galeria de imagens', coverImage: 'Imagem de capa', coverAspect: 'Proporção da capa', soldOut: 'Esgotado', hidden: 'Ocultar produto', category: 'Categoria',
  variants: 'Variações', sizes: 'Tamanhos', swatch: 'Cor da variação', border: 'Cor da borda', includes: 'Itens inclusos', attributes: 'Atributos', options: 'Opções', pieces: 'Peças do combo', colors: 'Cores', fixedItems: 'Itens fixos', quantity: 'Quantidade',
  subtitle: 'Subtítulo', banner: 'Banner', bannerAlt: 'Descrição do banner', registerLabel: 'Texto do botão de inscrição', aboutTitle: 'Título sobre o torneio', aboutDescription: 'Descrição do torneio',
  info: 'Informações em destaque', value: 'Valor exibido', hint: 'Complemento', prizes: 'Premiação', place: 'Colocação', medal: 'Categoria da medalha', note: 'Observação', image: 'Imagem', regulation: 'Regulamento na página', regulationUrl: 'Link do PDF (vazio mantém o atual)',
  paragraphs: 'Parágrafos', items: 'Itens', list: 'Lista', callout: 'Aviso em destaque', calloutFirst: 'Exibir aviso antes dos itens', icon: 'Ícone',
  groups: 'Grupos', teams: 'Equipes', players: 'Jogadores', schedule: 'Agenda de jogos', isMock: 'Agenda demonstrativa', day: 'Data ou título do dia', timezone: 'Fuso exibido', matches: 'Confrontos', time: 'Horário', stage: 'Fase', format: 'Formato', placeholders: 'Vagas a definir',
  rounds: 'Chaveamento', sides: 'Equipes ou vagas', qualification: 'Regra de classificação', groupNote: 'Observação dos grupos', bracketNote: 'Observação do chaveamento', registrationTab: 'Nome da aba de inscrições', gamesTab: 'Nome da aba de jogos',
  subtitulo: 'Subtítulo', tituloDaAba: 'Título no navegador', data: 'Data', horario: 'Horário', local: 'Local', cardapio: 'Cardápio', dicaDoFormulario: 'Descrição da inscrição', fallback: 'Imagem', webp: 'Imagem alternativa WebP', width: 'Largura (px)', height: 'Altura (px)',
  fit: 'Enquadramento', position: 'Posição (ex.: center ou 50% 30%)', scale: 'Zoom (1 = tamanho normal)', aspect: 'Proporção (ex.: 16 / 9)',
  registration: 'Regras de inscrição', enabled: 'Inscrições habilitadas', amountCents: 'Taxa por equipe (R$)', deadline: 'Prazo final (ISO com fuso, ex.: 2026-10-17T23:59:59-03:00)',
  sections: 'Seções de conteúdo', buttonLabel: 'Texto do botão de ação', buttonHref: 'Link do botão de ação', imageAlt: 'Descrição da imagem',
};
const readOnly = new Set(['id', 'kind', 'code', 'key', 'chipLabel']);
const imageKeys = new Set(['src', 'image', 'logo', 'coverImage', 'fallback', 'webp', 'banner']);
const longKeys = new Set(['description', 'aboutDescription', 'qualification', 'paragraphs', 'text', 'note', 'callout', 'subtitle', 'subtitulo', 'groupNote', 'bracketNote', 'alt', 'bannerAlt']);
const choices = { defaultTheme: ['dark', 'light'], font: ['Archivo', 'Arial', 'Georgia', 'system'], fit: ['contain', 'cover', 'fill', 'none', 'scale-down'], icon: ['', 'Trophy', 'Medal', 'Award'], category: ['moletom', 'camiseta', 'acessorios', 'kits'], medal: ['ouro', 'prata', 'bronze'] };
const uid = prefix => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function newItem(key, example) {
  if (key === 'sections') return { id: uid('secao'), title: 'Nova seção', text: '', image: '', imageAlt: '', buttonLabel: '', buttonHref: '', visible: true };
  if (key === 'groups') return { id: uid('grupo'), teams: [] };
  if (key === 'teams') return { id: uid('equipe'), name: 'Nova equipe', players: [] };
  if (key === 'matches') return { id: uid('jogo'), time: '19:00', stage: 'Fase de grupos', format: 'Partida única', placeholders: ['Equipe a definir', 'Equipe a definir'] };
  if (key === 'banners') return { id: uid('banner'), titulo: 'Novo banner', href: '/', src: '', alt: '', largura: 1600, altura: 600, visible: true };
  if (key === 'media') return { src: '', alt: '', fit: 'contain', position: 'center', scale: 1, radius: 0, aspect: '' };
  if (typeof example === 'string' || !example) return '';
  const copy = structuredClone(example);
  if (copy.id) copy.id = uid(key);
  return copy;
}

export default function ConfigEditor({ value, onChange, upload, field = '', path = '', config, depth = 0, fixed = false }) {
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const label = labels[field] || field;
  if (value === null && field === 'banner') return <button type="button" className="adm-add" onClick={() => onChange({ src: '', alt: '', largura: 1600, altura: 600 })}><Plus size={15} /> Adicionar banner</button>;
  if (typeof value === 'boolean') return <label className="adm-toggle"><span><strong>{label}</strong></span><input type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} /></label>;
  if (typeof value === 'string' || typeof value === 'number' || value === null) {
    if (readOnly.has(field) && !(field === 'id' && /^rocket\.groups\.\d+\.id$/.test(path))) return <label className="adm-field adm-readonly"><span>{field === 'id' ? 'Identificador' : label}</span><input value={value ?? ''} readOnly /></label>;
    if (choices[field]) return <label className="adm-field"><span>{label}</span><select value={value ?? ''} onChange={event => onChange(event.target.value)}>{choices[field].map(item => <option key={item} value={item}>{item || 'Sem ícone'}</option>)}</select></label>;
    const image = imageKeys.has(field) || field === 'images';
    const number = typeof value === 'number';
    const money = /Cents$/.test(field);
    const color = typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value);
    async function send(file) {
      if (!file) return;
      setUploading(true); setUploadError('');
      try { onChange(await upload(file)); } catch (error) { setUploadError(error.message); } finally { setUploading(false); }
    }
    return <div className={`adm-field ${image ? 'adm-image-field' : ''}`}>
      <label><span>{label}</span>{longKeys.has(field) && !color ? <textarea value={value ?? ''} onChange={event => onChange(event.target.value)} rows={3} /> : <div className="adm-input-row">{color && <input aria-label={`Escolher ${label}`} type="color" value={value} onChange={event => onChange(event.target.value)} />}<input aria-label={label} type={number ? 'number' : 'text'} step={money ? '0.01' : 'any'} value={money ? value / 100 : value ?? ''} onChange={event => onChange(number ? (money ? Math.round(Number(event.target.value) * 100) : Number(event.target.value)) : event.target.value)} /></div>}</label>
      {image && <div className="adm-image-tools">{value && <img src={assetUrl(String(value).startsWith('/imgs/premio-') && !/\.[a-z]+$/i.test(value) ? `${value}.png` : value)} alt="Prévia da imagem" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} onLoad={event => { event.currentTarget.style.visibility = ''; }} />}<label className="adm-upload"><ImagePlus size={16} /> {uploading ? 'Enviando…' : 'Enviar imagem'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading} onChange={event => { send(event.target.files[0]); event.target.value = ''; }} /></label><small>PNG, JPEG, WebP ou GIF · até 3 MB</small></div>}
      {uploadError && <p className="adm-error" role="alert">{uploadError}</p>}
    </div>;
  }
  if (Array.isArray(value)) {
    const immutableList = ['products', 'categories', 'rounds'].includes(field) || path.includes('.rounds.') || field === 'sides' || field === 'placeholders';
    // IDs das equipes em confrontos são selecionados a partir dos grupos reais.
    if (field === 'teams' && path.includes('.matches')) {
      const teams = config.rocket.groups.flatMap(group => group.teams);
      return <fieldset className="adm-list"><legend>Equipes do confronto</legend>{[0, 1].map(index => <label className="adm-field" key={index}><span>Equipe {index + 1}</span><select value={value[index] || ''} onChange={event => onChange(value.map((id, i) => i === index ? event.target.value : id))}><option value="">Selecione</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>)}</fieldset>;
    }
    return <fieldset className="adm-list"><legend>{label || 'Itens'} <span>{value.length}</span></legend>{value.map((item, index) => {
      const title = typeof item === 'object' && item ? item.name || item.titulo || item.title || item.place || item.label || (field === 'groups' ? `Grupo ${item.id}` : item.stage ? `${item.time} · ${item.stage}` : item.id || `Item ${index + 1}`) : `Item ${index + 1}`;
      const content = <ConfigEditor value={item} onChange={next => onChange(value.map((entry, i) => i === index ? next : entry))} upload={upload} field={typeof item === 'object' ? '' : field} path={`${path}.${index}`} config={config} depth={depth + 1} fixed={fixed} />;
      return <div className="adm-list-item" key={`${field}-${index}`}>
        <div className="adm-item-tools"><span>{index + 1}</span>{!immutableList && <><button type="button" title="Mover para cima" aria-label={`Mover ${title} para cima`} disabled={!index} onClick={() => { const next = [...value]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }}><ChevronUp size={15} /></button><button type="button" title="Mover para baixo" aria-label={`Mover ${title} para baixo`} disabled={index === value.length - 1} onClick={() => { const next = [...value]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; onChange(next); }}><ChevronDown size={15} /></button><button type="button" title="Remover" aria-label={`Remover ${title}`} onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={15} /></button></>}</div>
        {item && typeof item === 'object' ? <details><summary>{title}</summary><div className="adm-item-content">{content}</div></details> : content}
      </div>;
    })}{!immutableList && <button type="button" className="adm-add" onClick={() => onChange([...value, newItem(field, value[0])])}><Plus size={15} /> Adicionar {label?.toLowerCase() || 'item'}</button>}</fieldset>;
  }
  return <div className={`adm-object adm-depth-${depth}`}>{Object.entries(value).map(([key, item]) => {
    if (key === 'hasHoodie' || key.startsWith('default') && key !== 'defaultTheme') return null;
    const nested = item && typeof item === 'object' && !Array.isArray(item);
    const child = <ConfigEditor field={key} value={item} onChange={next => onChange({ ...value, [key]: next })} upload={upload} path={`${path}.${key}`} config={config} depth={depth + 1} fixed={fixed} />;
    const groupLabel = ['navigation', 'appearance'].includes(path) && key === 'rocket' ? config.navigation.rocket.label || 'Botão 1' : ['navigation', 'appearance'].includes(path) && key === 'churrasco' ? config.navigation.churrasco.label || 'Botão 2' : labels[key] || key;
    return nested ? <fieldset className="adm-subsection" key={key}><legend>{groupLabel}</legend>{child}</fieldset> : <div key={key}>{child}</div>;
  })}{!fixed && path.includes('.products.') && <div className="adm-product-extra">{!('hidden' in value) && <button type="button" className="adm-add" onClick={() => onChange({ ...value, hidden: false })}>Configurar visibilidade</button>}{!('soldOut' in value) && <button type="button" className="adm-add" onClick={() => onChange({ ...value, soldOut: false })}>Configurar estoque</button>}{!('coverImage' in value) && <button type="button" className="adm-add" onClick={() => onChange({ ...value, coverImage: '' })}>Configurar capa</button>}{!('category' in value) && <button type="button" className="adm-add" onClick={() => onChange({ ...value, category: 'acessorios' })}>Configurar categoria</button>}</div>}{path.includes('.schedule.matches.') && 'placeholders' in value && <button type="button" className="adm-add" disabled={config.rocket.groups.flatMap(group => group.teams).length < 2} onClick={() => { const { placeholders, ...rest } = value; onChange({ ...rest, teams: config.rocket.groups.flatMap(group => group.teams).slice(0, 2).map(team => team.id) }); }}>Selecionar equipes cadastradas</button>}</div>;
}
