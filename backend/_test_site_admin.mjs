import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { registerSiteAdmin } from './site-admin.js';
import { createSiteStore } from './site-store.js';
import { SITE_DEFAULTS } from './shared/site-defaults.js';
import { validateSiteConfig } from './shared/site-validation.js';
import { PRODUCT_BY_ID, LOJA_ENCERRADA } from './shared/products.js';
import { rocketRules } from './shared/site-rules.js';
import { pageSettings, synchronizePages } from './shared/page-settings.js';

const directory = await mkdtemp(path.join(tmpdir(), 'aasiam-admin-test-'));
const store = createSiteStore({ directory, sheets: false });
const password = 'admin';
const app = express();
app.use(express.json({ limit: '5mb' }));
registerSiteAdmin(app, { store, password });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const mediaIds = [];
async function call(url, { token, body, method = body ? 'POST' : 'GET' } = {}) {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, headers: response.headers, data: await response.json().catch(() => null) };
}
let passed = 0;
function check(condition) { assert.ok(condition); passed++; }
try {
  check(validateSiteConfig(SITE_DEFAULTS) === null);
  check((await call('/api/admin/config')).status === 401);
  check((await call('/api/admin/config', { body: { config: SITE_DEFAULTS, revision: 0 } })).status === 401);
  check((await call('/api/admin/media', { body: { mime: 'image/png', base64: 'AAAA' } })).status === 401);
  check((await call('/api/admin/login', { body: { username: 'admin', password: 'errada' } })).status === 401);
  const login = await call('/api/admin/login', { body: { username: 'admin', password } });
  const token = login.data.token;
  check(login.status === 200 && token.length === 43);
  check(login.headers.get('cache-control') === 'no-store');
  const initial = await call('/api/admin/config', { token });
  check(initial.data.revision === 0 && initial.data.config === null);
  const config = structuredClone(SITE_DEFAULTS);
  config.brand.name = 'Marca de teste';
  config.navigation.rocket.label = 'Copa de teste';
  config.navigation.rocket.icon = 'music';
  config.navigation.churrasco.label = 'Feira de teste';
  config.navigation.churrasco.icon = 'calendar';
  config.navigation.rocket.page = { ...pageSettings(config, 'rocket'), mode: 'custom', subtitle: 'Uma página sobre qualquer assunto', sections: [{ id: 'secao-teste', title: 'Nosso encontro', text: 'Conteúdo livre', image: '', imageAlt: '', buttonLabel: 'Participar', buttonHref: '/contato', visible: true }] };
  const synchronized = synchronizePages(config);
  check(synchronized.rocket.title === 'Copa de teste' && synchronized.events['semana-si-2026'].titulo === 'Feira de teste');
  check(config.rocket.title === SITE_DEFAULTS.rocket.title);
  check(synchronized.home.banners.find(banner => banner.id === 'torneio-rocket-league').titulo === 'Copa de teste');
  config.store.closed = false;
  config.store.products[0].priceCents = 12345;
  config.rocket.registration.amountCents = 6000;
  check((await call('/api/admin/config', { token, body: { revision: 0, config } })).status === 200);
  check(PRODUCT_BY_ID[config.store.products[0].id].priceCents === 12345 && LOJA_ENCERRADA === false && rocketRules.amountCents === 6000);
  check((await store.readConfig()).config.brand.name === 'Marca de teste');
  check((await createSiteStore({ directory, sheets: false }).readConfig()).revision === 1);
  const publicConfig = await call('/api/site/config');
  check(publicConfig.data.config.navigation.rocket.label === 'Copa de teste');
  check(publicConfig.data.config.rocket.title === 'Copa de teste' && publicConfig.data.config.navigation.rocket.icon === 'music');
  check(publicConfig.data.config.events['semana-si-2026'].tituloDaAba.includes('Feira de teste'));
  check(publicConfig.data.config.navigation.rocket.page.sections[0].text === 'Conteúdo livre');
  check(!JSON.stringify(publicConfig.data).includes(password) && !JSON.stringify(publicConfig.data).includes(token));
  check((await call('/api/admin/config', { token, body: { revision: 0, config } })).status === 409);
  const bad = structuredClone(config); bad.navigation.rocket.href = 'javascript:alert(1)';
  check((await call('/api/admin/config', { token, body: { revision: 1, config: bad } })).status === 400);
  const badColor = structuredClone(config); badColor.appearance.dark.text = 'red; } body{display:none}';
  check(validateSiteConfig(badColor) !== null);
  const missingPrice = structuredClone(config); delete missingPrice.store.products[0].priceCents;
  check(validateSiteConfig(missingPrice) !== null);
  const badSchedule = structuredClone(config); badSchedule.rocket.schedule.day = 15;
  check(validateSiteConfig(badSchedule) !== null);
  const badIcon = structuredClone(config); badIcon.navigation.rocket.icon = 'icone-inexistente';
  check(validateSiteConfig(badIcon) !== null);
  const unsafeSection = structuredClone(config); unsafeSection.navigation.rocket.page.sections[0].buttonHref = 'javascript:alert(1)';
  check(validateSiteConfig(unsafeSection) !== null);
  check((await call('/api/admin/media', { token, body: { mime: 'image/svg+xml', base64: 'AAAA' } })).status === 400);
  check((await call('/api/admin/media', { token, body: { mime: 'image/png', base64: 'AAAA' } })).status === 400);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4l8AAAAASUVORK5CYII=';
  const upload = await call('/api/admin/media', { token, body: { mime: 'image/png', base64: png } });
  check(upload.status === 200);
  mediaIds.push(upload.data.url.split('/').at(-1));
  const image = await fetch(base + upload.data.url);
  check(image.status === 200 && image.headers.get('content-type').startsWith('image/png'));
  check(Buffer.from(await image.arrayBuffer()).equals(Buffer.from(png, 'base64')));
  check((await call('/api/admin/logout', { token, body: {} })).status === 200);
  check((await call('/api/admin/config', { token })).status === 401);
  const app2 = express(); app2.use(express.json()); registerSiteAdmin(app2, { store, password: '' });
  const server2 = app2.listen(0, '127.0.0.1'); await once(server2, 'listening');
  try { check((await fetch(`http://127.0.0.1:${server2.address().port}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) })).status === 503); }
  finally { await new Promise(resolve => server2.close(resolve)); }
  for (let i = 0; i < 8; i++) await call('/api/admin/login', { body: { username: 'admin', password: 'errada' } });
  check((await call('/api/admin/login', { body: { username: 'admin', password: 'errada' } })).status === 429);
  const table = new Map();
  const fakeSheets = { spreadsheets: {
    get: async () => ({ data: { sheets: ['Site Config', 'Site Midia'].map(title => ({ properties: { title } })) } }),
    values: {
      get: async ({ range }) => ({ data: { values: table.get(range.includes('Site Config') ? 'config' : 'media') || [] } }),
      update: async ({ requestBody }) => { table.set('config', requestBody.values); },
      append: async ({ requestBody }) => { table.set('media', [...(table.get('media') || []), ...requestBody.values]); },
    },
  } };
  const sheetsStore = createSiteStore({ sheets: true, sheetsClient: fakeSheets });
  const largeDocument = { revision: 7, config: { text: 'á'.repeat(70000) } };
  await sheetsStore.writeConfig(largeDocument);
  check(table.get('config').length === 20 && table.get('config').every(row => row[0].length <= 30000));
  check(JSON.stringify(await sheetsStore.readConfig()) === JSON.stringify(largeDocument));
  await sheetsStore.writeConfig({ revision: 8, config: null });
  check((await sheetsStore.readConfig()).revision === 8 && (await sheetsStore.readConfig()).config === null);
  await sheetsStore.writeMedia('test-media', 'image/png', Buffer.from(png, 'base64'));
  check((await sheetsStore.readMedia('test-media')).bytes.equals(Buffer.from(png, 'base64')));
  console.log(`Admin: ${passed} verificações passaram (autenticação, autorização, publicação, conflito, persistência, preços e imagens).`);
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(path.join(directory, 'config.json'), { force: true });
  for (const id of mediaIds) await rm(path.join(directory, `${id}.json`), { force: true });
  await rmdir(directory);
}
