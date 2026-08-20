import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import * as OTPAuth from 'otpauth';
import { setCookie, deleteCookie } from 'hono/cookie';
import crypto from 'node:crypto';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { audit, auditIp } from '../../lib/audit.js';

function zJson<T extends z.ZodTypeAny>(s: T) {
  return validator('json', (value, c) => {
    const r = s.safeParse(value);
    if (!r.success) return c.json({ errors: [{ code: 'validation', detail: r.error.message }] }, 422);
    return r.data as z.infer<T>;
  });
}

function sha256(s: string) { return crypto.createHash('sha256').update(s).digest('hex'); }
function cookieSecure(c: { req: { header: (n: string) => string | undefined } }) {
  const forwarded = c.req.header('x-forwarded-proto');
  const isHttps = forwarded ? forwarded === 'https' : c.req.header('host')?.includes('https');
  return process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && isHttps);
}

export default function authRoutes(db: Db) {
  const app = new Hono();

  app.post('/login', zJson(z.object({ email: z.string().email(), password: z.string().min(1), code: z.string().optional() })), async (c) => {
    const { email, password, code } = c.req.valid('json' as never) as { email: string; password: string; code?: string };
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase().trim())).limit(1);
    const user = rows[0];
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      return c.json({ errors: [{ code: 'invalid_credentials', detail: 'Invalid email or password' }] }, 401);
    }
    if (user.status === 'suspended') {
      return c.json({ errors: [{ code: 'account_suspended', detail: 'Your QyroCloud account is suspended. Please contact support to renew.' }] }, 403);
    }
    if (user.totpEnabled && user.totpSecret) {
      if (!code) return c.json({ data: { need_2fa: true } }, 200);
      const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.totpSecret), digits: 6, period: 30 });
      if (totp.validate({ token: code.replace(/\s/g, ''), window: 1 }) === null) {
        return c.json({ errors: [{ code: 'invalid_2fa', detail: 'Invalid 2FA code' }] }, 401);
      }
    }
    const sid = crypto.randomBytes(16).toString('hex');
    await db.insert(schema.sessions).values({
      id: sid,
      userId: user.id,
      ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || '',
      ua: (c.req.header('user-agent') || '').slice(0, 512),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });
    await audit(db, user.id, 'auth.login', 'user', String(user.id), auditIp(c), { email: user.email });
    setCookie(c, 'lunix_sid', sid, {
      httpOnly: true,
      path: '/',
      sameSite: 'Lax',
      secure: cookieSecure(c),
      maxAge: 30 * 24 * 3600,
    });
    return c.json({ data: { id: user.id, email: user.email, username: user.username, is_admin: user.isAdmin, status: user.status } });
  });

  app.post('/logout', async (c) => {
    const sid = (c.req.header('cookie') || '').match(/lunix_sid=([a-f0-9]{32})/)?.[1];
    let userId: number | null = null;
    if (sid) {
      const sess = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sid)).limit(1);
      userId = sess[0]?.userId ?? null;
      await db.delete(schema.sessions).where(eq(schema.sessions.id, sid));
    }
    if (userId) await audit(db, userId, 'auth.logout', 'user', String(userId), auditIp(c));
    deleteCookie(c, 'lunix_sid', { path: '/', secure: cookieSecure(c), sameSite: 'Lax' });
    return c.json({ data: { ok: true } });
  });

  app.get('/me', requireAuth, async (c) => {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number; uuid: string; email: string; username: string; isAdmin: boolean; status: string; expiresAt: Date | null; graceUntil: Date | null };
    return c.json({ data: u });
  });

  app.post('/2fa/setup', requireAuth, async (c) => {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number; email: string };
    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({ issuer: 'LunixPanel', label: u.email, algorithm: 'SHA1', digits: 6, period: 30, secret });
    const existing = await db.select().from(schema.users).where(eq(schema.users.id, u.id)).limit(1);
    if (existing[0]?.totpEnabled) return c.json({ errors: [{ code: 'already_enabled', detail: '2FA already enabled. Disable first.' }] }, 409);
    await db.update(schema.users).set({ totpSecret: secret.base32 }).where(eq(schema.users.id, u.id));
    return c.json({ data: { secret: secret.base32, uri: totp.toString() } });
  });

  app.post('/2fa/enable', requireAuth, zJson(z.object({ code: z.string().min(6) })), async (c) => {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const { code } = c.req.valid('json' as never) as { code: string };
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, u.id)).limit(1);
    const row = rows[0];
    if (!row?.totpSecret) return c.json({ errors: [{ code: 'no_secret', detail: 'Run /2fa/setup first' }] }, 400);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(row.totpSecret), digits: 6, period: 30 });
    if (totp.validate({ token: code.replace(/\s/g, ''), window: 1 }) === null) return c.json({ errors: [{ code: 'invalid_2fa', detail: 'Invalid code' }] }, 401);
    await db.update(schema.users).set({ totpEnabled: true }).where(eq(schema.users.id, u.id));
    return c.json({ data: { ok: true } });
  });

  app.post('/2fa/disable', requireAuth, zJson(z.object({ code: z.string().min(6), password: z.string().min(1) })), async (c) => {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const { code, password } = c.req.valid('json' as never) as { code: string; password: string };
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, u.id)).limit(1);
    const row = rows[0];
    if (!row?.totpSecret || !row.totpEnabled) return c.json({ errors: [{ code: 'not_enabled', detail: '2FA not enabled' }] }, 400);
    if (!(await argon2.verify(row.passwordHash, password))) return c.json({ errors: [{ code: 'invalid_password', detail: 'Invalid password' }] }, 401);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(row.totpSecret), digits: 6, period: 30 });
    if (totp.validate({ token: code.replace(/\s/g, ''), window: 1 }) === null) return c.json({ errors: [{ code: 'invalid_2fa', detail: 'Invalid code' }] }, 401);
    await db.update(schema.users).set({ totpEnabled: false, totpSecret: null }).where(eq(schema.users.id, u.id));
    return c.json({ data: { ok: true } });
  });

  app.post('/api-keys', requireAuth, zJson(z.object({ name: z.string().min(1).max(191).optional() })), async (c) => {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const raw = `lunix_${crypto.randomBytes(24).toString('hex')}`;
    const prefix = raw.slice(0, 8);
    const hash = sha256(raw);
    await db.insert(schema.apiKeys).values({ userId: u.id, prefix, hash });
    return c.json({ data: { token: raw, prefix, note: 'Store this token — it will not be shown again.' } }, 201);
  });

  app.get('/api-keys', requireAuth, async (c) => {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const rows = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, u.id));
    return c.json({ data: rows.map((r) => ({ id: r.id, prefix: r.prefix, lastUsedAt: r.lastUsedAt, createdAt: r.createdAt })) });
  });

  app.delete('/api-keys/:id', requireAuth, async (c) => {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, id)).limit(1);
    if (!rows[0] || rows[0].userId !== u.id) return c.json({ errors: [{ code: 'not_found', detail: 'Key not found' }] }, 404);
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, id));
    return c.json({ data: { ok: true } });
  });

  app.post('/change-password', requireAuth, zJson(z.object({ current: z.string().min(1), next: z.string().min(8).max(128) })), async (c) => {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const { current, next } = c.req.valid('json' as never) as { current: string; next: string };
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, u.id)).limit(1);
    const row = rows[0];
    if (!row || !(await argon2.verify(row.passwordHash, current))) return c.json({ errors: [{ code: 'invalid_password', detail: 'Current password incorrect' }] }, 401);
    const hash = await argon2.hash(next);
    await db.update(schema.users).set({ passwordHash: hash }).where(eq(schema.users.id, u.id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
    deleteCookie(c, 'lunix_sid', { path: '/', secure: cookieSecure(c), sameSite: 'Lax' });
    return c.json({ data: { ok: true, note: 'Password changed. Please sign in again.' } });
  });

  return app;
}
