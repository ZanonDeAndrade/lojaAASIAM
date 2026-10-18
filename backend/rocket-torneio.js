import { createSiteStore } from './site-store.js';
import { normalizeTournament, updateQuarters, updateResult, updateTeams, updateTiebreak } from './shared/rocket-tournament.js';

// Placar ao vivo da Copa AASIAM. A leitura é pública e leve (a página consulta
// a cada ~20 s); as alterações usam a mesma sessão do painel /admin.
export function registerRocketTournament(app, { adminRouter, store = createSiteStore() }) {
  let cached;
  let cacheUntil = 0;
  let loading;
  let queue = Promise.resolve();
  async function load(force = false) {
    if (!force && cached && Date.now() < cacheUntil) return cached;
    if (!loading) loading = store.readTournament().then(doc => { cached = normalizeTournament(doc); cacheUntil = Date.now() + 5000; return cached; }).finally(() => { loading = null; });
    try { return await loading; }
    catch (error) { if (!force && cached) return cached; throw error; }
  }

  app.get('/api/rocket-league/torneio', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json({ ok: true, torneio: await load() }); }
    catch { res.status(503).json({ ok: false, error: 'Placar temporariamente indisponível.' }); }
  });

  adminRouter.get('/torneio', async (_req, res) => {
    try { res.json({ ok: true, torneio: await load(true) }); }
    catch { res.status(503).json({ ok: false, error: 'Não foi possível ler os placares salvos.' }); }
  });

  // Cada alteração relê o documento salvo, aplica só a sua parte e grava em
  // fila: dois organizadores lançando placares ao mesmo tempo não se apagam.
  function change(apply) {
    return (req, res) => {
      const task = async () => {
        try {
          const current = await load(true);
          const result = apply(current, req);
          if (result.error) return res.status(400).json({ ok: false, error: result.error });
          const document = { ...result.state, revision: current.revision + 1, updatedAt: new Date().toISOString() };
          await store.writeTournament(document);
          cached = document;
          cacheUntil = Date.now() + 5000;
          res.json({ ok: true, torneio: document });
        } catch { res.status(503).json({ ok: false, error: 'Não foi possível salvar. Confira a conexão e tente novamente.' }); }
      };
      queue = queue.then(task, task);
    };
  }
  adminRouter.post('/torneio/partidas/:id', change((state, req) => updateResult(state, req.params.id, req.body)));
  adminRouter.post('/torneio/equipes', change((state, req) => updateTeams(state, req.body)));
  adminRouter.post('/torneio/mata-mata', change((state, req) => updateQuarters(state, req.body)));
  adminRouter.post('/torneio/desempate', change((state, req) => updateTiebreak(state, req.body)));
  return { load };
}
