import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import crypto from 'node:crypto';
import type { Db } from '../db/index.js';

export type AuthedUser = { id: number; uuid: string; email: string; username: string; isAdmin: boolean; status: string; expiresAt: Date | null; graceUntil: Date | null };

function sha256Hex(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function authMiddleware(db: Db) {
  return async (c: Context, next: Next) => {
    let user: AuthedUser | null = null;
    const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (bearer && bearer.length >= 16) {
      const prefix = bearer.slice(0, 8);
      try {
        const { apiKeys, users } = await import('../db/schema.js');
        const { eq } = await import('drizzle-orm');
        const rows = await db.select().from(apiKeys).where(eq(apiKeys.prefix, prefix)).limit(50);
        const hash = sha256Hex(bearer);
        const hit = rows.find((k) => k.hash === hash);
        if (hit) {
          await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, hit.id));
          const u = await db.select().from(users).where(eq(users.id, hit.userId)).limit(1);
          if (u[0]) user = { id: u[0].id, uuid: u[0].uuid, email: u[0].email, username: u[0].username, isAdmin: u[0].isAdmin, status: u[0].status, expiresAt: u[0].expiresAt, graceUntil: u[0].graceUntil };
        }
      } catch {}
    }
    if (!user) {
      const sid = getCookie(c, 'lunix_sid');
      if (sid && /^[a-f0-9]{32}$/.test(sid)) {
        try {
          const { sessions, users } = await import('../db/schema.js');
          const { eq } = await import('drizzle-orm');
          const s = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1);
          const sess = s[0];
          if (sess && new Date(sess.expiresAt) > new Date()) {
            const u = await db.select().from(users).where(eq(users.id, sess.userId)).limit(1);
            if (u[0]) user = { id: u[0].id, uuid: u[0].uuid, email: u[0].email, username: u[0].username, isAdmin: u[0].isAdmin, status: u[0].status, expiresAt: u[0].expiresAt, graceUntil: u[0].graceUntil };
          } else if (sess) {
            await db.delete(sessions).where(eq(sessions.id, sid));
          }
        } catch {}
      }
    }
    if (user) (c as unknown as { set: (k: string, v: unknown) => void }).set('user', user);
    await next();
  };
}

function getUser(c: Context): AuthedUser | undefined {
  return (c as unknown as { get: (k: string) => unknown }).get('user') as AuthedUser | undefined;
}

export async function requireAuth(c: Context, next: Next) {
  const u = getUser(c);
  if (!u) return c.json({ errors: [{ code: 'unauthorized', detail: 'Authentication required' }] }, 401);
  if (u.status === 'suspended') return c.json({ errors: [{ code: 'account_suspended', detail: 'Your QyroCloud account is suspended. Contact support to renew.' }] }, 403);
  await next();
}

export async function requireAdmin(c: Context, next: Next) {
  const u = getUser(c);
  if (!u) return c.json({ errors: [{ code: 'unauthorized', detail: 'Authentication required' }] }, 401);
  if (!u.isAdmin) return c.json({ errors: [{ code: 'forbidden', detail: 'Admin only' }] }, 403);
  await next();
}

export async function requireCsrf(c: Context, next: Next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) { await next(); return; }
  const u = getUser(c);
  if (!u) { await next(); return; }
  const bearer = c.req.header('Authorization');
  if (bearer) { await next(); return; }
  const origin = c.req.header('origin') || c.req.header('referer') || '';
  const allowed = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0 || allowed.includes('*')) { await next(); return; }
  const ok = allowed.some((a) => origin.startsWith(a));
  if (!ok && origin) return c.json({ errors: [{ code: 'csrf', detail: 'Invalid origin' }] }, 403);
  await next();
}
