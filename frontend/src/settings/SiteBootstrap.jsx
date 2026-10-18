import { useEffect, useState } from 'react';
import App from '../App.jsx';
import { API_BASE, configureSite } from './site.js';
import { validateSiteConfig } from '../../../backend/shared/site-validation.js';

export default function SiteBootstrap() {
  const preview = new URLSearchParams(location.search).get('admin-preview') === '1' && window.parent !== window;
  const [version, setVersion] = useState(null);
  useEffect(() => {
    if (preview) {
      // A prévia vive em um iframe separado e nunca cria pedidos ou pagamentos.
      const originalFetch = window.fetch;
      window.fetch = (input, options = {}) => {
        const method = String(options.method || input?.method || 'GET').toUpperCase();
        if (!['GET', 'HEAD'].includes(method)) return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'A prévia não realiza inscrições ou compras.' }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
        return originalFetch(input, options);
      };
      function navigate(event) {
        const anchor = event.target.closest?.('a[href]');
        if (!anchor || anchor.hasAttribute('download')) return;
        const url = new URL(anchor.href, location.href);
        if (url.origin !== location.origin) { event.preventDefault(); return; }
        if (url.pathname.endsWith('.pdf') || url.pathname.startsWith('/assets/')) return;
        url.searchParams.set('admin-preview', '1');
        event.preventDefault();
        location.assign(url.href);
      }
      function receive(event) {
        if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'aasiam-admin-preview' || validateSiteConfig(event.data.config)) return;
        configureSite(event.data.config);
        setVersion(Date.now());
      }
      window.addEventListener('message', receive);
      document.addEventListener('click', navigate);
      window.parent.postMessage({ type: 'aasiam-preview-ready' }, location.origin);
      return () => { window.removeEventListener('message', receive); document.removeEventListener('click', navigate); window.fetch = originalFetch; };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let active = true;
    fetch(`${API_BASE}/api/site/config`, { signal: controller.signal, cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => { if (active) configureSite(data.config && !validateSiteConfig(data.config) ? data.config : null); })
      .catch(() => { if (active) configureSite(null); })
      .finally(() => { clearTimeout(timeout); if (active) setVersion(0); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [preview]);
  return version === null ? <div role="status" style={{ padding: 40 }}>Carregando…</div> : <App key={version} preview={preview} />;
}
