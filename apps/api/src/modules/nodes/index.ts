import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';

function zJson<T extends z.ZodTypeAny>(s: T) { return validator('json', (v, c) => { const r = s.safeParse(v); if (!r.success) return c.json({ errors: [{ code: 'validation', detail: r.error.message }] }, 422); return r.data as z.infer<T>; }); }

export default function nodeRoutes(db: Db) {
  const app = new Hono();
  app.get('/', requireAuth, async (c) => {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { isAdmin: boolean };
    const rows = await db.select().from(schema.nodes);
    if (u.isAdmin) return c.json({ data: rows });
    return c.json({ data: rows.map(({ daemonToken, ...n }) => n) });
  });
  app.post('/', requireAdmin, zJson(z.object({ name: z.string().min(1).max(191), fqdn: z.string().min(1).max(191), scheme: z.enum(['http', 'https']).default('https'), daemonListen: z.number().int().min(1).max(65535).default(8080), locationId: z.number().int().nullable().optional(), memory: z.number().int().min(0).default(0), disk: z.number().int().min(0).default(0) })), async (c) => {
    const b = c.req.valid('json' as never) as { name: string; fqdn: string; scheme: 'http' | 'https'; daemonListen: number; locationId?: number | null; memory: number; disk: number };
    const token = crypto.randomBytes(32).toString('hex');
    const [row] = await db.insert(schema.nodes).values({ name: b.name, fqdn: b.fqdn, scheme: b.scheme, daemonListen: b.daemonListen, daemonToken: token, locationId: b.locationId ?? null, memory: b.memory, disk: b.disk }).returning();
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'node.created', targetType: 'node', targetId: String(row.id), meta: { fqdn: row.fqdn } });
    return c.json({ data: row }, 201);
  });
  app.get('/:id', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.nodes).where(eq(schema.nodes.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { isAdmin: boolean };
    const allocs = await db.select().from(schema.allocations).where(eq(schema.allocations.nodeId, id));
    const servers = await db.select({ id: schema.servers.id, name: schema.servers.name, status: schema.servers.status, memory: schema.servers.memory, disk: schema.servers.disk }).from(schema.servers).where(eq(schema.servers.nodeId, id));
    const location = rows[0].locationId ? await db.select().from(schema.locations).where(eq(schema.locations.id, rows[0].locationId)).limit(1) : [];
    if (!u.isAdmin) { const { daemonToken, ...safe } = rows[0] as unknown as Record<string, unknown>; void daemonToken; return c.json({ data: { ...safe, allocations_count: allocs.length, servers_count: servers.length, servers } }); }
    return c.json({ data: { ...rows[0], allocations_count: allocs.length, used_allocation_id: allocs.find((a) => a.serverId)?.id ?? null, servers_count: servers.length, servers, location: location[0] || null } });
  });
  app.patch('/:id', requireAdmin, zJson(z.object({
    name: z.string().min(1).max(191).optional(),
    fqdn: z.string().min(1).max(191).optional(),
    scheme: z.enum(['http', 'https']).optional(),
    daemonListen: z.number().int().min(1).max(65535).optional(),
    locationId: z.number().int().nullable().optional(),
    memory: z.number().int().min(0).optional(),
    memoryOverallocate: z.number().int().min(0).optional(),
    disk: z.number().int().min(0).optional(),
    diskOverallocate: z.number().int().min(0).optional(),
    uploadSize: z.number().int().min(1).max(1000).optional(),
    daemonBase: z.string().min(1).max(191).optional(),
    public: z.boolean().optional(),
    behindProxy: z.boolean().optional(),
    regenerateToken: z.boolean().optional(),
  })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as { name?: string; fqdn?: string; scheme?: 'http' | 'https'; daemonListen?: number; locationId?: number | null; memory?: number; memoryOverallocate?: number; disk?: number; diskOverallocate?: number; uploadSize?: number; daemonBase?: string; public?: boolean; behindProxy?: boolean; regenerateToken?: boolean };
    const rows = await db.select().from(schema.nodes).where(eq(schema.nodes.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const update: Record<string, unknown> = {};
    if (b.name !== undefined) update.name = b.name.trim();
    if (b.fqdn !== undefined) update.fqdn = b.fqdn.trim();
    if (b.scheme !== undefined) update.scheme = b.scheme;
    if (b.daemonListen !== undefined) update.daemonListen = b.daemonListen;
    if (b.locationId !== undefined) update.locationId = b.locationId;
    if (b.memory !== undefined) update.memory = b.memory;
    if (b.memoryOverallocate !== undefined) update.memoryOverallocate = b.memoryOverallocate;
    if (b.disk !== undefined) update.disk = b.disk;
    if (b.diskOverallocate !== undefined) update.diskOverallocate = b.diskOverallocate;
    if (b.uploadSize !== undefined) update.uploadSize = b.uploadSize;
    if (b.daemonBase !== undefined) update.daemonBase = b.daemonBase;
    if (b.public !== undefined) update.public = b.public;
    if (b.behindProxy !== undefined) update.behindProxy = b.behindProxy;
    if (b.regenerateToken) update.daemonToken = crypto.randomBytes(32).toString('hex');
    if (Object.keys(update).length === 0) return c.json({ errors: [{ code: 'validation', detail: 'No fields to update' }] }, 422);
    const [row] = await db.update(schema.nodes).set(update).where(eq(schema.nodes.id, id)).returning();
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'node.updated', targetType: 'node', targetId: String(id), meta: { fields: Object.keys(update) } });
    return c.json({ data: row });
  });
  app.get('/:id/configuration', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.nodes).where(eq(schema.nodes.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const n = rows[0];
    const panelUrl = (process.env.APP_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:25050').replace(/\/$/, '');
    const config = [
      `debug: false`,
      `uuid: ${n.uuid}`,
      `token_id: ${n.uuid}`,
      `token: ${n.daemonToken}`,
      `api:`,
      `  host: 0.0.0.0`,
      `  port: ${n.daemonListen}`,
      `  ssl:`,
      `    enabled: ${n.scheme === 'https' ? 'true' : 'false'}`,
      `    cert: /etc/pterodactyl/certs/server.pem`,
      `    key: /etc/pterodactyl/certs/server.key`,
      `  upload_limit: 100`,
      `system:`,
      `  data: /var/lib/pterodactyl/volumes`,
      `  sftp:`,
      `    bind_address: 0.0.0.0`,
      `    bind_port: 2022`,
      `allowed_mounts: []`,
      `remote: '${panelUrl}'`,
    ].join('\n');
    const autoDeploy = [
      `mkdir -p /etc/pterodactyl && cat > /etc/pterodactyl/config.yml <<'YAML'`,
      config,
      `YAML`,
      `systemctl restart wings && journalctl -u wings -f --no-pager | head -n 50`,
    ].join('\n');
    return c.json({ data: { config, autoDeploy, panelUrl, uuid: n.uuid, token: n.daemonToken, fqdn: n.fqdn, scheme: n.scheme, daemonListen: n.daemonListen } });
  });
  app.get('/:id/allocations', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.allocations).where(eq(schema.allocations.nodeId, id));
    return c.json({ data: rows });
  });
  app.post('/:id/allocations', requireAdmin, zJson(z.object({ ip: z.string().min(1).max(45), ports: z.array(z.number().int().min(1).max(65535)).min(1).max(1000), alias: z.string().max(45).optional().default('') })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as { ip: string; ports: number[]; alias?: string };
    const node = await db.select().from(schema.nodes).where(eq(schema.nodes.id, id)).limit(1);
    if (!node[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const existing = await db.select().from(schema.allocations).where(eq(schema.allocations.nodeId, id));
    const dup = b.ports.filter((p) => existing.some((e) => e.ip === b.ip && e.port === p));
    if (dup.length) return c.json({ errors: [{ code: 'conflict', detail: `Allocations already exist for ports: ${dup.join(', ')}` }] }, 409);
    const rows = await db.insert(schema.allocations).values(b.ports.map((port) => ({ nodeId: id, ip: b.ip, port, ipAlias: b.alias?.trim() || null }))).returning();
    return c.json({ data: rows }, 201);
  });
  app.patch('/:id/allocations/:aid', requireAdmin, zJson(z.object({ ip: z.string().min(1).max(45).optional(), ip_alias: z.string().max(45).nullable().optional(), port: z.number().int().min(1).max(65535).optional() })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const aid = parseInt(c.req.param('aid') || '0', 10);
    const b = c.req.valid('json' as never) as { ip?: string; ip_alias?: string | null; port?: number };
    const node = await db.select().from(schema.nodes).where(eq(schema.nodes.id, id)).limit(1);
    if (!node[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const rows = await db.select().from(schema.allocations).where(eq(schema.allocations.id, aid)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Allocation not found' }] }, 404);
    const update: Record<string, unknown> = {};
    if (b.ip !== undefined) update.ip = b.ip;
    if (b.ip_alias !== undefined) update.ipAlias = b.ip_alias === '' ? null : b.ip_alias;
    if (b.port !== undefined) update.port = b.port;
    if (Object.keys(update).length === 0) return c.json({ errors: [{ code: 'validation', detail: 'No fields to update' }] }, 422);
    const [row] = await db.update(schema.allocations).set(update).where(eq(schema.allocations.id, aid)).returning();
    return c.json({ data: row });
  });
  app.delete('/:id/allocations/:aid', requireAdmin, async (c) => {
    const aid = parseInt(c.req.param('aid') || '0', 10);
    const rows = await db.select().from(schema.allocations).where(eq(schema.allocations.id, aid)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Allocation not found' }] }, 404);
    if (rows[0].serverId) return c.json({ errors: [{ code: 'conflict', detail: 'Allocation is in use by a server.' }] }, 409);
    await db.delete(schema.allocations).where(eq(schema.allocations.id, aid));
    return c.json({ data: { ok: true } });
  });
  app.get('/:id/health', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.nodes).where(eq(schema.nodes.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const n = rows[0];
    const url = `${n.scheme}://${n.fqdn}:${n.daemonListen}/api/system`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${n.daemonToken}` }, signal: controller.signal } as RequestInit);
      clearTimeout(t);
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        console.warn(`[node ${id} health] ${r.status} ${text.slice(0, 200)}`);
        return c.json({ data: { status: 'error', http: r.status, detail: text.slice(0, 500) || `HTTP ${r.status}`, url } });
      }
      const j = await r.json().catch(() => ({}));
      return c.json({ data: { status: 'online', url, version: (j as { version?: string }).version || null } });
    } catch (e) {
      clearTimeout(t);
      const msg = String((e as Error).message || e);
      console.warn(`[node ${id} health] fetch failed ${msg} url=${url}`);
      return c.json({ data: { status: 'error', detail: msg, url } });
    }
  });
  app.delete('/:id', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const rows = await db.select().from(schema.nodes).where(eq(schema.nodes.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const servers = await db.select().from(schema.servers).where(eq(schema.servers.nodeId, id)).limit(1);
    if (servers[0]) return c.json({ errors: [{ code: 'conflict', detail: 'Cannot delete node with servers. Move or delete servers first.' }] }, 409);
    await db.delete(schema.allocations).where(eq(schema.allocations.nodeId, id));
    await db.delete(schema.nodes).where(eq(schema.nodes.id, id));
    const { audit, auditIp } = await import('../lib/audit.js');
    await audit(db, me.id, 'node.deleted', 'node', String(id), auditIp(c), { fqdn: rows[0].fqdn });
    return c.json({ data: { ok: true } });
  });
  return app;
}
