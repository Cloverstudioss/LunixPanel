import type { Context, Next } from 'hono';

type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

export function rateLimit({ windowMs, max, keyPrefix = 'rl' }: { windowMs: number; max: number; keyPrefix?: string }) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || c.req.header('cf-connecting-ip') || 'unknown';
    const key = `${keyPrefix}:${ip}:${c.req.path}`;
    const now = Date.now();
    let b = store.get(key);
    if (!b || now > b.resetAt) b = { count: 0, resetAt: now + windowMs };
    b.count++;
    store.set(key, b);
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - b.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));
    if (b.count > max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      c.header('Retry-After', String(retry));
      return c.json({ errors: [{ code: 'rate_limited', detail: `Too many requests. Try again in ${retry}s.` }] }, 429);
    }
    await next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of store) if (now > b.resetAt) store.delete(k);
}, 60_000).unref?.();
