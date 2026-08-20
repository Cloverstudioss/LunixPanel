import type { Context, Next } from 'hono';
import type { AuthedUser } from './auth.js';

export async function paidCheck(c: Context, next: Next) {
  const u = (c as unknown as { get: (k: string) => unknown }).get('user') as AuthedUser | undefined;
  if (!u) { await next(); return; }
  if (u.isAdmin) { await next(); return; }
  const now = new Date();
  const expired = u.expiresAt ? new Date(u.expiresAt) < now : false;
  const graceOver = u.graceUntil ? new Date(u.graceUntil) < now : false;
  if (u.status === 'suspended' || (expired && graceOver)) {
    return c.json({ errors: [{ code: 'account_expired', detail: 'Your QyroCloud access has expired. Please renew at QyroCloud to restore servers.' }] }, 403);
  }
  await next();
}
