import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.js';

function zJson<T extends z.ZodTypeAny>(s: T) {
  return validator('json', (value, c) => {
    const r = s.safeParse(value);
    if (!r.success) return c.json({ errors: [{ code: 'validation', detail: r.error.message }] }, 422);
    return r.data as z.infer<T>;
  });
}

export default function accountRequestRoutes(db: Db) {
  const app = new Hono();
  app.post('/', zJson(z.object({ name: z.string().min(2).max(191), email: z.string().email(), company: z.string().max(191).optional(), reason: z.string().max(2000).optional() })), async (c) => {
    const body = c.req.valid('json' as never) as { name: string; email: string; company?: string; reason?: string };
    const email = body.email.toLowerCase().trim();
    const recent = await db.select().from(schema.accountRequests).where(eq(schema.accountRequests.email, email));
    const pending = recent.filter((r) => r.status === 'pending');
    if (pending.length > 0) return c.json({ errors: [{ code: 'already_pending', detail: 'A request for this email is already pending.' }] }, 409);
    const recentCount = recent.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 24 * 3600 * 1000).length;
    if (recentCount >= 3) return c.json({ errors: [{ code: 'rate_limited', detail: 'Too many requests for this email. Try again tomorrow.' }] }, 429);
    const [row] = await db.insert(schema.accountRequests).values({ name: body.name.trim(), email, company: body.company?.trim(), reason: body.reason?.trim() }).returning();
    return c.json({ data: { id: row.id, status: row.status } }, 201);
  });
  app.get('/', requireAdmin, async (c) => {
    const status = c.req.query('status');
    const rows = status ? await db.select().from(schema.accountRequests).where(eq(schema.accountRequests.status, status)) : await db.select().from(schema.accountRequests);
    return c.json({ data: rows });
  });
  app.post('/:id/approve', requireAdmin, zJson(z.object({ username: z.string().min(3).max(64), password: z.string().min(8).max(128), expires_at: z.string().datetime().nullable().optional() })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const body = c.req.valid('json' as never) as { username: string; password: string; expires_at?: string | null };
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const reqs = await db.select().from(schema.accountRequests).where(eq(schema.accountRequests.id, id)).limit(1);
    const req = reqs[0];
    if (!req || req.status !== 'pending') return c.json({ errors: [{ code: 'not_found', detail: 'Request not found or not pending' }] }, 404);
    const existingUser = await db.select().from(schema.users).where(eq(schema.users.email, req.email)).limit(1);
    if (existingUser[0]) return c.json({ errors: [{ code: 'email_taken', detail: 'A user with this email already exists.' }] }, 409);
    const existingName = await db.select().from(schema.users).where(eq(schema.users.username, body.username)).limit(1);
    if (existingName[0]) return c.json({ errors: [{ code: 'username_taken', detail: 'Username already taken.' }] }, 409);
    const hash = await argon2.hash(body.password);
    const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
    const [user] = await db.insert(schema.users).values({ username: body.username, email: req.email, passwordHash: hash, isAdmin: false, status: 'active', expiresAt, createdByAdminId: admin.id }).returning();
    await db.update(schema.accountRequests).set({ status: 'approved', reviewedBy: admin.id, reviewedAt: new Date() }).where(eq(schema.accountRequests.id, id));
    await db.insert(schema.auditLogs).values({ userId: admin.id, action: 'request.approved', targetType: 'account_request', targetId: String(id), meta: { userId: user.id, email: user.email } });
    return c.json({ data: { user_id: user.id, email: user.email } }, 201);
  });
  app.post('/:id/reject', requireAdmin, zJson(z.object({ reason: z.string().max(500).optional() })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const body = await c.req.json().catch(() => ({} as { reason?: string }));
    const reason = (body as { reason?: string }).reason;
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const reqs = await db.select().from(schema.accountRequests).where(eq(schema.accountRequests.id, id)).limit(1);
    if (!reqs[0] || reqs[0].status !== 'pending') return c.json({ errors: [{ code: 'not_found', detail: 'Request not found or not pending' }] }, 404);
    await db.update(schema.accountRequests).set({ status: 'rejected', reviewedBy: admin.id, reviewedAt: new Date() }).where(eq(schema.accountRequests.id, id));
    await db.insert(schema.auditLogs).values({ userId: admin.id, action: 'request.rejected', targetType: 'account_request', targetId: String(id), meta: { reason } });
    return c.json({ data: { ok: true } });
  });
  return app;
}
