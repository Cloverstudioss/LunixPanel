import { Hono } from 'hono';
import { eq, inArray, and, isNotNull } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { verifyPassword } from '../../lib/crypto.js';

function extractToken(c: { req: { header: (n: string) => string | undefined } }) {
  const h = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  return h || '';
}

function getConfigStr(cfg: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> {
  if (!cfg || cfg[key] === undefined || cfg[key] === null) return {};
  const v = cfg[key];
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return {}; }
  }
  return typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function envVarsFor(s: { uuid: string; uuidShort: string; startup: string; allocationLimit: number; backupLimit: number }, locationShort: string | null, vars: { envVariable: string; value: string }[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const v of vars) env[v.envVariable] = v.value;
  env['STARTUP'] = s.startup;
  env['P_SERVER_UUID'] = s.uuid;
  env['P_SERVER_LOCATION'] = locationShort || 'global';
  env['P_SERVER_ALLOCATION_LIMIT'] = String(s.allocationLimit);
  env['P_SERVER_DATABASE_LIMIT'] = '0';
  env['P_SERVER_BACKUP_LIMIT'] = String(s.backupLimit);
  return env;
}

async function serverConfig(db: Db, s: typeof schema.servers.$inferSelect) {
  const allocs = await db.select().from(schema.allocations).where(eq(schema.allocations.id, s.allocationId)).limit(1);
  const alloc = allocs[0];
  const egg = await db.select().from(schema.eggs).where(eq(schema.eggs.id, s.eggId)).limit(1);
  const eggVars = egg[0] ? await db.select().from(schema.eggVariables).where(eq(schema.eggVariables.eggId, egg[0].id)) : [];
  const sVars = await db.select().from(schema.serverVariables).where(eq(schema.serverVariables.serverId, s.id));
  const node = await db.select().from(schema.nodes).where(eq(schema.nodes.id, s.nodeId)).limit(1);
  const loc = node[0]?.locationId ? await db.select().from(schema.locations).where(eq(schema.locations.id, node[0].locationId)).limit(1) : [];

  const vars = eggVars.map((ev) => {
    const sv = sVars.find((v) => v.variableId === ev.id);
    return { envVariable: ev.envVariable, value: sv?.variableValue ?? ev.defaultValue };
  });

  const cfg = (egg[0]?.config ?? {}) as Record<string, unknown>;
  const eggCfg = egg[0] ? { id: egg[0].uuid, file_denylist: [] as string[] } : { id: '', file_denylist: [] as string[] };

  const files = getConfigStr(cfg, 'files');
  const configs: unknown[] = [];
  for (const [file, data] of Object.entries(files)) {
    if (!data || typeof data !== 'object') continue;
    const d = data as Record<string, unknown>;
    const find = (d.find && typeof d.find === 'object' ? d.find : {}) as Record<string, unknown>;
    const replace: unknown[] = [];
    for (const [match, rv] of Object.entries(find)) {
      if (rv && typeof rv === 'object') {
        for (const [ifValue, replaceWith] of Object.entries(rv as Record<string, unknown>)) {
          replace.push({ match, if_value: ifValue, replace_with: String(replaceWith) });
        }
      } else {
        replace.push({ match, replace_with: String(rv) });
      }
    }
    configs.push({ file, parser: d.parser ?? 'properties', replace });
  }

  const startupCfg = getConfigStr(cfg, 'startup');
  const done = startupCfg.done !== undefined ? (Array.isArray(startupCfg.done) ? startupCfg.done : [String(startupCfg.done)]) : [];
  const stopRaw = cfg.stop !== undefined ? String(cfg.stop) : 'stop';
  const stop = stopRaw.startsWith('^')
    ? { type: 'signal', value: stopRaw.slice(1).toUpperCase() }
    : { type: 'command', value: stopRaw };

  const processConfiguration = {
    startup: { done, user_interaction: [], strip_ansi: true },
    stop,
    configs,
  };

  const settings = {
    uuid: s.uuid,
    meta: { name: s.name, description: s.description ?? '' },
    suspended: s.status === 'suspended',
    invocation: s.startup,
    skip_egg_scripts: false,
    environment: envVarsFor(s, loc[0]?.short ?? null, vars),
    labels: {},
    allocations: {
      force_outgoing_ip: false,
      default: { ip: alloc?.ip ?? '0.0.0.0', port: alloc?.port ?? 0 },
      mappings: alloc ? { [alloc.ip]: [alloc.port] } : {},
    },
    build: {
      memory_limit: s.memory,
      swap: s.swap,
      io_weight: s.io,
      cpu_limit: s.cpu,
      disk_space: s.disk,
      threads: s.threads ?? null,
      oom_disabled: s.oomDisabled,
    },
    crash_detection_enabled: true,
    mounts: [{ target: '/home/container', source: `${node[0]?.daemonBase ?? '/var/lib/pterodactyl/volumes'}/${s.uuid}`, read_only: false }],
    egg: eggCfg,
    container: { image: s.image },
  };

  return { settings, process_configuration: processConfiguration };
}

export default function remoteRoutes(db: Db) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const raw = extractToken(c as never);
    if (!raw) return c.json({ errors: [{ code: 'forbidden', detail: 'Missing daemon token' }] }, 403);
    const nodes = await db.select().from(schema.nodes);
    if (nodes.length === 0) return c.json({ errors: [{ code: 'forbidden', detail: 'No nodes configured' }] }, 403);
    const candidates = raw.includes('.') ? raw.split('.') : [raw];
    const node = nodes.find((n) => candidates.includes(n.daemonToken) || candidates.includes(n.uuid) || n.daemonToken === raw || n.uuid === raw);
    if (!node) {
      console.warn(`[remote] 403 invalid daemon token len=${raw.length} prefix=${raw.slice(0, 12)} nodes=${nodes.length}`);
      return c.json({ errors: [{ code: 'forbidden', detail: 'Invalid daemon token' }] }, 403);
    }
    (c as unknown as { set: (k: string, v: unknown) => void }).set('node', node);
    await next();
  });
  app.post('/servers/reset', async (c) => {
    await db.update(schema.servers)
      .set({ status: 'active' })
      .where(and(inArray(schema.servers.status, ['installing', 'restoring']), isNotNull(schema.servers.installedAt)));
    return c.body(null, 204);
  });
  app.get('/servers', async (c) => {
    const node = (c as unknown as { get: (k: string) => unknown }).get('node') as typeof schema.nodes.$inferSelect;
    const servers = await db.select().from(schema.servers).where(eq(schema.servers.nodeId, node.id));
    const page = parseInt((c.req.query('page') as string) || '0', 10) || 0;
    const perPage = Math.max(1, parseInt((c.req.query('per_page') as string) || '50', 10));
    const data = await Promise.all(servers.map(async (s) => ({ uuid: s.uuid, ...(await serverConfig(db, s)) })));
    const total = data.length;
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    return c.json({ data, meta: { current_page: page, from: 0, last_page: lastPage, per_page: perPage, to: total, total } });
  });
  app.get('/servers/:uuid', async (c) => {
    const uuid = c.req.param('uuid') || '';
    const rows = await db.select().from(schema.servers).where(eq(schema.servers.uuid, uuid)).limit(1);
    const s = rows[0];
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    return c.json(await serverConfig(db, s));
  });
  app.get('/servers/:uuid/install', async (c) => {
    const uuid = c.req.param('uuid') || '';
    const rows = await db.select().from(schema.servers).where(eq(schema.servers.uuid, uuid)).limit(1);
    const s = rows[0];
    if (!s) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    const egg = await db.select().from(schema.eggs).where(eq(schema.eggs.id, s.eggId)).limit(1);
    const script = (egg[0]?.script ?? {}) as Record<string, unknown>;
    return c.json({
      container_image: script.container || script.image || 'ghcr.io/pterodactyl/installers:alpine',
      entrypoint: script.entrypoint || script.entry || 'ash',
      script: String(script.script || script.install || '#!/bin/ash\necho ok'),
    });
  });
  app.post('/servers/:uuid/install', async (c) => {
    const uuid = c.req.param('uuid') || '';
    const body = await c.req.json().catch(() => ({ successful: true })) as { successful?: boolean };
    const [row] = await db.update(schema.servers)
      .set({ status: body.successful === false ? 'installing' : 'active', installedAt: new Date() })
      .where(eq(schema.servers.uuid, uuid))
      .returning();
    if (!row) return c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404);
    return c.body(null, 204);
  });
  app.post('/sftp/auth', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { username?: string; password?: string };
    const username = (body.username || '').trim();
    const idx = username.lastIndexOf('.');
    let uuidShort = username;
    let uname = username;
    if (idx !== -1) { uuidShort = username.slice(idx + 1); uname = username.slice(0, idx); }
    const servers = await db.select().from(schema.servers).where(eq(schema.servers.uuidShort, uuidShort)).limit(1);
    const s = servers[0];
    if (!s) return c.json({ errors: [{ code: 'forbidden', detail: 'Invalid credentials' }] }, 401);
    const users = await db.select().from(schema.users).where(eq(schema.users.username, uname)).limit(1);
    const u = users[0];
    if (!u) return c.json({ errors: [{ code: 'forbidden', detail: 'Invalid credentials' }] }, 401);
    if (u.status !== 'active' || s.status === 'suspended') return c.json({ errors: [{ code: 'forbidden', detail: 'Account unavailable' }] }, 401);
    if (u.isAdmin || s.userId === u.id) {
      const ok = await verifyPassword(u.passwordHash, body.password || '').catch(() => false);
      if (!ok) return c.json({ errors: [{ code: 'forbidden', detail: 'Invalid credentials' }] }, 401);
      return c.json({ server: s.uuid, user: u.uuid, permissions: ['*'] });
    }
    return c.json({ errors: [{ code: 'forbidden', detail: 'Invalid credentials' }] }, 401);
  });
  app.post('/backups/:backup', async (c) => {
    const backupUuid = c.req.param('backup') || '';
    const body = await c.req.json().catch(() => ({})) as { checksum?: string; checksum_type?: string; size?: number; successful?: boolean };
    const rows = await db.select().from(schema.backups).where(eq(schema.backups.uuid, backupUuid)).limit(1);
    const b = rows[0];
    if (!b) return c.json({ errors: [{ code: 'not_found', detail: 'Backup not found' }] }, 404);
    const successful = body.successful !== false;
    await db.update(schema.backups).set({
      status: successful ? 'completed' : 'failed',
      size: successful && body.size !== undefined ? body.size : b.size,
      completedAt: new Date(),
    }).where(eq(schema.backups.id, b.id));
    return c.body(null, 204);
  });
  app.post('/backups/:backup/restore', async (c) => {
    const backupUuid = c.req.param('backup') || '';
    const body = await c.req.json().catch(() => ({})) as { successful?: boolean };
    const rows = await db.select().from(schema.backups).where(eq(schema.backups.uuid, backupUuid)).limit(1);
    const b = rows[0];
    if (!b) return c.json({ errors: [{ code: 'not_found', detail: 'Backup not found' }] }, 404);
    if (body.successful !== false) {
      await db.update(schema.servers).set({ status: 'active' }).where(eq(schema.servers.id, b.serverId));
    }
    return c.body(null, 204);
  });
  return app;
}