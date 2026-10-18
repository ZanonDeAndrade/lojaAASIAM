import crypto from 'node:crypto';
import express from 'express';
import { promisify } from 'node:util';
import { rateLimit } from './rate-limit.js';
import { createSiteStore } from './site-store.js';
import { validateSiteConfig } from './shared/site-validation.js';
import { applySiteCommerce } from './site-commerce.js';
import { synchronizePages } from './shared/page-settings.js';

const scrypt = promisify(crypto.scrypt);
const digest = value => crypto.createHash('sha256').update(String(value)).digest();
const equal = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
const SESSION_MS = 4 * 60 * 60 * 1000;

export function registerSiteAdmin(app, { store = createSiteStore(), password = process.env.ADMIN_PASSWORD, username = process.env.ADMIN_USERNAME || 'admin', apply = applySiteCommerce } = {}) {
  const sessions = new Map();
  const mediaCache = new Map();
  const mediaReads = new Map();
  let mediaCacheBytes = 0;
  function rememberMedia(id, media) {
    if (mediaCache.has(id)) mediaCacheBytes -= mediaCache.get(id).bytes.length;
    mediaCache.delete(id);
    mediaCache.set(id, media);
    mediaCacheBytes += media.bytes.length;
    while (mediaCacheBytes > 24 * 1024 * 1024) {
      const oldest = mediaCache.keys().next().value;
      mediaCacheBytes -= mediaCache.get(oldest).bytes.length;
      mediaCache.delete(oldest);
    }
    return media;
  }
  const salt = crypto.randomBytes(32);
  const enabled = typeof password === 'string' && password.length > 0;
  const expected = scrypt(enabled ? password : crypto.randomBytes(32).toString('hex'), salt, 64);
  let cached;
  let cacheUntil = 0;
  let queue = Promise.resolve();
  let loading;
  async function load(force = false) {
    if (!force && cached && Date.now() < cacheUntil) return cached;
    if (!loading) loading = store.readConfig().then(doc => { if (doc.config) doc = { ...doc, config: synchronizePages(doc.config) }; cached = doc; cacheUntil = Date.now() + 10000; apply(doc.config); return doc; }).finally(() => { loading = null; });
    return loading;
  }
  // As regras de preço/abertura também são carregadas antes dos checkouts.
  app.use('/api', async (req, res, next) => {
    if (req.path.startsWith('/admin') || req.path.startsWith('/site') || (!req.path.includes('/checkout') && !req.path.endsWith('/availability') && !req.path.endsWith('/config'))) return next();
    try { await load(); next(); } catch { res.status(503).json({ ok: false, error: 'Não foi possível carregar a configuração do site. Tente novamente.' }); }
  });
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex, nofollow, noarchive'); next(); });
  router.post('/login', rateLimit({ windowMs: 15 * 60000, max: 10, keyFrom: req => req.ip }), async (req, res) => {
    if (!enabled) return res.status(503).json({ ok: false, error: 'Acesso administrativo ainda não configurado no servidor.' });
    const candidate = typeof req.body?.password === 'string' ? req.body.password.slice(0, 1024) : '';
    const actual = await scrypt(candidate, salt, 64);
    if (!crypto.timingSafeEqual(actual, await expected) || !equal(req.body?.username, username)) return res.status(401).json({ ok: false, error: 'Usuário ou senha inválidos.' });
    for (const [key, session] of sessions) if (session.expiresAt <= Date.now()) sessions.delete(key);
    if (sessions.size >= 50) sessions.delete(sessions.keys().next().value);
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_MS;
    sessions.set(digest(token).toString('hex'), { expiresAt });
    res.json({ ok: true, token, expiresAt });
  });
  router.use((req, res, next) => {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') || '')?.[1];
    const key = digest(token || '').toString('hex');
    const session = sessions.get(key);
    if (!session || session.expiresAt <= Date.now()) { sessions.delete(key); return res.status(401).json({ ok: false, error: 'Faça login para acessar o painel.' }); }
    req.adminSession = key;
    next();
  });
  router.post('/logout', (req, res) => { sessions.delete(req.adminSession); res.json({ ok: true }); });
  router.get('/config', async (_req, res) => {
    try { res.json({ ok: true, ...await load(true), storage: store.kind }); }
    catch { res.status(503).json({ ok: false, error: 'Não foi possível ler as configurações salvas.' }); }
  });
  router.post('/config', (req, res) => {
    const task = async () => {
      const error = validateSiteConfig(req.body?.config);
      if (error) return res.status(400).json({ ok: false, error });
      try {
        const previous = await load(true);
        if (req.body.revision !== previous.revision) return res.status(409).json({ ok: false, error: 'Outra edição foi publicada. Recarregue as configurações antes de salvar.' });
        const document = { revision: previous.revision + 1, updatedAt: new Date().toISOString(), config: synchronizePages(req.body.config) };
        await store.writeConfig(document);
        cached = document;
        cacheUntil = Date.now() + 10000;
        apply(document.config);
        res.json({ ok: true, ...document });
      } catch { res.status(503).json({ ok: false, error: 'Não foi possível salvar. Suas alterações continuam no editor; tente novamente.' }); }
    };
    queue = queue.then(task, task);
  });
  router.post('/media', rateLimit({ windowMs: 60000, max: 15, keyFrom: req => req.ip }), async (req, res) => {
    const mime = req.body?.mime;
    const data = req.body?.base64;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime) || typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return res.status(400).json({ ok: false, error: 'Envie uma imagem PNG, JPEG, WebP ou GIF.' });
    const bytes = Buffer.from(data, 'base64');
    const matches = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : mime === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString()) : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!matches || bytes.length > 3 * 1024 * 1024) return res.status(400).json({ ok: false, error: 'Imagem inválida ou maior que 3 MB.' });
    try {
      const id = crypto.randomBytes(20).toString('hex');
      await store.writeMedia(id, mime, bytes);
      rememberMedia(id, { mime, bytes });
      res.json({ ok: true, url: `/api/site/media/${id}` });
    } catch { res.status(503).json({ ok: false, error: 'Não foi possível enviar a imagem.' }); }
  });
  app.use('/api/admin', router);
  app.get('/api/site/config', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json({ ok: true, ...await load() }); }
    catch { res.status(503).json({ ok: false, error: 'Configuração temporariamente indisponível.' }); }
  });
  app.get('/api/site/media/:id', async (req, res) => {
    if (!/^[a-f0-9]{40}$/.test(req.params.id)) return res.sendStatus(404);
    try {
      const id = req.params.id;
      let media = mediaCache.get(id);
      if (!media) {
        if (!mediaReads.has(id)) mediaReads.set(id, store.readMedia(id).then(found => found ? rememberMedia(id, found) : null).finally(() => mediaReads.delete(id)));
        media = await mediaReads.get(id);
      }
      if (!media) return res.sendStatus(404);
      res.set({ 'Content-Type': media.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.send(media.bytes);
    } catch { res.sendStatus(503); }
  });
  return { load, router };
}
