import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { eq, ne } from 'drizzle-orm';
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

export default function userRoutes(db: Db) {
  const app = new Hono();
  app.use('*', requireAdmin);
  app.get('/', async (c) => {
    const rows = await db.select().from(schema.users);
    return c.json({ data: rows.map(({ passwordHash, totpSecret, ...u }) => u) });
  });
  app.post('/', zJson(z.object({
    username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/, 'Letters, numbers, _, ., - only'),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    is_admin: z.boolean().optional(),
  })), async (c) => {
    const b = c.req.valid('json' as never) as { username: string; email: string; password: string; is_admin?: boolean };
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const email = b.email.toLowerCase().trim();
    const dupEmail = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (dupEmail[0]) return c.json({ errors: [{ code: 'email_taken', detail: 'Email already in use' }] }, 409);
    const dupUser = await db.select().from(schema.users).where(eq(schema.users.username, b.username)).limit(1);
    if (dupUser[0]) return c.json({ errors: [{ code: 'username_taken', detail: 'Username already taken' }] }, 409);
    const hash = await argon2.hash(b.password);
    const [u] = await db.insert(schema.users).values({ username: b.username, email, passwordHash: hash, isAdmin: b.is_admin ?? false, status: 'active', createdByAdminId: admin.id }).returning();
    await db.insert(schema.auditLogs).values({ userId: admin.id, action: 'user.created', targetType: 'user', targetId: String(u.id), meta: { email: u.email } });
    return c.json({ data: { id: u.id, email: u.email, username: u.username } }, 201);
  });
  app.get('/:id', async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'User not found' }] }, 404);
    const { passwordHash, totpSecret, ...u } = rows[0] as unknown as Record<string, unknown>;
    void passwordHash; void totpSecret;
    return c.json({ data: u });
  });
  app.patch('/:id', zJson(z.object({ username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/).optional(), email: z.string().email().optional(), status: z.enum(['active', 'grace', 'suspended']).optional(), is_admin: z.boolean().optional() })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as { username?: string; email?: string; status?: string; is_admin?: boolean };
    const patch: Record<string, unknown> = {};
    if (b.username !== undefined) patch.username = b.username;
    if (b.email !== undefined) patch.email = b.email.toLowerCase().trim();
    if (b.status) patch.status = b.status;
    if (b.is_admin !== undefined) patch.isAdmin = b.is_admin;
    const [u] = await db.update(schema.users).set(patch as never).where(eq(schema.users.id, id)).returning();
    if (!u) return c.json({ errors: [{ code: 'not_found', detail: 'User not found' }] }, 404);
    return c.json({ data: { id: u.id, status: u.status } });
  });
  app.post('/:id/suspend', async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    if (me.id === id) return c.json({ errors: [{ code: 'forbidden', detail: 'Cannot suspend yourself' }] }, 403);
    const [u] = await db.update(schema.users).set({ status: 'suspended', suspendedAt: new Date(), suspendedReason: 'manual' }).where(eq(schema.users.id, id)).returning();
    if (!u) return c.json({ errors: [{ code: 'not_found', detail: 'User not found' }] }, 404);
    await db.update(schema.servers).set({ status: 'suspended' }).where(eq(schema.servers.userId, id));
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'user.suspended', targetType: 'user', targetId: String(id) });
    return c.json({ data: { ok: true } });
  });
  app.post('/:id/unsuspend', async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const [u] = await db.update(schema.users).set({ status: 'active', suspendedAt: null, suspendedReason: null, graceUntil: null }).where(eq(schema.users.id, id)).returning();
    if (!u) return c.json({ errors: [{ code: 'not_found', detail: 'User not found' }] }, 404);
    await db.update(schema.servers).set({ status: 'active' }).where(eq(schema.servers.userId, id));
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'user.unsuspended', targetType: 'user', targetId: String(id) });
    return c.json({ data: { ok: true } });
  });
  app.delete('/:id', async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    if (me.id === id) return c.json({ errors: [{ code: 'forbidden', detail: 'Cannot delete yourself' }] }, 403);
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'User not found' }] }, 404);
    const serverCount = await db.select().from(schema.servers).where(eq(schema.servers.userId, id));
    if (serverCount.length > 0) return c.json({ errors: [{ code: 'has_servers', detail: `User owns ${serverCount.length} server(s). Delete or reassign them first.` }] }, 409);
    await db.delete(schema.users).where(eq(schema.users.id, id));
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'user.deleted', targetType: 'user', targetId: String(id), meta: { email: rows[0].email } });
    return c.json({ data: { ok: true } });
  });
  return app;
}
