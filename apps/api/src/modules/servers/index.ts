import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { signJwt } from '../../lib/jwt.js';

function zJson<T extends z.ZodTypeAny>(s: T) { return validator('json', (v, c) => { const r = s.safeParse(v); if (!r.success) return c.json({ errors: [{ code: 'validation', detail: r.error.message }] }, 422); return r.data as z.infer<T>; }); }

type AuthedUser = { id: number; uuid: string; email: string; username: string; isAdmin: boolean };

export default function serverRoutes(db: Db) {
  const app = new Hono();
  async function loadServer(id: number) {
    const rows = await db.select().from(schema.servers).where(eq(schema.servers.id, id)).limit(1);
    return rows[0] || null;
  }
  async function requireOwner(c: { get: (k: string) => unknown; json: (o: unknown, s?: number) => Response }, server: { userId: number }): Promise<{ user: AuthedUser } | { res: Response }> {
    const u = c.get('user') as AuthedUser;
    if (!u.isAdmin && server.userId !== u.id) return { res: c.json({ errors: [{ code: 'forbidden', detail: 'Not your server' }] }, 403) };
    return { user: u };
  }
  async function nodeFor(server: { nodeId: number }) {
    const rows = await db.select().from(schema.nodes).where(eq(schema.nodes.id, server.nodeId)).limit(1);
    return rows[0] || null;
  }
  function wingsUrl(n: { scheme: string; fqdn: string; daemonListen: number }) { return `${n.scheme}://${n.fqdn}:${n.daemonListen}`; }
  async function registerOnWings(s: typeof schema.servers.$inferSelect): Promise<string | null> {
    const nodes = await db.select().from(schema.nodes).where(eq(schema.nodes.id, s.nodeId)).limit(1);
    const node = nodes[0];
    if (!node) return 'no node';
    try {
      const r = await fetch(`${wingsUrl(node)}/api/servers`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${node.daemonToken}` }, body: JSON.stringify({ uuid: s.uuid, start_on_completion: false }) });
      if (!r.ok) return `wings create failed (${r.status})`;
      return null;
    } catch (e) {
      return `wings unreachable (${String((e as Error).message)})`;
    }
  }
  async function syncToWings(s: typeof schema.servers.$inferSelect): Promise<void> {
    const nodes = await db.select().from(schema.nodes).where(eq(schema.nodes.id, s.nodeId)).limit(1);
    const node = nodes[0];
    if (!node) return;
    try {
      await fetch(`${wingsUrl(node)}/api/servers/${s.uuid}/sync`, { method: 'POST', headers: { Authorization: `Bearer ${node.daemonToken}` } });
    } catch { /* non-fatal */ }
  }
  async function deleteFromWings(s: typeof schema.servers.$inferSelect): Promise<void> {
    const nodes = await db.select().from(schema.nodes).where(eq(schema.nodes.id, s.nodeId)).limit(1);
    const node = nodes[0];
    if (!node) return;
    try {
      await fetch(`${wingsUrl(node)}/api/servers/${s.uuid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${node.daemonToken}` } });
    } catch { /* non-fatal */ }
  }
  app.get('/', requireAuth, async (c) => {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number; isAdmin: boolean };
    const rows = u.isAdmin ? await db.select().from(schema.servers) : await db.select().from(schema.servers).where(eq(schema.servers.userId, u.id));
    const eggs = await db.select().from(schema.eggs);
    const eggMap = new Map(eggs.map((e) => [e.id, e]));
    return c.json({ data: rows.map((r) => ({ ...r, egg: eggMap.get(r.eggId) ? { id: eggMap.get(r.eggId)!.id, name: eggMap.get(r.eggId)!.name, banner: eggMap.get(r.eggId)!.banner, dockerImage: eggMap.get(r.eggId)!.dockerImage } : null })) });
  });
  app.post('/', requireAdmin, zJson(z.object({
    name: z.string().min(1).max(191), userId: z.number().int(), nodeId: z.number().int(), eggId: z.number().int(), allocationId: z.number().int(), allocationLimit: z.number().int().min(0).max(100).default(1),
    memory: z.number().int().min(64).max(1_000_000), swap: z.number().int().min(-1).max(1_000_000).default(0), disk: z.number().int().min(256).max(10_000_000), io: z.number().int().min(10).max(1000).default(500), cpu: z.number().int().min(0).max(10000).default(100),
    threads: z.string().max(191).optional(), oom_disabled: z.boolean().optional(), description: z.string().max(1000).optional(),
    image: z.string().min(1).max(512), startup: z.string().max(2048).default(''), expires_at: z.string().datetime().nullable().optional(), env: z.record(z.string()).default({}),
  })), async (c) => {
    const b = c.req.valid('json' as never) as { name: string; userId: number; nodeId: number; eggId: number; allocationId: number; allocationLimit: number; memory: number; swap: number; disk: number; io: number; cpu: number; threads?: string; oom_disabled?: boolean; description?: string; image: string; startup: string; expires_at?: string | null; env: Record<string, string> };
    const alloc = await db.select().from(schema.allocations).where(eq(schema.allocations.id, b.allocationId)).limit(1);
    if (!alloc[0] || alloc[0].nodeId !== b.nodeId) return c.json({ errors: [{ code: 'validation', detail: 'Allocation does not belong to node' }] }, 422);
    if (alloc[0].serverId) return c.json({ errors: [{ code: 'conflict', detail: 'Allocation already in use' }] }, 409);
    const user = await db.select().from(schema.users).where(eq(schema.users.id, b.userId)).limit(1);
    if (!user[0]) return c.json({ errors: [{ code: 'not_found', detail: 'User not found' }] }, 404);
    const node = await db.select().from(schema.nodes).where(eq(schema.nodes.id, b.nodeId)).limit(1);
    if (!node[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const egg = await db.select().from(schema.eggs).where(eq(schema.eggs.id, b.eggId)).limit(1);
    if (!egg[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Egg not found' }] }, 404);
    const uuidShort = Math.random().toString(36).slice(2, 10);
    const expiresAt = b.expires_at ? new Date(b.expires_at) : null;
    const [row] = await db.insert(schema.servers).values({
      uuidShort, name: b.name.trim(), userId: b.userId, nodeId: b.nodeId, eggId: b.eggId, allocationId: b.allocationId, memory: b.memory, swap: b.swap, disk: b.disk, io: b.io, cpu: b.cpu, threads: b.threads ?? null, oomDisabled: b.oom_disabled ?? false, description: b.description ?? null, image: b.image, startup: b.startup, expiresAt, status: 'active',
    }).returning();
    await db.update(schema.allocations).set({ serverId: row.id }).where(eq(schema.allocations.id, b.allocationId));
    const vars = await db.select().from(schema.eggVariables).where(eq(schema.eggVariables.eggId, b.eggId));
    for (const v of vars) {
      if (!v.userEditable && b.env[v.envVariable] !== undefined && b.env[v.envVariable] !== v.defaultValue) continue;
      await db.insert(schema.serverVariables).values({ serverId: row.id, variableId: v.id, variableValue: b.env[v.envVariable] ?? v.defaultValue });
    }
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'server.created', targetType: 'server', targetId: String(row.id), meta: { userId: b.userId, nodeId: b.nodeId } });
    const reg = await registerOnWings(row);
    if (reg !== null) return c.json({ data: { ...row, wings_error: reg } }, 201);
    return c.json({ data: row }, 201);
  });
  app.get('/:id', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.servers).where(eq(schema.servers.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number; isAdmin: boolean };
    if (!u.isAdmin && rows[0].userId !== u.id) return c.json({ errors: [{ code: 'forbidden', detail: 'Not your server' }] }, 403);
    const alloc = await db.select().from(schema.allocations).where(eq(schema.allocations.id, rows[0].allocationId)).limit(1);
    const node = await db.select().from(schema.nodes).where(eq(schema.nodes.id, rows[0].nodeId)).limit(1);
    const eggRows = await db.select().from(schema.eggs).where(eq(schema.eggs.id, rows[0].eggId)).limit(1);
    const egg = eggRows[0] ? { id: eggRows[0].id, name: eggRows[0].name, banner: eggRows[0].banner, dockerImage: eggRows[0].dockerImage } : null;
    return c.json({ data: { ...rows[0], allocation: alloc[0] || null, node: node[0] || null, egg } });
  });
  app.patch('/:id', requireAdmin, zJson(z.object({
    name: z.string().min(1).max(191).optional(),
    description: z.string().max(1000).nullable().optional(),
    userId: z.number().int().optional(),
    nodeId: z.number().int().optional(),
    eggId: z.number().int().optional(),
    allocationId: z.number().int().optional(),
    memory: z.number().int().min(64).max(1_000_000).optional(),
    swap: z.number().int().min(-1).max(1_000_000).optional(),
    disk: z.number().int().min(256).max(10_000_000).optional(),
    io: z.number().int().min(10).max(1000).optional(),
    cpu: z.number().int().min(0).max(10000).optional(),
    threads: z.string().max(191).nullable().optional(),
    oom_disabled: z.boolean().optional(),
    image: z.string().min(1).max(512).optional(),
    startup: z.string().max(2048).optional(),
    status: z.enum(['active', 'suspended', 'installing', 'restoring']).optional(),
    expires_at: z.string().datetime().nullable().optional(),
  })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as { name?: string; description?: string | null; userId?: number; nodeId?: number; eggId?: number; allocationId?: number; memory?: number; swap?: number; disk?: number; io?: number; cpu?: number; threads?: string | null; oom_disabled?: boolean; image?: string; startup?: string; status?: string; expires_at?: string | null };
    const rows = await db.select().from(schema.servers).where(eq(schema.servers.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    if (b.nodeId !== undefined || b.allocationId !== undefined) {
      const nid = b.nodeId ?? rows[0].nodeId;
      const aid = b.allocationId ?? rows[0].allocationId;
      const alloc = await db.select().from(schema.allocations).where(eq(schema.allocations.id, aid)).limit(1);
      if (!alloc[0] || alloc[0].nodeId !== nid) return c.json({ errors: [{ code: 'validation', detail: 'Allocation does not belong to node' }] }, 422);
      if (alloc[0].serverId && alloc[0].serverId !== id) return c.json({ errors: [{ code: 'conflict', detail: 'Allocation already in use by another server' }] }, 409);
    }
    const update: Record<string, unknown> = {};
    if (b.name !== undefined) update.name = b.name.trim();
    if (b.description !== undefined) update.description = b.description;
    if (b.userId !== undefined) update.userId = b.userId;
    if (b.nodeId !== undefined || b.allocationId !== undefined) {
      if (b.nodeId !== undefined) update.nodeId = b.nodeId;
      if (b.allocationId !== undefined) {
        update.allocationId = b.allocationId;
        await db.update(schema.allocations).set({ serverId: null }).where(eq(schema.allocations.id, rows[0].allocationId));
        await db.update(schema.allocations).set({ serverId: id }).where(eq(schema.allocations.id, b.allocationId));
      }
    }
    if (b.eggId !== undefined) update.eggId = b.eggId;
    if (b.memory !== undefined) update.memory = b.memory;
    if (b.swap !== undefined) update.swap = b.swap;
    if (b.disk !== undefined) update.disk = b.disk;
    if (b.io !== undefined) update.io = b.io;
    if (b.cpu !== undefined) update.cpu = b.cpu;
    if (b.threads !== undefined) update.threads = b.threads;
    if (b.oom_disabled !== undefined) update.oomDisabled = b.oom_disabled;
    if (b.image !== undefined) update.image = b.image;
    if (b.startup !== undefined) update.startup = b.startup;
    if (b.status !== undefined) update.status = b.status;
    if (b.expires_at !== undefined) update.expiresAt = b.expires_at ? new Date(b.expires_at) : null;
    if (Object.keys(update).length === 0) return c.json({ errors: [{ code: 'validation', detail: 'No fields to update' }] }, 422);
    const [row] = await db.update(schema.servers).set(update).where(eq(schema.servers.id, id)).returning();
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'server.updated', targetType: 'server', targetId: String(id), meta: { fields: Object.keys(update) } });
    await syncToWings(row);
    return c.json({ data: row });
  });
  app.post('/:id/websocket', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const u = auth.user;
    const node = await nodeFor(s);
    if (!node) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const panelUrl = (process.env.APP_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:25050').replace(/\/$/, '');
    const conn = `${node.fqdn}:${node.daemonListen}`;
    const now = Math.floor(Date.now() / 1000);
    const token = signJwt(node.daemonToken, {
      iss: panelUrl, aud: [conn], exp: now + 600, jti: crypto.createHash('sha256').update(`${u.id}${s.uuid}`).digest('hex'),
      scope: 'websocket', user_uuid: u.uuid, server_uuid: s.uuid,
      permissions: ['*'], unique_id: crypto.randomUUID(),
    });
    const socket = `${wingsUrl(node).replace(/^http/, 'ws')}/api/servers/${s.uuid}/ws`;
    return c.json({ data: { token, socket, panel_url: panelUrl, node: conn } });
  });
  app.post('/:id/power', requireAuth, zJson(z.object({ action: z.enum(['start', 'stop', 'restart', 'kill']) })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const u = auth.user;
    const node = await nodeFor(s);
    if (!node) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const b = c.req.valid('json' as never) as { action: string };
    const r = await fetch(`${wingsUrl(node)}/api/servers/${s.uuid}/power`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${node.daemonToken}` }, body: JSON.stringify({ action: b.action, wait_seconds: 30 }) });
    if (!r.ok) return c.json({ errors: [{ code: 'wings_error', detail: `Wings returned ${r.status}` }] }, 502);
    await db.insert(schema.auditLogs).values({ userId: u.id, action: `server.power.${b.action}`, targetType: 'server', targetId: String(id) });
    return c.json({ data: { ok: true } }, 202);
  });
  app.post('/:id/command', requireAuth, zJson(z.object({ command: z.string().min(1).max(500) })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const u = auth.user;
    const node = await nodeFor(s);
    if (!node) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const b = c.req.valid('json' as never) as { command: string };
    const r = await fetch(`${wingsUrl(node)}/api/servers/${s.uuid}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${node.daemonToken}` }, body: JSON.stringify({ commands: [b.command] }) });
    if (!r.ok) return c.json({ errors: [{ code: 'wings_error', detail: `Wings returned ${r.status}` }] }, 502);
    return c.json({ data: { ok: true } });
  });
  app.get('/:id/logs', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const node = await nodeFor(s);
    if (!node) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    try {
      const r = await fetch(`${wingsUrl(node)}/api/servers/${s.uuid}/logs`, { headers: { Authorization: `Bearer ${node.daemonToken}` } });
      if (!r.ok) return c.json({ errors: [{ code: 'wings_error', detail: `Wings returned ${r.status}` }] }, 502);
      const j = await r.json().catch(() => ({ data: [] }));
      return c.json({ data: j.data || [] });
    } catch (e) {
      return c.json({ errors: [{ code: 'wings_error', detail: `Wings unreachable (${String((e as Error).message)})` }] }, 502);
    }
  });
  const fileProxy = (name: string) => async (c: any) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const u = auth.user;
    const node = await nodeFor(s);
    if (!node) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const method = name === 'contents' || name === 'list-directory' || name === 'download' ? 'GET' : 'POST';
    const base = `${wingsUrl(node)}/api/servers/${s.uuid}/files`;
    let url = base;
    let body: string | undefined;
    const headers: Record<string, string> = { Authorization: `Bearer ${node.daemonToken}` };
    if (name === 'list-directory') {
      url += `/list-directory?directory=${encodeURIComponent((c.req.query('directory') as string) || '/')}`;
    } else if (name === 'contents') {
      url += `/contents?file=${encodeURIComponent((c.req.query('file') as string) || '')}`;
    } else if (name === 'download') {
      url += `/contents?file=${encodeURIComponent((c.req.query('file') as string) || '')}&download=1`;
    } else if (name === 'write') {
      const qFile = (c.req.query('file') as string) || '';
      let raw = await c.req.text().catch(() => '');
      let file = qFile;
      if (!file) {
        try {
          const j = JSON.parse(raw);
          if (j && typeof j === 'object' && !Array.isArray(j) && 'file' in j) {
            const root = String(j.root || '/');
            const fname = String(j.file || '');
            file = `/${[root, fname].join('/').replace(/\/+/g, '/').replace(/^\/+/, '')}`;
            raw = String(j.content ?? '');
          }
        } catch { /* raw body is the file content */ }
      } else {
        try { const p = JSON.parse(raw); if (typeof p === 'string') raw = p; } catch { /* keep raw */ }
      }
      url += `/write?file=${encodeURIComponent(file)}`;
      body = raw;
      headers['Content-Type'] = 'application/octet-stream';
    } else {
      url += `/${name}`;
      body = await c.req.text().catch(() => '');
      headers['Content-Type'] = 'application/json';
    }
    const r = await fetch(url, { method, headers, body });
    if (!r.ok) return c.json({ errors: [{ code: 'wings_error', detail: `Wings returned ${r.status}` }] }, 502);
    if (name === 'contents') {
      const buf = await r.arrayBuffer();
      c.header('Content-Type', r.headers.get('Content-Type') || 'application/octet-stream');
      c.header('Content-Disposition', r.headers.get('Content-Disposition') || '');
      return c.body(buf as never);
    }
    if (name === 'list-directory' || name === 'compress') return c.json({ data: await r.json().catch(() => []) });
    return c.json({ data: { ok: true } }, 204);
  };
  app.get('/:id/files', requireAuth, fileProxy('list-directory'));
  app.get('/:id/files/contents', requireAuth, fileProxy('contents'));
  app.get('/:id/files/download', requireAuth, fileProxy('download'));
  app.post('/:id/files/write', requireAuth, fileProxy('write'));
  app.post('/:id/files/create-directory', requireAuth, fileProxy('create-directory'));
  app.post('/:id/files/delete', requireAuth, fileProxy('delete'));
  app.post('/:id/files/rename', requireAuth, fileProxy('rename'));
  app.post('/:id/files/copy', requireAuth, fileProxy('copy'));
  app.post('/:id/files/compress', requireAuth, fileProxy('compress'));
  app.post('/:id/files/decompress', requireAuth, fileProxy('decompress'));
  app.get('/:id/allocations', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const node = await nodeFor(s);
    if (!node) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const all = await db.select().from(schema.allocations).where(eq(schema.allocations.nodeId, node.id));
    const mine = all.filter((a) => a.serverId === id).sort((a, b) => (a.id === s.allocationId ? -1 : 0) - (b.id === s.allocationId ? -1 : 0));
    const free = all.filter((a) => !a.serverId);
    const limit = s.allocationLimit;
    const canAdd = limit === 0 || mine.length < limit;
    return c.json({ data: { primary_id: s.allocationId, assigned: mine, limit, can_add: canAdd, free_count: free.length } });
  });
  app.post('/:id/allocations', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const node = await nodeFor(s);
    if (!node) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const all = await db.select().from(schema.allocations).where(eq(schema.allocations.nodeId, node.id));
    const mine = all.filter((a) => a.serverId === id);
    const free = all.filter((a) => !a.serverId);
    if (s.allocationLimit !== 0 && mine.length >= s.allocationLimit) return c.json({ errors: [{ code: 'limit', detail: `Allocation limit reached (${s.allocationLimit}).` }] }, 409);
    if (free.length === 0) return c.json({ errors: [{ code: 'no_free', detail: 'No free allocations on this node.' }] }, 409);
    const pick = free[Math.floor(Math.random() * free.length)];
    await db.update(schema.allocations).set({ serverId: id }).where(eq(schema.allocations.id, pick.id));
    await syncToWings(s);
    return c.json({ data: { ok: true, allocation: { id: pick.id, ip: pick.ip, port: pick.port, alias: pick.ipAlias } } }, 201);
  });
  app.delete('/:id/allocations/:aid', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const aid = parseInt(c.req.param('aid') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    if (s.allocationId === aid) return c.json({ errors: [{ code: 'validation', detail: 'Cannot remove the primary allocation' }] }, 422);
    const allocs = await db.select().from(schema.allocations).where(eq(schema.allocations.id, aid)).limit(1);
    const a = allocs[0];
    if (!a || a.serverId !== id) return c.json({ errors: [{ code: 'validation', detail: 'Allocation not assigned to this server' }] }, 422);
    await db.update(schema.allocations).set({ serverId: null }).where(eq(schema.allocations.id, aid));
    await syncToWings(s);
    return c.json({ data: { ok: true } });
  });
  app.get('/:id/variables', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const egg = await db.select().from(schema.eggs).where(eq(schema.eggs.id, s.eggId)).limit(1);
    const eggVars = egg[0] ? await db.select().from(schema.eggVariables).where(eq(schema.eggVariables.eggId, egg[0].id)) : [];
    const existing = await db.select().from(schema.serverVariables).where(eq(schema.serverVariables.serverId, s.id));
    const vars = eggVars.map((ev) => {
      const sv = existing.find((v) => v.variableId === ev.id);
      return { variable_id: ev.id, name: ev.name, description: ev.description, env_variable: ev.envVariable, default_value: ev.defaultValue, user_viewable: ev.userViewable, user_editable: ev.userEditable, rules: ev.rules, value: sv?.variableValue ?? ev.defaultValue, has_value: !!sv };
    });
    return c.json({ data: vars });
  });
  app.put('/:id/variables', requireAdmin, zJson(z.object({ variables: z.record(z.string()) })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const b = c.req.valid('json' as never) as { variables: Record<string, string> };
    const egg = await db.select().from(schema.eggs).where(eq(schema.eggs.id, s.eggId)).limit(1);
    const eggVars = egg[0] ? await db.select().from(schema.eggVariables).where(eq(schema.eggVariables.eggId, egg[0].id)) : [];
    const existing = await db.select().from(schema.serverVariables).where(eq(schema.serverVariables.serverId, s.id));
    for (const ev of eggVars) {
      const val = b.variables[ev.envVariable];
      if (val === undefined) continue;
      const sv = existing.find((v) => v.variableId === ev.id);
      if (sv) await db.update(schema.serverVariables).set({ variableValue: val }).where(eq(schema.serverVariables.id, sv.id));
      else await db.insert(schema.serverVariables).values({ serverId: s.id, variableId: ev.id, variableValue: val });
    }
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'server.variables.updated', targetType: 'server', targetId: String(id) });
    return c.json({ data: { ok: true } });
  });
  app.post('/:id/reinstall', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const node = await nodeFor(s);
    if (!node) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    await db.update(schema.servers).set({ status: 'installing' }).where(eq(schema.servers.id, id));
    try {
      const r = await fetch(`${wingsUrl(node)}/api/servers/${s.uuid}/install`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${node.daemonToken}` }, body: JSON.stringify({ reinstall: true }) });
      if (!r.ok) return c.json({ errors: [{ code: 'wings_error', detail: `Wings returned ${r.status}` }] }, 502);
    } catch (e) {
      return c.json({ errors: [{ code: 'wings_error', detail: `Wings unreachable (${String((e as Error).message)})` }] }, 502);
    }
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'server.reinstalled', targetType: 'server', targetId: String(id) });
    return c.json({ data: { ok: true } }, 202);
  });
  app.post('/:id/eula', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const node = await nodeFor(s);
    if (!node) return c.json({ errors: [{ code: 'not_found', detail: 'Node not found' }] }, 404);
    const body = await c.req.json().catch(() => ({ accept: true })) as { accept?: boolean };
    const accept = body.accept !== false;
    const content = accept
      ? '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\neula=true\n'
      : '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\neula=false\n';
    try {
      const r = await fetch(`${wingsUrl(node)}/api/servers/${s.uuid}/files/write?file=${encodeURIComponent('eula.txt')}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${node.daemonToken}` }, body: content });
      if (!r.ok) return c.json({ errors: [{ code: 'wings_error', detail: `Wings returned ${r.status}` }] }, 502);
    } catch (e) {
      return c.json({ errors: [{ code: 'wings_error', detail: `Wings unreachable (${String((e as Error).message)})` }] }, 502);
    }
    return c.json({ data: { ok: true, accepted: accept } });
  });
  app.get('/:id/startup', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const u = auth.user;
    const egg = await db.select().from(schema.eggs).where(eq(schema.eggs.id, s.eggId)).limit(1);
    const variables = await db.select().from(schema.serverVariables).where(eq(schema.serverVariables.serverId, s.id));
    const eggVars = egg[0] ? await db.select().from(schema.eggVariables).where(eq(schema.eggVariables.eggId, egg[0].id)) : [];
    const vars = eggVars.map((ev) => {
      const sv = variables.find((v) => v.variableId === ev.id);
      return { id: ev.id, name: ev.name, description: ev.description, env_variable: ev.envVariable, default_value: ev.defaultValue, user_viewable: ev.userViewable, user_editable: ev.userEditable, rules: ev.rules, value: sv?.variableValue ?? ev.defaultValue };
    });
    return c.json({ data: { name: s.name, startup: s.startup, image: s.image, dockerImages: egg[0]?.dockerImages || {}, variables: vars } });
  });
  app.put('/:id/startup/variables', requireAuth, zJson(z.object({ variables: z.record(z.string()) })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const u = auth.user;
    const b = c.req.valid('json' as never) as { variables: Record<string, string> };
    const eggVars = await db.select().from(schema.eggVariables).where(eq(schema.eggVariables.eggId, s.eggId));
    const existing = await db.select().from(schema.serverVariables).where(eq(schema.serverVariables.serverId, s.id));
    for (const ev of eggVars) {
      if (!ev.userEditable) continue;
      const val = b.variables[ev.envVariable];
      if (val === undefined) continue;
      const sv = existing.find((v) => v.variableId === ev.id);
      if (sv) await db.update(schema.serverVariables).set({ variableValue: val }).where(eq(schema.serverVariables.id, sv.id));
      else await db.insert(schema.serverVariables).values({ serverId: s.id, variableId: ev.id, variableValue: val });
    }
    return c.json({ data: { ok: true } });
  });
  app.patch('/:id/settings', requireAuth, zJson(z.object({ name: z.string().min(1).max(191).optional(), description: z.string().max(1000).nullable().optional(), image: z.string().min(1).max(512).optional(), startup: z.string().max(2048).optional() })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const s = await loadServer(id);
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const auth = await requireOwner(c as never, s);
    if ('res' in auth) return auth.res;
    const u = auth.user;
    const b = c.req.valid('json' as never) as { name?: string; description?: string | null; image?: string; startup?: string };
    const update: Record<string, unknown> = {};
    if (b.name !== undefined) update.name = b.name.trim();
    if (b.description !== undefined) update.description = b.description;
    if (b.image !== undefined) update.image = b.image;
    if (b.startup !== undefined) update.startup = b.startup;
    if (Object.keys(update).length === 0) return c.json({ errors: [{ code: 'validation', detail: 'No fields to update' }] }, 422);
    const [row] = await db.update(schema.servers).set(update).where(eq(schema.servers.id, id)).returning();
    return c.json({ data: row });
  });
  app.post('/:id/suspend', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const [r] = await db.update(schema.servers).set({ status: 'suspended' }).where(eq(schema.servers.id, id)).returning();
    if (!r) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'server.suspended', targetType: 'server', targetId: String(id) });
    return c.json({ data: r });
  });
  app.post('/:id/unsuspend', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const [r] = await db.update(schema.servers).set({ status: 'active' }).where(eq(schema.servers.id, id)).returning();
    if (!r) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'server.unsuspended', targetType: 'server', targetId: String(id) });
    return c.json({ data: r });
  });
  app.delete('/:id', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.servers).where(eq(schema.servers.id, id)).limit(1);
    const s = rows[0];
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    await deleteFromWings(s);
    await db.update(schema.allocations).set({ serverId: null }).where(eq(schema.allocations.id, s.allocationId));
    await db.delete(schema.serverVariables).where(eq(schema.serverVariables.serverId, id));
    const [deleted] = await db.delete(schema.servers).where(eq(schema.servers.id, id)).returning();
    const me = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await db.insert(schema.auditLogs).values({ userId: me.id, action: 'server.deleted', targetType: 'server', targetId: String(id), meta: { name: deleted?.name } });
    return c.json({ data: { ok: true } });
  });
  return app;
}
