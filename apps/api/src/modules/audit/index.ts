import { Hono } from 'hono';
import { desc, sql } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.js';

export default function auditRoutes(db: Db) {
  const app = new Hono();
  app.use('*', requireAdmin);
  app.get('/', async (c) => {
    const limit = Math.min(200, Math.max(10, parseInt(c.req.query('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));
    const action = c.req.query('action');
    let rows;
    if (action) {
      rows = await db.select().from(schema.auditLogs).where(sql`${schema.auditLogs.action} = ${action}`).orderBy(desc(schema.auditLogs.createdAt)).limit(limit).offset(offset);
    } else {
      rows = await db.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.createdAt)).limit(limit).offset(offset);
    }
    const users = await db.select().from(schema.users);
    const byId = new Map(users.map((u) => [u.id, u]));
    const data = rows.map((r) => ({ ...r, user: r.userId ? { id: r.userId, email: byId.get(r.userId!)?.email || null, username: byId.get(r.userId!)?.username || null } : null }));
    return c.json({ data });
  });
  return app;
}
