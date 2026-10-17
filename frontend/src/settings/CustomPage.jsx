import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { pageIcon, pageName, pageSettings } from '../../../backend/shared/page-settings.js';
import { site } from './site.js';
import SiteImage from './SiteImage.jsx';
import PageIcon from './PageIcon.jsx';
import './custom-page.css';

export function PageSections({ pageKey, includeDescription = false }) {
  const page = pageSettings(site, pageKey);
  const palette = site.appearance[pageKey];
  return <div style={{ '--page-panel': palette.panel, '--page-muted': palette.muted, '--page-accent': palette.accent }}>{includeDescription && page.description && <section className="custom-page-block"><p>{page.description}</p></section>}{page.sections.filter(section => section.visible !== false).map(section => <section className="custom-page-block" key={section.id}>{section.image && <SiteImage src={section.image} alt={section.imageAlt || section.title || ''} />}{section.title && <h2>{section.title}</h2>}{section.text && <p>{section.text}</p>}{section.buttonLabel && section.buttonHref && <a className="custom-page-action" href={section.buttonHref}>{section.buttonLabel}</a>}</section>)}</div>;
}

export default function CustomPage({ pageKey }) {
  const name = pageName(site, pageKey);
  const page = pageSettings(site, pageKey);
  const palette = site.appearance[pageKey];
  useEffect(() => { document.title = `${name} | ${site.brand.name}`; }, [name]);
  return <div className="custom-page" style={{ '--page-bg': palette.background, '--page-panel': palette.panel, '--page-text': palette.text, '--page-muted': palette.muted, '--page-accent': palette.accent }}>
    <header className="custom-page-header"><a href="/" className="custom-page-brand"><SiteImage src={site.brand.logo} alt="" /><strong>{site.brand.name}</strong></a><a href="/"><ArrowLeft size={16} /> Voltar à loja</a></header>
    <main className="custom-page-main">{page.banner && <SiteImage className="custom-page-banner" src={page.banner} alt={page.bannerAlt} />}<div className="custom-page-intro"><span><PageIcon name={pageIcon(site, pageKey)} size={22} /> {site.brand.name}</span><h1>{name}</h1>{page.subtitle && <p>{page.subtitle}</p>}</div>{page.description && <section className="custom-page-block"><p>{page.description}</p></section>}
      {page.sections.filter(section => section.visible !== false).map(section => <section className="custom-page-block" key={section.id}>{section.image && <SiteImage src={section.image} alt={section.imageAlt || section.title || ''} />}{section.title && <h2>{section.title}</h2>}{section.text && <p>{section.text}</p>}{section.buttonLabel && section.buttonHref && <a className="custom-page-action" href={section.buttonHref}>{section.buttonLabel}</a>}</section>)}
    </main><footer>{site.brand.footer}</footer>
  </div>;
}
