/**
 * Rate limit em memória — suficiente para uma API de instância única.
 *
 * A chave padrão é `req.ip`. O Express calcula esse IP a partir do
 * X-Forwarded-For confiando só nos saltos de proxy configurados em
 * `trust proxy` (TRUST_PROXY_HOPS, em index.js). O cabeçalho nunca é lido
 * direto aqui: o primeiro valor dele é escrito pelo próprio cliente.
 *
 * Guarda só um contador por chave dentro de uma janela, no máximo
 * `MAX_KEYS` chaves por limitador (descarta as mais antigas). Nada de dados
 * pessoais e nada persistido.
 *
 * Válvula de escape: RATE_LIMIT_DISABLED=true desliga todos os limitadores
 * (por exemplo, se o número de saltos do proxy estiver errado e bloquear
 * gente demais). Um aviso vai para o log.
 */

const MAX_KEYS = 10_000;
const MAX_KEY_LENGTH = 200;

/** IP do cliente como o Express o calcula (respeita `trust proxy`). */
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "desconhecido";
}

let avisoDesligado = false;
/** true quando RATE_LIMIT_DISABLED=true; avisa no log na primeira vez. */
export function rateLimitDisabled() {
  const desligado = process.env.RATE_LIMIT_DISABLED === "true";
  if (desligado && !avisoDesligado) {
    avisoDesligado = true;
    console.warn("[RateLimit] ⚠ RATE_LIMIT_DISABLED=true — todos os limites de requisições estão DESLIGADOS.");
  }
  return desligado;
}

/** Todas as janelas ativas — só para `__resetRateLimits()` nos testes. */
const _janelas = [];

/** Zera todos os contadores. TEST-ONLY: nunca chamado em produção. */
export function __resetRateLimits() {
  for (const hits of _janelas) hits.clear();
}

function chave(keyFrom, req) {
  return String(keyFrom(req) ?? "").slice(0, MAX_KEY_LENGTH);
}

/** Contadores por chave numa janela fixa, com teto de chaves. */
function criarJanela(windowMs) {
  const hits = new Map(); // chave → { count, resetAt }
  _janelas.push(hits);

  function atual(key, now) {
    const entry = hits.get(key);
    if (entry && entry.resetAt > now) return entry;
    if (entry) hits.delete(key);
    return null;
  }

  return {
    atual,
    contar(key, now) {
      let entry = atual(key, now);
      if (!entry) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
        // Map guarda a ordem de inserção: as primeiras chaves são as mais antigas.
        while (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value);
      }
      entry.count += 1;
      return entry;
    },
    apagar(key) {
      hits.delete(key);
    },
  };
}

/**
 * Devolve um middleware Express que recusa com 429 depois de `max`
 * requisições dentro de `windowMs`.
 */
export function rateLimit({ windowMs, max, message, keyFrom = clientIp }) {
  const janela = criarJanela(windowMs);

  return function limiter(req, res, next) {
    if (rateLimitDisabled()) return next();
    const now = Date.now();
    const entry = janela.contar(chave(keyFrom, req), now);
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        ok: false,
        error: message || "Muitas tentativas seguidas. Aguarde um instante e tente de novo.",
      });
    }
    return next();
  };
}

/**
 * Limite de TENTATIVAS ERRADAS (login): só as falhas contam, e um acerto zera
 * a contagem daquela chave. `bloqueado(req)` devolve os segundos que faltam
 * para liberar, ou 0.
 */
export function attemptLimiter({ windowMs, max, keyFrom = clientIp }) {
  const janela = criarJanela(windowMs);
  return {
    bloqueado(req) {
      if (rateLimitDisabled()) return 0;
      const now = Date.now();
      const entry = janela.atual(chave(keyFrom, req), now);
      return entry && entry.count >= max ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 0;
    },
    falhou(req) {
      if (!rateLimitDisabled()) janela.contar(chave(keyFrom, req), Date.now());
    },
    acertou(req) {
      janela.apagar(chave(keyFrom, req));
    },
  };
}

export { clientIp };
