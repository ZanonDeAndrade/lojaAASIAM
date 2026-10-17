import { SITE_DEFAULTS } from '../../../backend/shared/site-defaults.js';
import { configureCatalog } from '../shared/products.js';
import { synchronizePages } from '../../../backend/shared/page-settings.js';

export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const site = structuredClone(SITE_DEFAULTS);
export { SITE_DEFAULTS };
export function assetUrl(src) { return src?.startsWith('/api/site/media/') ? `${API_BASE}${src}` : src; }
export function imageSettings(src) { return site.media.find(item => item.src === src); }
export function imageStyle(src) {
  const media = imageSettings(src);
  if (!media) return {};
  return { objectFit: media.fit, objectPosition: media.position, transform: `scale(${media.scale})`, borderRadius: media.radius, ...(media.aspect ? { aspectRatio: media.aspect } : {}) };
}

export function tournamentInfo() {
  return site.rocket.info.map((item, index) => index === 0 ? { ...item, value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(site.rocket.registration.amountCents / 100) } : index === 1 ? { ...item, value: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(site.rocket.registration.deadline)) } : item);
}

export function configureSite(config) {
  const next = synchronizePages(config || SITE_DEFAULTS);
  for (const key of Object.keys(SITE_DEFAULTS)) site[key] = structuredClone(next[key] ?? SITE_DEFAULTS[key]);
  configureCatalog(site.store);
  const root = document.documentElement;
  const old = document.getElementById('published-site-theme');
  old?.remove();
  const style = document.createElement('style');
  style.id = 'published-site-theme';
  const tokens = palette => `--bg:${palette.background};--bg-2:${palette.panel};--panel:${palette.panel};--text:${palette.text};--text-dim:${palette.muted};--green:${palette.accent};--green-hover:${palette.accentHover};--green-bright:${palette.accent};`;
  const rocket = site.appearance.rocket;
  const barbecue = site.appearance.churrasco;
  const fonts = { Archivo: 'Archivo', Arial: 'Arial', Georgia: 'Georgia', system: 'system-ui' };
  style.textContent = `:root,.light{${tokens(site.appearance.light)}}.dark{${tokens(site.appearance.dark)}}:root{--font:${fonts[site.appearance.font] || 'Archivo'},sans-serif;--r-lg:${Number(site.appearance.radius) || 22}px}.rl-page{--rl-bg:${rocket.background};--rl-panel:${rocket.panel};--rl-text:${rocket.text};--rl-text-dim:${rocket.muted};--rl-green:${rocket.accent};--rl-green-soft:${rocket.accent};--rl-green-hover:${rocket.accent};--rl-r-lg:${Number(site.appearance.radius) || 22}px;font-family:var(--font)}.ch-page{--ch-carvao:${barbecue.background};--ch-panel:${barbecue.panel};--ch-osso:${barbecue.text};--ch-fumaca:${barbecue.muted};--ch-neon:${barbecue.accent};font-family:var(--font)}`;
  document.head.append(style);
  document.title = site.brand.title;
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.append(meta); }
  meta.content = site.brand.description;
  root.classList.toggle('dark', site.appearance.defaultTheme === 'dark');
}
