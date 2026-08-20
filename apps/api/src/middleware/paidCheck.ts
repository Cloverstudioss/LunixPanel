import type { Context, Next } from 'hono';
import type { AuthedUser } from './auth.js';

export async function paidCheck(c: Context, next: Next) {
  const u = (c as unknown as { get: (k: string) => unknown }).get('user') as AuthedUser | undefined;
  if (!u) { await next(); return; }
  if (u.isAdmin) { await next(); return; }
  if (u.status === 'suspended') {
    return c.json({ errors: [{ code: 'account_suspended', detail: 'Your account is suspended. Please contact support.' }] }, 403);
  }
  await next();
}