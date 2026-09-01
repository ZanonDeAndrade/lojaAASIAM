/**
 * Rate limit em memória — suficiente para uma API de instância única.
 *
 * Guarda só um contador por chave (normalmente o IP) dentro de uma janela
 * deslizante. Nada de dados pessoais e nada persistido.
 */

/** Um IP por trás do proxy do Render chega em `x-forwarded-for`. */
function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "desconhecido";
}

/**
 * Devolve um middleware Express que recusa com 429 depois de `max`
 * requisições dentro de `windowMs`.
 */
export function rateLimit({ windowMs, max, message, keyFrom = clientIp }) {
  const hits = new Map(); // chave → { count, resetAt }

  function prune(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return function limiter(req, res, next) {
    const now = Date.now();
    if (hits.size > 5000) prune(now);

    const key = keyFrom(req);
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
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

export { clientIp };
