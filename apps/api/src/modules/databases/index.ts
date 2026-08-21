import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { eq, and, count } from 'drizzle-orm';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { encrypt, decrypt } from '../../lib/crypto.js';

type AuthedUser = { id: number; isAdmin: boolean };

const DB_NAME_RE = /^[a-zA-Z0-9_]{1,62}$/;
const USERNAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;

function zJson<T extends z.ZodTypeAny>(s: T) {
  return validator('json', (value, c) => {
    const r = s.safeParse(value);
    if (!r.success) return c.json({ errors: [{ code: 'validation', detail: r.error.message }] }, 422);
    return r.data as z.infer<T>;
  });
}

async function hostConnection(host: typeof schema.databaseHosts.$inferSelect, key: string) {
  return mysql.createConnection({
    host: host.host,
    port: host.port,
    user: host.username,
    password: decrypt(host.passwordEncrypted, key),
    multipleStatements: false,
  });
}

export default function databaseRoutes(db: Db) {
  const app = new Hono();
  const encKey = () => process.env.ENCRYPTION_KEY || '';

  // ── Admin: database hosts ──

  app.get('/hosts', requireAdmin, async (c) => {
    const rows = await db.select().from(schema.databaseHosts);
    return c.json({ data: rows.map((r) => ({ ...r, passwordEncrypted: undefined })) });
  });

  app.post('/hosts', requireAdmin, zJson(z.object({
    name: z.string().min(1).max(191),
    host: z.string().min(1).max(191),
    port: z.number().int().min(1).max(65535).default(3306),
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(191),
    maxDatabases: z.number().int().min(0).default(0),
  })), async (c) => {
    const b = c.req.valid('json' as never) as { name: string; host: string; port: number; username: string; password: string; maxDatabases: number };
    const [row] = await db.insert(schema.databaseHosts).values({
      name: b.name.trim(), host: b.host.trim(), port: b.port, username: b.username.trim(),
      passwordEncrypted: encrypt(b.password, encKey()), maxDatabases: b.maxDatabases,
    }).returning();
    return c.json({ data: { ...row, passwordEncrypted: undefined } }, 201);
  });

  app.delete('/hosts/:id', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const inUse = await db.select({ n: count() }).from(schema.databases).where(eq(schema.databases.databaseHostId, id));
    if ((inUse[0]?.n || 0) > 0) return c.json({ errors: [{ code: 'conflict', detail: 'Host still has databases — delete them first' }] }, 409);
    await db.delete(schema.databaseHosts).where(eq(schema.databaseHosts.id, id));
    return c.json({ data: { ok: true } });
  });

  // ── Per-server databases ──

  async function ownedServer(c: { get: (k: string) => unknown; json: (o: unknown, st?: number) => Response }, serverId: number) {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as AuthedUser;
    const s = (await db.select().from(schema.servers).where(eq(schema.servers.id, serverId)).limit(1))[0];
    if (!s) return { res: c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404) };
    if (!u.isAdmin && s.userId !== u.id) return { res: c.json({ errors: [{ code: 'forbidden', detail: 'Not your server' }] }, 403) };
    return { s, u };
  }

  app.get('/', requireAuth, async (c) => {
    const serverId = parseInt(c.req.query('serverId') || '0', 10);
    if (!serverId) return c.json({ errors: [{ code: 'validation', detail: 'serverId query required' }] }, 422);
    const owned = await ownedServer(c, serverId);
    if ('res' in owned) return owned.res;
    const rows = await db.select().from(schema.databases).where(eq(schema.databases.serverId, serverId));
    const hosts = await db.select().from(schema.databaseHosts);
    const hostMap = new Map(hosts.map((h) => [h.id, h]));
    return c.json({
      data: rows.map((r) => {
        const h = hostMap.get(r.databaseHostId);
        return {
          id: r.id, database: r.databaseName, username: r.username, remote: r.remote,
          createdAt: r.createdAt, host: h ? { id: h.id, name: h.name, host: h.host, port: h.port } : null,
          // Password only revealed explicitly via /password.
          password: undefined,
        };
      }),
      limit: owned.s.databaseLimit,
    });
  });

  app.post('/', requireAuth, zJson(z.object({ serverId: z.number().int(), databaseHostId: z.number().int().optional(), remote: z.string().max(64).default('%') })), async (c) => {
    const b = c.req.valid('json' as never) as { serverId: number; databaseHostId?: number; remote: string };
    const owned = await ownedServer(c, b.serverId);
    if ('res' in owned) return owned.res;
    const { s } = owned;
    if (s.databaseLimit !== 0) {
      const used = await db.select({ n: count() }).from(schema.databases).where(eq(schema.databases.serverId, s.id));
      if ((used[0]?.n || 0) >= s.databaseLimit) return c.json({ errors: [{ code: 'limit', detail: `Database limit reached (${s.databaseLimit}).` }] }, 409);
    }
    const hosts = await db.select().from(schema.databaseHosts);
    if (hosts.length === 0) return c.json({ errors: [{ code: 'no_hosts', detail: 'No database hosts configured.' }] }, 409);
    let host = b.databaseHostId ? hosts.find((h) => h.id === b.databaseHostId) : undefined;
    if (b.databaseHostId && !host) return c.json({ errors: [{ code: 'not_found', detail: 'Database host not found' }] }, 404);
    if (!host) {
      // Pick the host with the fewest databases (max 0 = unlimited).
      const counts = await Promise.all(hosts.map(async (h) => ({ h, n: (await db.select({ n: count() }).from(schema.databases).where(eq(schema.databases.databaseHostId, h.id)))[0]?.n || 0 })));
      host = counts.sort((x, y) => (x.h.maxDatabases === 0 ? -1 : x.n / x.h.maxDatabases) - (y.h.maxDatabases === 0 ? -1 : y.n / y.h.maxDatabases))[0].h;
      if (host.maxDatabases !== 0) {
        const hostCount = counts.find((x) => x.h.id === host!.id)!.n;
        if (hostCount >= host.maxDatabases) return c.json({ errors: [{ code: 'limit', detail: 'Database host is full.' }] }, 409);
      }
    }
    const key = encKey();
    if (!key || key.length < 64) return c.json({ errors: [{ code: 'config', detail: 'ENCRYPTION_KEY not set' }] }, 500);
    // Pterodactyl-style names: s<serverId>_<random>
    const dbName = `s${s.id}_${crypto.randomBytes(4).toString('hex')}`;
    const dbUser = `u${s.id}_${crypto.randomBytes(3).toString('hex')}`;
    const password = crypto.randomBytes(16).toString('base64url');
    const conn = await hostConnection(host, key).catch((e) => {
      throw new Error(`Cannot reach database host: ${(e as Error).message}`);
    });
    try {
      const esc = (v: string) => v.replace(/['\\]/g, '');
      await conn.query(`CREATE DATABASE IF NOT EXISTS \`${esc(dbName)}\``);
      await conn.query(`CREATE USER IF NOT EXISTS '${esc(dbUser)}'@'${esc(b.remote)}' IDENTIFIED BY '${esc(password)}'`);
      await conn.query(`GRANT ALL PRIVILEGES ON \`${esc(dbName)}\`.* TO '${esc(dbUser)}'@'${esc(b.remote)}'`);
      await conn.query('FLUSH PRIVILEGES');
    } finally {
      await conn.end().catch(() => {});
    }
    const [row] = await db.insert(schema.databases).values({
      serverId: s.id, databaseHostId: host.id, databaseName: dbName, username: dbUser,
      passwordEncrypted: encrypt(password, key), remote: b.remote,
    }).returning();
    return c.json({
      data: {
        id: row.id, database: row.databaseName, username: row.username, remote: row.remote,
        host: { host: host.host, port: host.port }, password,
      },
    }, 201);
  });

  app.post('/:id/password', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const row = (await db.select().from(schema.databases).where(eq(schema.databases.id, id)).limit(1))[0];
    if (!row) return c.json({ errors: [{ code: 'not_found', detail: 'Database not found' }] }, 404);
    const owned = await ownedServer(c, row.serverId);
    if ('res' in owned) return owned.res;
    const key = encKey();
    if (!key) return c.json({ errors: [{ code: 'config', detail: 'ENCRYPTION_KEY not set' }] }, 500);
    const password = crypto.randomBytes(16).toString('base64url');
    const host = (await db.select().from(schema.databaseHosts).where(eq(schema.databaseHosts.id, row.databaseHostId)).limit(1))[0];
    if (host) {
      const conn = await hostConnection(host, key).catch((e) => { throw new Error(`Cannot reach database host: ${(e as Error).message}`); });
      try {
        const esc = (v: string) => v.replace(/['\\]/g, '');
        await conn.query(`ALTER USER '${esc(row.username)}'@'${esc(row.remote)}' IDENTIFIED BY '${esc(password)}'`);
        await conn.query('FLUSH PRIVILEGES');
      } finally {
        await conn.end().catch(() => {});
      }
    }
    await db.update(schema.databases).set({ passwordEncrypted: encrypt(password, key) }).where(eq(schema.databases.id, id));
    return c.json({ data: { password } });
  });

  app.get('/:id/password', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const row = (await db.select().from(schema.databases).where(eq(schema.databases.id, id)).limit(1))[0];
    if (!row) return c.json({ errors: [{ code: 'not_found', detail: 'Database not found' }] }, 404);
    const owned = await ownedServer(c, row.serverId);
    if ('res' in owned) return owned.res;
    const key = encKey();
    if (!key) return c.json({ errors: [{ code: 'config', detail: 'ENCRYPTION_KEY not set' }] }, 500);
    return c.json({ data: { password: decrypt(row.passwordEncrypted, key) } });
  });

  app.delete('/:id', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const row = (await db.select().from(schema.databases).where(eq(schema.databases.id, id)).limit(1))[0];
    if (!row) return c.json({ errors: [{ code: 'not_found', detail: 'Database not found' }] }, 404);
    const owned = await ownedServer(c, row.serverId);
    if ('res' in owned) return owned.res;
    const key = encKey();
    const host = (await db.select().from(schema.databaseHosts).where(eq(schema.databaseHosts.id, row.databaseHostId)).limit(1))[0];
    if (host && key) {
      const conn = await hostConnection(host, key).catch(() => null);
      if (conn) {
        try {
          const esc = (v: string) => v.replace(/['\\]/g, '');
          await conn.query(`DROP DATABASE IF EXISTS \`${esc(row.databaseName)}\``);
          await conn.query(`DROP USER IF EXISTS '${esc(row.username)}'@'${esc(row.remote)}'`);
        } catch { /* best-effort cleanup */ }
        await conn.end().catch(() => {});
      }
    }
    await db.delete(schema.databases).where(and(eq(schema.databases.id, id), eq(schema.databases.serverId, row.serverId)));
    return c.json({ data: { ok: true } });
  });

  return app;
}
