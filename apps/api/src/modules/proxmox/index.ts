import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { eq, and, ne } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { encrypt } from '../../lib/crypto.js';
import { listNodes, listVms, vmAction, getVmStatus, getVmConfig, vncProxy, createQemu, createLxc, listStorages, listStorageContent, listNetworkInterfaces, deleteVm, renameVm, waitForTask, listSnapshots, createSnapshot, rollbackSnapshot, deleteSnapshot, createBackup, listBackups, restoreQemu, restoreLxc, getVmRrdData, getTaskStatus } from '../../lib/proxmox-client.js';
import { audit, auditIp } from '../../lib/audit.js';

const QEMU_ACTIONS = ['start', 'stop', 'shutdown', 'reboot', 'suspend', 'resume'];
const LXC_ACTIONS = ['start', 'stop', 'shutdown', 'reboot'];

function zJson<T extends z.ZodTypeAny>(s: T) {
  return validator('json', (value, c) => {
    const r = s.safeParse(value);
    if (!r.success) return c.json({ errors: [{ code: 'validation', detail: r.error.message }] }, 422);
    return r.data as z.infer<T>;
  });
}

const fqdnRe = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export default function proxmoxRoutes(db: Db) {
  const app = new Hono();
  app.get('/vms', requireAuth, async (c) => {
    const key = process.env.ENCRYPTION_KEY;
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number; isAdmin: boolean };
    if (!key || key.length < 64) return c.json({ data: [] });
    const clusters = await db.select().from(schema.proxmoxClusters);
    const assignments = await db.select().from(schema.proxmoxVmAssignments);
    const assignMap = new Map(assignments.map((a) => [`${a.clusterId}:${a.node}:${a.type}:${a.vmid}`, a]));
    const all: { clusterId: number; clusterName: string; node: string; type: string; vmid: number; name: string; status: string; maxmem: number; maxdisk: number; cpus: number; assignmentId?: number; ownerId?: number }[] = [];
    for (const cl of clusters) {
      try {
        const vms = await listVms(cl as never, key);
        for (const v of vms) {
          const k = `${cl.id}:${v.node}:${v.type}:${v.vmid}`;
          const a = assignMap.get(k);
          all.push({ clusterId: cl.id, clusterName: cl.name, ...v, assignmentId: a?.id, ownerId: a?.userId });
        }
      } catch {}
    }
    const filtered = u.isAdmin ? all : all.filter((r) => r.ownerId === u.id);
    return c.json({ data: filtered });
  });
  app.get('/clusters', requireAdmin, async (c) => {
    const rows = await db.select().from(schema.proxmoxClusters);
    return c.json({ data: rows.map((r) => ({ ...r, apiTokenSecretEncrypted: undefined })) });
  });
  app.post('/clusters', requireAdmin, zJson(z.object({ name: z.string().min(1).max(191), host: z.string().url(), api_token_id: z.string().min(1).max(191), api_token_secret: z.string().min(1), verify_tls: z.boolean().optional() })), async (c) => {
    const body = c.req.valid('json' as never) as { name: string; host: string; api_token_id: string; api_token_secret: string; verify_tls?: boolean };
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const key = process.env.ENCRYPTION_KEY;
    if (!key || key.length < 64) return c.json({ errors: [{ code: 'config', detail: 'ENCRYPTION_KEY not set (64 hex chars)' }] }, 500);
    const host = body.host.replace(/\/$/, '');
    try { new URL(host); } catch { return c.json({ errors: [{ code: 'validation', detail: 'Host must be a valid URL like https://pve.example:8006' }] }, 422); }
    const enc = encrypt(body.api_token_secret, key);
    const [row] = await db.insert(schema.proxmoxClusters).values({ name: body.name.trim(), host, apiTokenId: body.api_token_id.trim(), apiTokenSecretEncrypted: enc, verifyTls: body.verify_tls ?? false, createdBy: admin.id }).returning();
    await audit(db, admin.id, 'proxmox.cluster.created', 'proxmox_cluster', String(row.id), auditIp(c), { host });
    return c.json({ data: { ...row, apiTokenSecretEncrypted: undefined } }, 201);
  });
  app.get('/clusters/:id', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    let health: { status: string; version?: string | null; detail?: string } = { status: 'unknown' };
    try {
      const r = await fetch(`${cluster.host.replace(/\/$/, '')}/api2/json/version`, {
        headers: { Authorization: `PVEAPIToken=${cluster.apiTokenId}=${(await import('../../lib/crypto.js')).decrypt(cluster.apiTokenSecretEncrypted, key)}` },
        tls: { rejectUnauthorized: !!cluster.verifyTls },
        signal: AbortSignal.timeout(15000),
      } as RequestInit);
      health = r.ok ? { status: 'online', version: ((await r.json().catch(() => ({}))) as { data?: { version?: string } }).data?.version || null } : { status: 'error', detail: `HTTP ${r.status}` };
    } catch (e) { health = { status: 'error', detail: String((e as Error).message) }; }
    const assignments = await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.clusterId, id));
    return c.json({ data: { ...cluster, apiTokenSecretEncrypted: undefined, health, assignments_count: assignments.length } });
  });
  app.patch('/clusters/:id', requireAdmin, zJson(z.object({ name: z.string().min(1).max(191).optional(), host: z.string().url().optional(), api_token_id: z.string().min(1).max(191).optional(), api_token_secret: z.string().min(1).optional(), verify_tls: z.boolean().optional() })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const body = c.req.valid('json' as never) as { name?: string; host?: string; api_token_id?: string; api_token_secret?: string; verify_tls?: boolean };
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name.trim();
    if (body.host !== undefined) { const h = body.host.replace(/\/$/, ''); try { new URL(h); } catch { return c.json({ errors: [{ code: 'validation', detail: 'Invalid host URL' }] }, 422); } update.host = h; }
    if (body.api_token_id !== undefined) update.apiTokenId = body.api_token_id.trim();
    if (body.api_token_secret !== undefined && body.api_token_secret.trim()) { const key = process.env.ENCRYPTION_KEY!; update.apiTokenSecretEncrypted = encrypt(body.api_token_secret, key); }
    if (body.verify_tls !== undefined) update.verifyTls = body.verify_tls;
    if (Object.keys(update).length === 0) return c.json({ errors: [{ code: 'validation', detail: 'No fields to update' }] }, 422);
    const [row] = await db.update(schema.proxmoxClusters).set(update).where(eq(schema.proxmoxClusters.id, id)).returning();
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.cluster.updated', 'proxmox_cluster', String(id), auditIp(c), { fields: Object.keys(update) });
    return c.json({ data: { ...row, apiTokenSecretEncrypted: undefined } });
  });
  app.delete('/clusters/:id', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const assigns = await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.clusterId, id)).limit(1);
    if (assigns[0]) return c.json({ errors: [{ code: 'conflict', detail: 'Cannot delete cluster with assigned VMs. Unassign first.' }] }, 409);
    await db.delete(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id));
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.cluster.deleted', 'proxmox_cluster', String(id), auditIp(c), {});
    return c.json({ data: { ok: true } });
  });
  app.get('/clusters/:id/nodes', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const data = await listNodes(cluster as never, key);
      return c.json({ data });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.get('/clusters/:id/storages', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const node = c.req.query('node') as string || '';
    if (!node) return c.json({ errors: [{ code: 'validation', detail: 'node query required' }] }, 422);
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const data = await listStorages(cluster as never, key, node);
      return c.json({ data });
    } catch (e) { return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502); }
  });
  app.get('/clusters/:id/content', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const node = c.req.query('node') as string || '';
    const storage = c.req.query('storage') as string || '';
    const content = (c.req.query('content') as string) || undefined;
    if (!node || !storage) return c.json({ errors: [{ code: 'validation', detail: 'node and storage required' }] }, 422);
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const data = await listStorageContent(cluster as never, key, node, storage, content);
      return c.json({ data });
    } catch (e) { return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502); }
  });
  app.get('/clusters/:id/fetch-templates', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const nodes = await listNodes(cluster as never, key) as { node: string }[];
      const results: { node: string; storage: string; volid: string; content: string; size: number; format?: string }[] = [];
      for (const n of nodes) {
        const storages = await listStorages(cluster as never, key, n.node);
        for (const s of storages) {
          if (!s.content.includes('iso') && !s.content.includes('vztmpl')) continue;
          const contentTypes = s.content.includes('iso') && s.content.includes('vztmpl') ? 'iso,vztmpl' : s.content.includes('iso') ? 'iso' : 'vztmpl';
          try {
            const items = await listStorageContent(cluster as never, key, n.node, s.storage, contentTypes);
            for (const item of items) {
              if (item.content === 'iso' || item.content === 'vztmpl') {
                const ext = item.volid.split('.').pop()?.toLowerCase() || '';
                results.push({ node: n.node, storage: s.storage, volid: item.volid, content: item.content, size: item.size, format: ext });
              }
            }
          } catch {}
        }
      }
      return c.json({ data: results });
    } catch (e) { return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502); }
  });
  app.get('/clusters/:id/fetch-ips', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const nodes = await listNodes(cluster as never, key) as { node: string }[];
      const existingIps = await db.select({ address: schema.proxmoxIps.address }).from(schema.proxmoxIps).where(eq(schema.proxmoxIps.clusterId, id));
      const existingSet = new Set(existingIps.map((i) => i.address));
      const results: { node: string; iface: string; address: string; netmask: string; gateway?: string; bridge: string }[] = [];
      for (const n of nodes) {
        try {
          const ifaces = await listNetworkInterfaces(cluster as never, key, n.node);
          for (const iface of ifaces) {
            if (!iface.address || iface.type !== 'eth' || iface.iface === 'lo') continue;
            const addr = iface.netmask ? `${iface.address}/${iface.netmask.replace(/^\//, '')}` : iface.address;
            if (!existingSet.has(addr)) {
              results.push({ node: n.node, iface: iface.iface, address: addr, netmask: iface.netmask || '', gateway: iface.gateway, bridge: 'vmbr0' });
            }
          }
        } catch {}
      }
      return c.json({ data: results });
    } catch (e) { return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502); }
  });
  app.get('/clusters/:id/vms', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    const assignments = await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.clusterId, id));
    const assignMap = new Map(assignments.map((a) => [`${a.node}:${a.type}:${a.vmid}`, a]));
    const users = await db.select({ id: schema.users.id, username: schema.users.username, email: schema.users.email }).from(schema.users);
    const userMap = new Map(users.map((u) => [u.id, u]));
    try {
      const vms = await listVms(cluster as never, key);
      const data = vms.map((v) => {
        const a = assignMap.get(`${v.node}:${v.type}:${v.vmid}`);
        const owner = a ? userMap.get(a.userId) : null;
        return { ...v, clusterId: id, clusterName: cluster.name, assignmentId: a?.id ?? null, ownerId: a?.userId ?? null, owner: owner ? { id: owner.id, username: owner.username, email: owner.email } : null };
      });
      return c.json({ data });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.get('/templates', requireAdmin, async (c) => {
    const rows = await db.select().from(schema.proxmoxTemplates);
    return c.json({ data: rows });
  });
  app.get('/templates/:id', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxTemplates).where(eq(schema.proxmoxTemplates.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Template not found' }] }, 404);
    return c.json({ data: rows[0] });
  });
  app.post('/templates', requireAdmin, zJson(z.object({
    name: z.string().min(1).max(191),
    description: z.string().optional(),
    type: z.enum(['qemu', 'lxc']),
    storage: z.string().max(191).optional(),
    iso: z.string().max(512).optional(),
    ostemplate: z.string().max(512).optional(),
    defaultCores: z.number().int().min(1).max(64).optional(),
    defaultMemory: z.number().int().min(128).max(262144).optional(),
    defaultDisk: z.number().int().min(1).max(10000).optional(),
    banner: z.string().url().optional(),
  })), async (c) => {
    const b = c.req.valid('json' as never) as { name: string; description?: string; type: 'qemu' | 'lxc'; storage?: string; iso?: string; ostemplate?: string; defaultCores?: number; defaultMemory?: number; defaultDisk?: number; banner?: string };
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const existing = await db.select().from(schema.proxmoxTemplates).where(eq(schema.proxmoxTemplates.name, b.name.trim())).limit(1);
    if (existing[0]) return c.json({ errors: [{ code: 'conflict', detail: 'Template name already exists' }] }, 409);
    if (b.type === 'lxc' && !b.ostemplate) return c.json({ errors: [{ code: 'validation', detail: 'ostemplate required for LXC' }] }, 422);
    if (b.type === 'qemu' && !b.iso && !b.storage) return c.json({ errors: [{ code: 'validation', detail: 'iso or storage required for QEMU' }] }, 422);
    if (b.banner && !/^(https?):\/\/.+/.test(b.banner)) return c.json({ errors: [{ code: 'validation', detail: 'Banner must be a valid URL' }] }, 422);
    const [row] = await db.insert(schema.proxmoxTemplates).values({
      name: b.name.trim(),
      description: b.description || null,
      type: b.type,
      storage: b.storage || null,
      iso: b.iso || null,
      ostemplate: b.ostemplate || null,
      defaultCores: b.defaultCores,
      defaultMemory: b.defaultMemory,
      defaultDisk: b.defaultDisk,
      banner: b.banner || null,
    }).returning();
    await audit(db, admin.id, 'proxmox.template.created', 'proxmox_template', String(row.id), auditIp(c), { name: row.name, type: row.type });
    return c.json({ data: row }, 201);
  });
  app.patch('/templates/:id', requireAdmin, zJson(z.object({
    name: z.string().min(1).max(191).optional(),
    description: z.string().optional(),
    type: z.enum(['qemu', 'lxc']).optional(),
    storage: z.string().max(191).optional(),
    iso: z.string().max(512).optional(),
    ostemplate: z.string().max(512).optional(),
    defaultCores: z.number().int().min(1).max(64).optional(),
    defaultMemory: z.number().int().min(128).max(262144).optional(),
    defaultDisk: z.number().int().min(1).max(10000).optional(),
    banner: z.string().url().optional(),
  })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as Record<string, unknown>;
    const rows = await db.select().from(schema.proxmoxTemplates).where(eq(schema.proxmoxTemplates.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Template not found' }] }, 404);
    const update: Record<string, unknown> = {};
    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (name.length === 0) return c.json({ errors: [{ code: 'validation', detail: 'Name cannot be empty' }] }, 422);
      const dup = await db
        .select()
        .from(schema.proxmoxTemplates)
        .where(and(eq(schema.proxmoxTemplates.name, name), ne(schema.proxmoxTemplates.id, id)))
        .limit(1);
      if (dup[0]) return c.json({ errors: [{ code: 'conflict', detail: 'Template name already exists' }] }, 409);
      update.name = name;
    }
    if (b.description !== undefined) update.description = (b.description as string) || null;
    if (b.type !== undefined) update.type = b.type as string;
    if (b.storage !== undefined) update.storage = (b.storage as string) || null;
    if (b.iso !== undefined) update.iso = (b.iso as string) || null;
    if (b.ostemplate !== undefined) update.ostemplate = (b.ostemplate as string) || null;
    if (b.defaultCores !== undefined) update.defaultCores = b.defaultCores as number;
    if (b.defaultMemory !== undefined) update.defaultMemory = b.defaultMemory as number;
    if (b.defaultDisk !== undefined) update.defaultDisk = b.defaultDisk as number;
    if (b.banner !== undefined) {
      const banner = (b.banner as string) || null;
      if (banner && !/^(https?):\/\/.+/.test(banner)) return c.json({ errors: [{ code: 'validation', detail: 'Banner must be a valid URL' }] }, 422);
      update.banner = banner;
    }
    const [row] = await db.update(schema.proxmoxTemplates).set(update).where(eq(schema.proxmoxTemplates.id, id)).returning();
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.template.updated', 'proxmox_template', String(id), auditIp(c), { fields: Object.keys(update) });
    return c.json({ data: row });
  });
  app.delete('/templates/:id', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxTemplates).where(eq(schema.proxmoxTemplates.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Template not found' }] }, 404);
    await db.delete(schema.proxmoxTemplates).where(eq(schema.proxmoxTemplates.id, id));
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.template.deleted', 'proxmox_template', String(id), auditIp(c), {});
    return c.json({ data: { ok: true } });
  });

  app.get('/clusters/:id/ips', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const node = (c.req.query('node') as string) || '';
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const assignments = await db.select({ id: schema.proxmoxVmAssignments.id, vmid: schema.proxmoxVmAssignments.vmid, userId: schema.proxmoxVmAssignments.userId, type: schema.proxmoxVmAssignments.type }).from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.clusterId, id));
    const assignMap = new Map(assignments.map((a) => [a.id, a]));
    const users = await db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const q = node
      ? db.select().from(schema.proxmoxIps).where(and(eq(schema.proxmoxIps.clusterId, id), eq(schema.proxmoxIps.node, node)))
      : db.select().from(schema.proxmoxIps).where(eq(schema.proxmoxIps.clusterId, id));
    const ips = await q;
    const data = ips
      .map((i) => {
        const a = i.assignmentId ? assignMap.get(i.assignmentId) : null;
        const owner = a?.userId ? userMap.get(a.userId) : null;
        return {
          id: i.id,
          node: i.node,
          bridge: i.bridge,
          address: i.address,
          gateway: i.gateway,
          vlan: i.vlan,
          description: i.description,
          assigned: a
            ? { vmid: a.vmid, type: a.type, user: owner ? { id: owner.id, username: owner.username } : null }
            : null,
        };
      })
      .sort((a, b) => (a.assigned ? 1 : -1) - (b.assigned ? 1 : -1));
    return c.json({ data });
  });
  app.post('/clusters/:id/ips', requireAdmin, zJson(z.object({
    node: z.string().min(1).max(191),
    bridge: z.string().min(1).max(191).default('vmbr0'),
    address: z.string().min(1).max(191),
    gateway: z.string().max(191).optional(),
    vlan: z.number().int().min(1).max(4094).optional(),
    description: z.string().max(191).optional(),
  })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as { node: string; bridge: string; address: string; gateway?: string; vlan?: number; description?: string };
    const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1).then((r) => r[0]);
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    if (!/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(b.address))
      return c.json({ errors: [{ code: 'validation', detail: 'Address must be CIDR like 10.0.0.10/24' }] }, 422);
    const existing = await db
      .select()
      .from(schema.proxmoxIps)
      .where(and(eq(schema.proxmoxIps.clusterId, id), eq(schema.proxmoxIps.address, b.address)))
      .limit(1);
    if (existing[0]) return c.json({ errors: [{ code: 'conflict', detail: 'IP already in pool for this cluster' }] }, 409);
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const [row] = await db
      .insert(schema.proxmoxIps)
      .values({ clusterId: id, node: b.node, bridge: b.bridge, address: b.address, gateway: b.gateway, vlan: b.vlan, description: b.description })
      .returning();
    await audit(db, admin.id, 'proxmox.ip.created', 'proxmox_ip', String(row.id), auditIp(c), { address: b.address, node: b.node });
    return c.json({ data: row }, 201);
  });
  app.patch('/clusters/:id/ips/:ipId', requireAdmin, zJson(z.object({
    gateway: z.string().max(191).optional(),
    vlan: z.number().int().min(1).max(4094).nullable().optional(),
    description: z.string().max(191).optional(),
  })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const ipId = parseInt(c.req.param('ipId') || '0', 10);
    const b = c.req.valid('json' as never) as { gateway?: string; vlan?: number | null; description?: string };
    const rows = await db.select().from(schema.proxmoxIps).where(eq(schema.proxmoxIps.id, ipId)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'IP not found' }] }, 404);
    if (rows[0].clusterId !== id) return c.json({ errors: [{ code: 'not_found', detail: 'IP not found' }] }, 404);
    if (rows[0].assignmentId)
      return c.json({ errors: [{ code: 'conflict', detail: 'Cannot edit address while assigned' }] }, 409);
    const update: Record<string, unknown> = {};
    if (b.gateway !== undefined) update.gateway = b.gateway;
    if (b.vlan !== undefined) update.vlan = b.vlan;
    if (b.description !== undefined) update.description = b.description;
    if (Object.keys(update).length === 0) return c.json({ errors: [{ code: 'validation', detail: 'No fields to update' }] }, 422);
    const [row] = await db.update(schema.proxmoxIps).set(update).where(eq(schema.proxmoxIps.id, ipId)).returning();
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.ip.updated', 'proxmox_ip', String(ipId), auditIp(c), { fields: Object.keys(update) });
    return c.json({ data: row });
  });
  app.delete('/clusters/:id/ips/:ipId', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const ipId = parseInt(c.req.param('ipId') || '0', 10);
    const rows = await db.select().from(schema.proxmoxIps).where(eq(schema.proxmoxIps.id, ipId)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'IP not found' }] }, 404);
    if (rows[0].clusterId !== id) return c.json({ errors: [{ code: 'not_found', detail: 'IP not found' }] }, 404);
    if (rows[0].assignmentId) return c.json({ errors: [{ code: 'conflict', detail: 'Cannot delete assigned IP' }] }, 409);
    await db.delete(schema.proxmoxIps).where(eq(schema.proxmoxIps.id, ipId));
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.ip.deleted', 'proxmox_ip', String(ipId), auditIp(c), {});
    return c.json({ data: { ok: true } });
  });
  app.post('/clusters/test-connection', requireAdmin, zJson(z.object({ host: z.string().url(), api_token_id: z.string().min(1), api_token_secret: z.string().min(1), verify_tls: z.boolean().optional() })), async (c) => {
    const b = c.req.valid('json' as never) as { host: string; api_token_id: string; api_token_secret: string; verify_tls?: boolean };
    const host = b.host.replace(/\/$/, '');
    try {
      const headers = { Authorization: `PVEAPIToken=${b.api_token_id}=${b.api_token_secret}` };
      const [versionRes, nodesRes] = await Promise.all([
        fetch(`${host}/api2/json/version`, { headers, tls: { rejectUnauthorized: !!b.verify_tls }, signal: AbortSignal.timeout(15000) } as RequestInit),
        fetch(`${host}/api2/json/nodes`, { headers, tls: { rejectUnauthorized: !!b.verify_tls }, signal: AbortSignal.timeout(15000) } as RequestInit),
      ]);
      if (!versionRes.ok) return c.json({ errors: [{ code: 'auth_failed', detail: `Authentication failed — HTTP ${versionRes.status}` }] }, 422);
      const versionData = await versionRes.json().catch(() => ({})) as { data?: { version?: string; release?: string } };
      const nodesData = nodesRes.ok ? await nodesRes.json().catch(() => ({ data: [] })) as { data?: { node: string; status: string; cpu?: number; mem?: number; maxmem?: number; uptime?: number }[] } : { data: [] };
      const nodes = (nodesData.data || []).map((n) => ({ node: n.node, status: n.status, cpu: n.cpu ?? null, mem: n.mem ?? null, maxmem: n.maxmem ?? null, uptime: n.uptime ?? null }));
      return c.json({ data: { ok: true, version: versionData.data?.version || null, release: versionData.data?.release || null, nodes } });
    } catch (e) {
      return c.json({ errors: [{ code: 'connection_failed', detail: `Cannot reach ${host} — ${(e as Error).message}` }] }, 422);
    }
  });
  app.post('/assignments', requireAdmin, zJson(z.object({ clusterId: z.number().int(), node: z.string().min(1), type: z.enum(['qemu', 'lxc']), vmid: z.number().int(), userId: z.number().int(), expiresAt: z.string().datetime().nullable().optional() })), async (c) => {
    const b = c.req.valid('json' as never) as { clusterId: number; node: string; type: 'qemu' | 'lxc'; vmid: number; userId: number; expiresAt?: string | null };
    const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, b.clusterId)).limit(1).then((r) => r[0]);
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const user = await db.select().from(schema.users).where(eq(schema.users.id, b.userId)).limit(1).then((r) => r[0]);
    if (!user) return c.json({ errors: [{ code: 'not_found', detail: 'User not found' }] }, 404);
    const existing = await db.select().from(schema.proxmoxVmAssignments).where(and(eq(schema.proxmoxVmAssignments.clusterId, b.clusterId), eq(schema.proxmoxVmAssignments.node, b.node), eq(schema.proxmoxVmAssignments.type, b.type), eq(schema.proxmoxVmAssignments.vmid, b.vmid))).limit(1);
    if (existing[0]) return c.json({ errors: [{ code: 'conflict', detail: 'VM already assigned' }] }, 409);
    const [row] = await db.insert(schema.proxmoxVmAssignments).values({ clusterId: b.clusterId, node: b.node, type: b.type, vmid: b.vmid, userId: b.userId, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null }).returning();
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.assigned', 'proxmox_vm', String(row.id), auditIp(c), { clusterId: b.clusterId, node: b.node, type: b.type, vmid: b.vmid, userId: b.userId });
    return c.json({ data: row }, 201);
  });
  app.patch('/assignments/:id', requireAdmin, zJson(z.object({ expiresAt: z.string().datetime().nullable().optional() })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as { expiresAt?: string | null };
    const rows = await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Assignment not found' }] }, 404);
    const update: Record<string, unknown> = {};
    if (b.expiresAt !== undefined) update.expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    // Clearing expiry or moving it forward reactivates a suspended VPS.
    if (b.expiresAt === null || (b.expiresAt && new Date(b.expiresAt) > new Date())) {
      update.graceUntil = null;
      update.suspendedAt = null;
      update.suspendedReason = null;
    }
    const [row] = await db.update(schema.proxmoxVmAssignments).set(update).where(eq(schema.proxmoxVmAssignments.id, id)).returning();
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.assignment.updated', 'proxmox_vm', String(id), auditIp(c), { fields: Object.keys(update) });
    return c.json({ data: row });
  });
  app.delete('/assignments/:id', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Assignment not found' }] }, 404);
    await db.delete(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.id, id));
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.unassigned', 'proxmox_vm', String(id), auditIp(c), {});
    return c.json({ data: { ok: true } });
  });
  app.post('/clusters/:id/vms', requireAdmin, zJson(z.object({
    node: z.string().min(1).max(191),
    type: z.enum(['qemu', 'lxc']),
    vmid: z.number().int().min(100).max(999999999).optional(),
    hostname: z.string().min(1).max(191).optional(),
    name: z.string().min(1).max(191).optional(),
    cores: z.number().int().min(1).max(64).optional(),
    sockets: z.number().int().min(1).max(8).optional(),
    memory: z.number().int().min(128).max(262144).optional(),
    balloon: z.number().int().min(0).optional(),
    disk: z.number().int().min(1).max(10000).optional(),
    storage: z.string().min(1).max(191).optional(),
    bridge: z.string().min(1).max(191).optional(),
    vlan: z.number().int().min(1).max(4094).nullable().optional(),
    ip: z.string().min(1).max(191).optional(),
    gateway: z.string().min(1).max(191).optional(),
    nameserver: z.string().max(191).optional(),
    searchdomain: z.string().max(191).optional(),
    iso: z.string().max(512).optional(),
    ostemplate: z.string().max(512).optional(),
    sshkeys: z.string().max(5000).optional(),
    userId: z.number().int().optional(),
    ipPoolId: z.number().int().optional(),
    templateId: z.number().int().optional(),
  })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as { node: string; type: 'qemu' | 'lxc'; vmid?: number; hostname?: string; name?: string; cores?: number; sockets?: number; memory?: number; balloon?: number; disk?: number; storage?: string; bridge?: string; vlan?: number | null; ip?: string; gateway?: string; nameserver?: string; searchdomain?: string; iso?: string; ostemplate?: string; sshkeys?: string; userId?: number; ipPoolId?: number; templateId?: number };
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    const hostname = (b.hostname || b.name || '').trim();
    if (hostname && !fqdnRe.test(hostname)) return c.json({ errors: [{ code: 'validation', detail: 'Hostname must be a valid FQDN like vm1.example.com' }] }, 422);

    let pool;
    if (b.ipPoolId) {
      const ipRows = await db.select().from(schema.proxmoxIps).where(eq(schema.proxmoxIps.id, b.ipPoolId)).limit(1);
      pool = ipRows[0];
      if (!pool || pool.clusterId !== id) return c.json({ errors: [{ code: 'validation', detail: 'IP pool not found for this cluster' }] }, 422);
      if (pool.assignmentId) return c.json({ errors: [{ code: 'conflict', detail: 'IP pool is already assigned' }] }, 409);
      if (pool.node !== b.node) return c.json({ errors: [{ code: 'validation', detail: `IP pool node (${pool.node}) must match selected node (${b.node})` }] }, 422);
    }

    let tmpl;
    if (b.templateId) {
      const tmplRows = await db.select().from(schema.proxmoxTemplates).where(eq(schema.proxmoxTemplates.id, b.templateId)).limit(1);
      tmpl = tmplRows[0];
      if (!tmpl) return c.json({ errors: [{ code: 'not_found', detail: 'Template not found' }] }, 404);
      if (tmpl.type !== b.type) return c.json({ errors: [{ code: 'validation', detail: `Template type (${tmpl.type}) must match VM type (${b.type})` }] }, 422);
    }

    const bridge = b.bridge || (pool ? pool.bridge : (tmpl ? (tmpl.storage || 'vmbr0') : 'vmbr0')) || 'vmbr0';
    const ipRaw = (b.ip || (pool ? pool.address : '') || 'dhcp').trim();
    const ip = ipRaw === '' ? 'dhcp' : ipRaw;
    if (ip !== 'dhcp' && !/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(ip)) return c.json({ errors: [{ code: 'validation', detail: 'IP must be dhcp or CIDR like 10.0.0.10/24' }] }, 422);
    const gateway = b.gateway || (pool ? pool.gateway : null);
    const templateVlan = b.vlan !== undefined ? b.vlan : (pool ? pool.vlan : null);
    if (b.type === 'lxc' && !b.ostemplate && !tmpl?.ostemplate) return c.json({ errors: [{ code: 'validation', detail: 'ostemplate required for LXC (e.g. local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst)' }] }, 422);
    const storage = b.storage || (tmpl ? tmpl.storage : undefined) || (b.type === 'qemu' ? 'local-lvm' : 'local-lvm');
    const diskGB = b.disk ?? (tmpl ? (tmpl.defaultDisk || 20) : 20);
    const cores = b.cores ?? (tmpl ? (tmpl.defaultCores || 1) : undefined);
    const sockets = b.type === 'qemu' ? (b.sockets ?? 1) : undefined;
    const memory = b.memory ?? (tmpl ? (tmpl.defaultMemory || 512) : 512);
    const balloon = b.balloon !== undefined ? b.balloon : undefined;

    let vmid = b.vmid;
    if (!vmid) {
      try {
        const existing = await listVms(cluster as never, key);
        const usedVids = new Set(existing.map((v) => v.vmid));
        vmid = 200;
        while (usedVids.has(vmid) && vmid < 9999) vmid++;
      } catch { vmid = 200; }
    }

    const params: Record<string, string | number> = {};
    params.vmid = vmid!;
    if (cores) params.cores = cores;
    if (b.type === 'qemu' && sockets) params.sockets = sockets;
    if (memory) params.memory = memory;
    if (balloon !== undefined) params.balloon = balloon;
    const iso = b.iso || (tmpl ? tmpl.iso : undefined);
    const ostemplate = b.ostemplate || (tmpl ? tmpl.ostemplate : undefined);
    if (b.type === 'qemu') {
      if (hostname) params.name = hostname;
      params['scsi0'] = `${storage}:${diskGB}`;
      let net0 = `virtio,bridge=${bridge}`;
      if (templateVlan) net0 += `,tag=${templateVlan}`;
      params.net0 = net0;
      // QEMU static networking is cloud-init based (net0 ip=/gw= is LXC-only syntax).
      params.ipconfig0 = ip !== 'dhcp' ? `ip=${ip}${gateway ? `,gw=${gateway}` : ''}` : 'ip=dhcp';
      params['ide0'] = `${storage}:cloudinit`;
      if (b.nameserver) params.nameserver = b.nameserver;
      if (b.searchdomain) params.searchdomain = b.searchdomain;
      if (iso) params.ide2 = `${iso},media=cdrom`;
      if (b.sshkeys) params.sshkeys = encodeURIComponent(b.sshkeys);
      params.agent = 'enabled=1';
    } else {
      params.hostname = hostname || b.name || `ct${vmid}`;
      params.cores = cores || 1;
      params.memory = memory || 512;
      params.rootfs = `${storage}:${diskGB}`;
      let net0 = `name=eth0,bridge=${bridge}`;
      net0 += `,ip=${ip}`;
      if (gateway) net0 += `,gw=${gateway}`;
      if (templateVlan) net0 += `,tag=${templateVlan}`;
      params.net0 = net0;
      if (ostemplate) params.ostemplate = ostemplate;
      if (b.nameserver) params.nameserver = b.nameserver;
      if (b.searchdomain) params.searchdomain = b.searchdomain;
      if (b.sshkeys) params['ssh-public-keys'] = encodeURIComponent(b.sshkeys);
      params.unprivileged = 1;
    }
    let createdAssignmentId: number | undefined;
    try {
      const res = b.type === 'qemu' ? await createQemu(cluster as never, key, b.node, params) : await createLxc(cluster as never, key, b.node, params);
      const upid = (res as { data?: string }).data || '';
      const createdVmid = vmid!;
      if (b.userId && createdVmid) {
        const [assign] = await db.insert(schema.proxmoxVmAssignments).values({ clusterId: id, node: b.node, type: b.type, vmid: createdVmid, userId: b.userId }).returning();
        createdAssignmentId = assign?.id;
      }
      if (pool && createdAssignmentId) {
        try { await db.update(schema.proxmoxIps).set({ assignmentId: createdAssignmentId }).where(eq(schema.proxmoxIps.id, b.ipPoolId!)); } catch {}
      }
      const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
      await audit(db, admin.id, 'proxmox.created', 'proxmox_vm', `${id}/${b.node}/${createdVmid}`, auditIp(c), { node: b.node, type: b.type, vmid: createdVmid, hostname });
      // Wait briefly for the create task so failures surface; long installs return the UPID for polling.
      let taskStatus: 'completed' | 'running' | 'failed' = 'completed';
      let taskError: string | null = null;
      if (upid) {
        try { await waitForTask(cluster as never, key, b.node, upid, { timeoutMs: 60000, intervalMs: 2000 }); }
        catch (e) {
          const msg = String((e as Error).message);
          taskStatus = msg.includes('timed out') ? 'running' : 'failed';
          if (taskStatus === 'failed') taskError = msg;
        }
      }
      if (taskStatus === 'failed') return c.json({ errors: [{ code: 'proxmox_error', detail: taskError || 'Proxmox task failed' }] }, 502);
      return c.json({ data: { upid, vmid: createdVmid, assignmentId: createdAssignmentId ?? null, task: taskStatus } }, taskStatus === 'running' ? 202 : 201);
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.get('/vms/:id', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.id, id)).limit(1);
    const a = rows[0];
    if (!a) return c.json({ errors: [{ code: 'not_found', detail: 'VPS not found' }] }, 404);
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number; isAdmin: boolean };
    if (!u.isAdmin && a.userId !== u.id) return c.json({ errors: [{ code: 'forbidden', detail: 'Not your VPS' }] }, 403);
    const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1).then((r) => r[0]);
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const [status, config] = await Promise.all([getVmStatus(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid), getVmConfig(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid).catch(() => ({}))]);
      return c.json({ data: { assignment: a, cluster: { id: cluster.id, name: cluster.name, host: cluster.host }, status, config } });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.get('/vms/raw/:clusterId/:node/:type/:vmid', requireAuth, async (c) => {
    const clusterId = parseInt(c.req.param('clusterId') || '0', 10);
    const node = c.req.param('node') || '';
    const type = (c.req.param('type') || 'qemu') as 'qemu' | 'lxc';
    const vmid = parseInt(c.req.param('vmid') || '0', 10);
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number; isAdmin: boolean };
    const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, clusterId)).limit(1).then((r) => r[0]);
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const [existing] = await db.select().from(schema.proxmoxVmAssignments).where(and(eq(schema.proxmoxVmAssignments.clusterId, clusterId), eq(schema.proxmoxVmAssignments.node, node), eq(schema.proxmoxVmAssignments.type, type), eq(schema.proxmoxVmAssignments.vmid, vmid))).limit(1);
    // Unassigned VMs are infrastructure — only admins may inspect them.
    if (!existing && !u.isAdmin) return c.json({ errors: [{ code: 'forbidden', detail: 'Not your VPS' }] }, 403);
    if (existing && !u.isAdmin && existing.userId !== u.id) return c.json({ errors: [{ code: 'forbidden', detail: 'Not your VPS' }] }, 403);
    const a = existing || { id: 0, clusterId, node, type, vmid, hostname: null, userId: null };
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const [status, config] = await Promise.all([getVmStatus(cluster as never, key, node, type, vmid), getVmConfig(cluster as never, key, node, type, vmid).catch(() => ({}))]);
      return c.json({ data: { assignment: a, cluster: { id: cluster.id, name: cluster.name, host: cluster.host }, status, config } });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.post('/vms/:id/power', requireAuth, zJson(z.object({ action: z.enum(['start', 'stop', 'shutdown', 'reboot', 'suspend', 'resume']) })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as { action: string };
    const rows = await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.id, id)).limit(1);
    const a = rows[0];
    if (!a) return c.json({ errors: [{ code: 'not_found', detail: 'VPS not found' }] }, 404);
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number; isAdmin: boolean };
    if (!u.isAdmin && a.userId !== u.id) return c.json({ errors: [{ code: 'forbidden', detail: 'Not your VPS' }] }, 403);
    const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1).then((r) => r[0]);
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const vmType = a.type as 'qemu' | 'lxc';
    const allowed = vmType === 'qemu' ? QEMU_ACTIONS : LXC_ACTIONS;
    if (!allowed.includes(b.action)) return c.json({ errors: [{ code: 'validation', detail: `Action "${b.action}" is not supported for ${vmType === 'qemu' ? 'QEMU VMs' : 'LXC containers'}` }] }, 400);
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const res = await vmAction(cluster as never, key, a.node, vmType, a.vmid, b.action);
      await audit(db, u.id, `proxmox.power.${b.action}`, 'proxmox_vm', String(id), auditIp(c), { clusterId: a.clusterId, node: a.node, type: a.type, vmid: a.vmid });
      return c.json({ data: res });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.post('/vms/:id/vncproxy', requireAuth, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.id, id)).limit(1);
    const a = rows[0];
    if (!a) return c.json({ errors: [{ code: 'not_found', detail: 'VPS not found' }] }, 404);
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number; isAdmin: boolean };
    if (!u.isAdmin && a.userId !== u.id) return c.json({ errors: [{ code: 'forbidden', detail: 'Not your VPS' }] }, 403);
    const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1).then((r) => r[0]);
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const data = await vncProxy(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid);
      return c.json({ data: { ...data, host: cluster.host } });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.post('/vms/raw/:clusterId/:node/:type/:vmid/power', requireAuth, zJson(z.object({ action: z.enum(['start', 'stop', 'shutdown', 'reboot', 'suspend', 'resume']) })), async (c) => {
    const clusterId = parseInt(c.req.param('clusterId') || '0', 10);
    const node = c.req.param('node') || '';
    const type = (c.req.param('type') || 'qemu') as 'qemu' | 'lxc';
    const vmid = parseInt(c.req.param('vmid') || '0', 10);
    const b = c.req.valid('json' as never) as { action: string };
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number; isAdmin: boolean };
    const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, clusterId)).limit(1).then((r) => r[0]);
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    if (!u.isAdmin) {
      const [existing] = await db.select().from(schema.proxmoxVmAssignments).where(and(eq(schema.proxmoxVmAssignments.clusterId, clusterId), eq(schema.proxmoxVmAssignments.node, node), eq(schema.proxmoxVmAssignments.type, type), eq(schema.proxmoxVmAssignments.vmid, vmid))).limit(1);
      if (!existing || existing.userId !== u.id) return c.json({ errors: [{ code: 'forbidden', detail: 'Not your VPS' }] }, 403);
    }
    const allowed = type === 'qemu' ? QEMU_ACTIONS : LXC_ACTIONS;
    if (!allowed.includes(b.action)) return c.json({ errors: [{ code: 'validation', detail: `Action "${b.action}" is not supported for ${type === 'qemu' ? 'QEMU VMs' : 'LXC containers'}` }] }, 400);
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const res = await vmAction(cluster as never, key, node, type, vmid, b.action);
      await audit(db, u.id, `proxmox.power.${b.action}`, 'proxmox_vm', `${clusterId}/${node}/${vmid}`, auditIp(c), { clusterId, node, type, vmid });
      return c.json({ data: res });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.post('/vms/raw/:clusterId/:node/:type/:vmid/vncproxy', requireAuth, async (c) => {
    const clusterId = parseInt(c.req.param('clusterId') || '0', 10);
    const node = c.req.param('node') || '';
    const type = (c.req.param('type') || 'qemu') as 'qemu' | 'lxc';
    const vmid = parseInt(c.req.param('vmid') || '0', 10);
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number; isAdmin: boolean };
    const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, clusterId)).limit(1).then((r) => r[0]);
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    if (!u.isAdmin) {
      const [existing] = await db.select().from(schema.proxmoxVmAssignments).where(and(eq(schema.proxmoxVmAssignments.clusterId, clusterId), eq(schema.proxmoxVmAssignments.node, node), eq(schema.proxmoxVmAssignments.type, type), eq(schema.proxmoxVmAssignments.vmid, vmid))).limit(1);
      if (!existing || existing.userId !== u.id) return c.json({ errors: [{ code: 'forbidden', detail: 'Not your VPS' }] }, 403);
    }
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const data = await vncProxy(cluster as never, key, node, type, vmid);
      return c.json({ data: { ...data, host: cluster.host } });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.delete('/vms/raw/:clusterId/:node/:type/:vmid', requireAdmin, async (c) => {
    const clusterId = parseInt(c.req.param('clusterId') || '0', 10);
    const node = c.req.param('node') || '';
    const type = (c.req.param('type') || 'qemu') as 'qemu' | 'lxc';
    const vmid = parseInt(c.req.param('vmid') || '0', 10);
    const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, clusterId)).limit(1).then((r) => r[0]);
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    try {
      await deleteVm(cluster as never, key, node, type, vmid);
      await db.delete(schema.proxmoxVmAssignments).where(and(eq(schema.proxmoxVmAssignments.clusterId, clusterId), eq(schema.proxmoxVmAssignments.node, node), eq(schema.proxmoxVmAssignments.type, type), eq(schema.proxmoxVmAssignments.vmid, vmid)));
      const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
      await audit(db, admin.id, 'proxmox.vm.deleted', 'proxmox_vm', `${clusterId}/${node}/${vmid}`, auditIp(c), { clusterId, node, type, vmid });
      return c.json({ data: { ok: true } });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.delete('/vms/:id', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.id, id)).limit(1);
    const a = rows[0];
    if (!a) return c.json({ errors: [{ code: 'not_found', detail: 'VPS not found' }] }, 404);
    const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1).then((r) => r[0]);
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    try {
      await deleteVm(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid);
      await db.delete(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.id, id));
      const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
      await audit(db, admin.id, 'proxmox.vm.deleted', 'proxmox_vm', String(id), auditIp(c), { clusterId: a.clusterId, node: a.node, type: a.type, vmid: a.vmid });
      return c.json({ data: { ok: true } });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.patch('/vms/:id', requireAdmin, zJson(z.object({ hostname: z.string().min(1).max(191).optional(), userId: z.number().int().nullable().optional() })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as { hostname?: string; userId?: number | null };
    const rows = await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.id, id)).limit(1);
    const a = rows[0];
    if (!a) return c.json({ errors: [{ code: 'not_found', detail: 'VPS not found' }] }, 404);
    if (b.hostname) {
      const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1).then((r) => r[0]);
      if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
      const key = process.env.ENCRYPTION_KEY!;
      try { await renameVm(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, b.hostname); } catch (e) { return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502); }
    }
    const update: Record<string, unknown> = {};
    if (b.hostname) update.hostname = b.hostname;
    if (b.userId !== undefined) update.userId = b.userId;
    if (Object.keys(update).length > 0) await db.update(schema.proxmoxVmAssignments).set(update).where(eq(schema.proxmoxVmAssignments.id, id));
    return c.json({ data: { ok: true } });
  });
  app.post('/clusters/:id/nodes/:node/:type/:vmid/:action', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const node = c.req.param('node') || '';
    const type = (c.req.param('type') || 'qemu') as 'qemu' | 'lxc';
    const vmid = parseInt(c.req.param('vmid') || '0', 10);
    const action = c.req.param('action') || '';
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster || !['qemu', 'lxc'].includes(type)) return c.json({ errors: [{ code: 'not_found', detail: 'Not found' }] }, 404);
    const allowed = type === 'qemu' ? QEMU_ACTIONS : LXC_ACTIONS;
    if (!allowed.includes(action)) return c.json({ errors: [{ code: 'validation', detail: `Unsupported action "${action}"` }] }, 400);
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const res = await vmAction(cluster as never, key, node, type, vmid, action);
      await audit(db, admin.id, `proxmox.${action}`, 'proxmox_vm', `${id}/${node}/${vmid}`, auditIp(c), { clusterId: id, node, type, vmid, action });
      return c.json({ data: res });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });

  // ── VPS suspension (expiry enforcement) ──

  async function loadOwnedVm(cx: any) {
    const id = parseInt(cx.req.param('id') || '0', 10);
    const u = (cx as unknown as { get: (k: string) => unknown }).get('user') as { id: number; isAdmin: boolean };
    const a = (await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.id, id)).limit(1))[0];
    if (!a) return { res: cx.json({ errors: [{ code: 'not_found', detail: 'VPS not found' }] }, 404) };
    if (!u.isAdmin && a.userId !== u.id) return { res: cx.json({ errors: [{ code: 'forbidden', detail: 'Not your VPS' }] }, 403) };
    return { a, u };
  }

  app.post('/vms/:id/suspend', requireAdmin, async (c) => {
    const loaded = await loadOwnedVm(c);
    if ('res' in loaded) return loaded.res;
    const { a } = loaded;
    const [row] = await db.update(schema.proxmoxVmAssignments).set({ suspendedAt: new Date(), suspendedReason: 'manual' }).where(eq(schema.proxmoxVmAssignments.id, a.id)).returning();
    const key = process.env.ENCRYPTION_KEY!;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (cluster) {
      try { await vmAction(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, a.type === 'qemu' ? 'suspend' : 'stop'); }
      catch (e) { return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502); }
    }
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.vps.suspended', 'proxmox_vm', String(a.id), auditIp(c), { vmid: a.vmid });
    return c.json({ data: row });
  });
  app.post('/vms/:id/resume', requireAdmin, async (c) => {
    const loaded = await loadOwnedVm(c);
    if ('res' in loaded) return loaded.res;
    const { a } = loaded;
    const [row] = await db.update(schema.proxmoxVmAssignments).set({ suspendedAt: null, suspendedReason: null }).where(eq(schema.proxmoxVmAssignments.id, a.id)).returning();
    const key = process.env.ENCRYPTION_KEY!;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (cluster) {
      try { await vmAction(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, a.type === 'qemu' ? 'resume' : 'start'); }
      catch (e) { return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502); }
    }
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.vps.resumed', 'proxmox_vm', String(a.id), auditIp(c), { vmid: a.vmid });
    return c.json({ data: row });
  });

  // ── Snapshots ──

  app.get('/vms/:id/snapshots', requireAuth, async (c) => {
    const loaded = await loadOwnedVm(c);
    if ('res' in loaded) return loaded.res;
    const { a } = loaded;
    const key = process.env.ENCRYPTION_KEY!;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    try {
      const snaps = await listSnapshots(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid);
      return c.json({ data: snaps });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.post('/vms/:id/snapshots', requireAuth, zJson(z.object({ name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_]+$/), description: z.string().max(500).optional(), includeRam: z.boolean().optional() })), async (c) => {
    const loaded = await loadOwnedVm(c);
    if ('res' in loaded) return loaded.res;
    const { a, u } = loaded;
    const b = c.req.valid('json' as never) as { name: string; description?: string; includeRam?: boolean };
    const key = process.env.ENCRYPTION_KEY!;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    try {
      const res = await createSnapshot(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, b);
      const upid = (res as { data?: string }).data || '';
      let task: 'completed' | 'running' | 'failed' = 'completed';
      if (upid) {
        try { await waitForTask(cluster as never, key, a.node, upid, { timeoutMs: 120000 }); }
        catch (e) { task = String((e as Error).message).includes('timed out') ? 'running' : 'failed'; }
      }
      await audit(db, u.id, 'proxmox.snapshot.created', 'proxmox_vm', String(a.id), auditIp(c), { vmid: a.vmid, snap: b.name });
      return c.json({ data: { upid, task } }, task === 'failed' ? 502 : 202);
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.post('/vms/:id/snapshots/:snap/rollback', requireAuth, async (c) => {
    const loaded = await loadOwnedVm(c);
    if ('res' in loaded) return loaded.res;
    const { a, u } = loaded;
    const snap = c.req.param('snap') || '';
    const key = process.env.ENCRYPTION_KEY!;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    try {
      const res = await rollbackSnapshot(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, snap);
      const upid = (res as { data?: string }).data || '';
      let task: 'completed' | 'running' | 'failed' = 'completed';
      if (upid) {
        try { await waitForTask(cluster as never, key, a.node, upid, { timeoutMs: 180000 }); }
        catch (e) { task = String((e as Error).message).includes('timed out') ? 'running' : 'failed'; }
      }
      await audit(db, u.id, 'proxmox.snapshot.rolledback', 'proxmox_vm', String(a.id), auditIp(c), { vmid: a.vmid, snap });
      return c.json({ data: { upid, task } }, task === 'failed' ? 502 : 202);
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.delete('/vms/:id/snapshots/:snap', requireAuth, async (c) => {
    const loaded = await loadOwnedVm(c);
    if ('res' in loaded) return loaded.res;
    const { a, u } = loaded;
    const snap = c.req.param('snap') || '';
    const key = process.env.ENCRYPTION_KEY!;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    try {
      const res = await deleteSnapshot(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, snap);
      const upid = (res as { data?: string }).data || '';
      let task: 'completed' | 'running' | 'failed' = 'completed';
      if (upid) {
        try { await waitForTask(cluster as never, key, a.node, upid, { timeoutMs: 60000 }); }
        catch (e) { task = String((e as Error).message).includes('timed out') ? 'running' : 'failed'; }
      }
      await audit(db, u.id, 'proxmox.snapshot.deleted', 'proxmox_vm', String(a.id), auditIp(c), { vmid: a.vmid, snap });
      return c.json({ data: { upid, task } }, task === 'failed' ? 502 : 202);
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });

  // ── Backups (vzdump) ──

  app.get('/vms/:id/backups', requireAuth, async (c) => {
    const loaded = await loadOwnedVm(c);
    if ('res' in loaded) return loaded.res;
    const { a } = loaded;
    const key = process.env.ENCRYPTION_KEY!;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const storage = (c.req.query('storage') as string) || 'local';
    try {
      const items = await listBackups(cluster as never, key, a.node, storage, a.vmid);
      return c.json({ data: items });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.post('/vms/:id/backups', requireAuth, zJson(z.object({ storage: z.string().min(1).max(191).default('local'), mode: z.enum(['snapshot', 'suspend', 'stop']).default('snapshot'), notes: z.string().max(500).optional() })), async (c) => {
    const loaded = await loadOwnedVm(c);
    if ('res' in loaded) return loaded.res;
    const { a, u } = loaded;
    const b = c.req.valid('json' as never) as { storage: string; mode: 'snapshot' | 'suspend' | 'stop'; notes?: string };
    const key = process.env.ENCRYPTION_KEY!;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    try {
      const res = await createBackup(cluster as never, key, a.node, { vmid: a.vmid, storage: b.storage, mode: b.mode, notes: b.notes || `LunixPanel backup of VM ${a.vmid}` });
      const upid = (res as { data?: string }).data || '';
      await audit(db, u.id, 'proxmox.backup.created', 'proxmox_vm', String(a.id), auditIp(c), { vmid: a.vmid, storage: b.storage });
      return c.json({ data: { upid } }, 202);
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.post('/vms/:id/backups/restore', requireAdmin, zJson(z.object({ archive: z.string().min(1).max(512), storage: z.string().min(1).max(191).optional() })), async (c) => {
    const loaded = await loadOwnedVm(c);
    if ('res' in loaded) return loaded.res;
    const { a } = loaded;
    const b = c.req.valid('json' as never) as { archive: string; storage?: string };
    const key = process.env.ENCRYPTION_KEY!;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    try {
      // Stop first — vzdump restore requires the target to be stopped.
      try {
        const stopRes = await vmAction(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, 'stop');
        const stopUpid = (stopRes as { data?: string }).data;
        if (stopUpid) await waitForTask(cluster as never, key, a.node, stopUpid, { timeoutMs: 120000 });
      } catch { /* already stopped */ }
      const res = a.type === 'qemu'
        ? await restoreQemu(cluster as never, key, a.node, { vmid: a.vmid, archive: b.archive, storage: b.storage || 'local-lvm' })
        : await restoreLxc(cluster as never, key, a.node, { vmid: a.vmid, archive: b.archive, storage: b.storage || 'local-lvm' });
      const upid = (res as { data?: string }).data || '';
      let task: 'completed' | 'running' | 'failed' = 'completed';
      if (upid) {
        try { await waitForTask(cluster as never, key, a.node, upid, { timeoutMs: 300000 }); }
        catch (e) { task = String((e as Error).message).includes('timed out') ? 'running' : 'failed'; }
      }
      await audit(db, a.userId, 'proxmox.backup.restored', 'proxmox_vm', String(a.id), auditIp(c), { vmid: a.vmid, archive: b.archive });
      return c.json({ data: { upid, task } }, task === 'failed' ? 502 : 202);
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });

  // ── Rebuild (admin): destroy + recreate from template with same vmid/specs/IP ──

  app.post('/vms/:id/rebuild', requireAdmin, zJson(z.object({ templateId: z.number().int().optional(), preserveDisk: z.boolean().optional() })), async (c) => {
    const loaded = await loadOwnedVm(c);
    if ('res' in loaded) return loaded.res;
    const { a } = loaded;
    const b = c.req.valid('json' as never) as { templateId?: number; preserveDisk?: boolean };
    const key = process.env.ENCRYPTION_KEY!;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const tmpl = b.templateId
      ? (await db.select().from(schema.proxmoxTemplates).where(eq(schema.proxmoxTemplates.id, b.templateId)).limit(1))[0]
      : undefined;
    if (b.templateId && !tmpl) return c.json({ errors: [{ code: 'not_found', detail: 'Template not found' }] }, 404);
    if (tmpl && tmpl.type !== a.type) return c.json({ errors: [{ code: 'validation', detail: `Template type (${tmpl.type}) must match VM type (${a.type})` }] }, 422);
    try {
      // Capture current config so specs and network survive the rebuild.
      const cfg = await getVmConfig(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid);
      const cores = Number(cfg.cores) || tmpl?.defaultCores || 1;
      const memory = Number(cfg.memory) || tmpl?.defaultMemory || 512;
      const net0 = String(cfg.net0 || '');
      const bridgeMatch = net0.match(/bridge=([^,]+)/);
      const tagMatch = net0.match(/tag=([^,]+)/);
      const ipconfig0 = String(cfg.ipconfig0 || '');
      const ipMatch = ipconfig0.match(/ip=([^,]+)/);
      const gwMatch = ipconfig0.match(/gw=([^,]+)/);
      const hostname = String(cfg.name || cfg.hostname || `vm${a.vmid}`);
      const storage = tmpl?.storage || 'local-lvm';
      const diskGB = tmpl?.defaultDisk || 20;

      // Stop then destroy.
      try {
        const st = await vmAction(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, 'stop');
        const stopUpid = (st as { data?: string }).data;
        if (stopUpid) await waitForTask(cluster as never, key, a.node, stopUpid, { timeoutMs: 120000 });
      } catch { /* already stopped */ }
      const delRes = await deleteVm(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, { destroyUnreferenced: true });
      const delUpid = (delRes as { data?: string }).data;
      if (delUpid) await waitForTask(cluster as never, key, a.node, delUpid, { timeoutMs: 180000 });

      // Recreate with same vmid.
      const params: Record<string, string | number> = { vmid: a.vmid, cores, memory };
      if (a.type === 'qemu') {
        params.name = hostname;
        params['scsi0'] = `${storage}:${diskGB}`;
        params.net0 = `virtio,bridge=${bridgeMatch?.[1] || 'vmbr0'}${tagMatch ? `,tag=${tagMatch[1]}` : ''}`;
        params.ipconfig0 = ipMatch ? `ip=${ipMatch[1]}${gwMatch ? `,gw=${gwMatch[1]}` : ''}` : 'ip=dhcp';
        params['ide0'] = `${storage}:cloudinit`;
        params.agent = 'enabled=1';
        if (tmpl?.iso) params.ide2 = `${tmpl.iso},media=cdrom`;
      } else {
        params.hostname = hostname;
        params.rootfs = `${storage}:${diskGB}`;
        params.net0 = `name=eth0,bridge=${bridgeMatch?.[1] || 'vmbr0'}${tagMatch ? `,tag=${tagMatch[1]}` : ''}${ipMatch && ipMatch[1] !== 'dhcp' ? `,ip=${ipMatch[1]}${gwMatch ? `,gw=${gwMatch[1]}` : ''}` : ',ip=dhcp'}`;
        params.unprivileged = 1;
        if (tmpl?.ostemplate) params.ostemplate = tmpl.ostemplate;
      }
      const createRes = a.type === 'qemu'
        ? await createQemu(cluster as never, key, a.node, params)
        : await createLxc(cluster as never, key, a.node, params);
      const createUpid = (createRes as { data?: string }).data || '';
      let task: 'completed' | 'running' | 'failed' = 'completed';
      if (createUpid) {
        try { await waitForTask(cluster as never, key, a.node, createUpid, { timeoutMs: 300000 }); }
        catch (e) { task = String((e as Error).message).includes('timed out') ? 'running' : 'failed'; }
      }
      const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
      await audit(db, admin.id, 'proxmox.vm.rebuilt', 'proxmox_vm', String(a.id), auditIp(c), { vmid: a.vmid, templateId: b.templateId ?? null });
      return c.json({ data: { upid: createUpid, task } }, task === 'failed' ? 502 : 202);
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });

  // ── Resource stats (rrddata graphs) + task status ──

  app.get('/vms/:id/stats', requireAuth, async (c) => {
    const loaded = await loadOwnedVm(c);
    if ('res' in loaded) return loaded.res;
    const { a } = loaded;
    const timeframeParam = (c.req.query('timeframe') as string) || 'hour';
    const timeframe = (['hour', 'day', 'week', 'month', 'year'].includes(timeframeParam) ? timeframeParam : 'hour') as 'hour' | 'day' | 'week' | 'month' | 'year';
    const key = process.env.ENCRYPTION_KEY!;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    try {
      const rrd = await getVmRrdData(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, timeframe);
      return c.json({ data: rrd });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  app.get('/tasks/:node/:upid', requireAdmin, async (c) => {
    const node = c.req.param('node') || '';
    const upid = c.req.param('upid') || '';
    const key = process.env.ENCRYPTION_KEY!;
    const clusterRows = await db.select().from(schema.proxmoxClusters);
    for (const cluster of clusterRows) {
      try {
        const st = await getTaskStatus(cluster as never, key, node, upid);
        return c.json({ data: st });
      } catch { /* try next cluster */ }
    }
    return c.json({ errors: [{ code: 'not_found', detail: 'Task not found on any cluster' }] }, 404);
  });
  return app;
}
