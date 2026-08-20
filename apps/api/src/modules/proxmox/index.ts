import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { encrypt } from '../../lib/crypto.js';
import { listNodes, listVms, vmAction, getVmStatus, getVmConfig, vncProxy, createQemu, createLxc, listStorages, listStorageContent } from '../../lib/proxmox-client.js';
import { audit, auditIp } from '../../lib/audit.js';

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
      const r = await fetch(`${cluster.host.replace(/\/$/, '')}/api2/json/version`, { headers: { Authorization: `PVEAPIToken=${cluster.apiTokenId}=${(await import('../../lib/crypto.js')).decrypt(cluster.apiTokenSecretEncrypted, key)}` } } as RequestInit);
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
  app.post('/assignments', requireAdmin, zJson(z.object({ clusterId: z.number().int(), node: z.string().min(1), type: z.enum(['qemu', 'lxc']), vmid: z.number().int(), userId: z.number().int() })), async (c) => {
    const b = c.req.valid('json' as never) as { clusterId: number; node: string; type: 'qemu' | 'lxc'; vmid: number; userId: number };
    const cluster = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, b.clusterId)).limit(1).then((r) => r[0]);
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const user = await db.select().from(schema.users).where(eq(schema.users.id, b.userId)).limit(1).then((r) => r[0]);
    if (!user) return c.json({ errors: [{ code: 'not_found', detail: 'User not found' }] }, 404);
    const existing = await db.select().from(schema.proxmoxVmAssignments).where(and(eq(schema.proxmoxVmAssignments.clusterId, b.clusterId), eq(schema.proxmoxVmAssignments.node, b.node), eq(schema.proxmoxVmAssignments.type, b.type), eq(schema.proxmoxVmAssignments.vmid, b.vmid))).limit(1);
    if (existing[0]) return c.json({ errors: [{ code: 'conflict', detail: 'VM already assigned' }] }, 409);
    const [row] = await db.insert(schema.proxmoxVmAssignments).values({ clusterId: b.clusterId, node: b.node, type: b.type, vmid: b.vmid, userId: b.userId }).returning();
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    await audit(db, admin.id, 'proxmox.assigned', 'proxmox_vm', String(row.id), auditIp(c), { clusterId: b.clusterId, node: b.node, type: b.type, vmid: b.vmid, userId: b.userId });
    return c.json({ data: row }, 201);
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
  })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as { node: string; type: 'qemu' | 'lxc'; vmid?: number; hostname?: string; name?: string; cores?: number; sockets?: number; memory?: number; balloon?: number; disk?: number; storage?: string; bridge?: string; vlan?: number | null; ip?: string; gateway?: string; nameserver?: string; searchdomain?: string; iso?: string; ostemplate?: string; sshkeys?: string; userId?: number };
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster) return c.json({ errors: [{ code: 'not_found', detail: 'Cluster not found' }] }, 404);
    const key = process.env.ENCRYPTION_KEY!;
    const bridge = b.bridge || 'vmbr0';
    const ipRaw = (b.ip || 'dhcp').trim();
    const ip = ipRaw === '' ? 'dhcp' : ipRaw;
    const hostname = (b.hostname || b.name || '').trim();
    if (hostname && !fqdnRe.test(hostname)) return c.json({ errors: [{ code: 'validation', detail: 'Hostname must be a valid FQDN like vm1.example.com' }] }, 422);
    if (ip !== 'dhcp' && !/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(ip)) return c.json({ errors: [{ code: 'validation', detail: 'IP must be dhcp or CIDR like 10.0.0.10/24' }] }, 422);
    if (b.type === 'lxc' && !b.ostemplate) return c.json({ errors: [{ code: 'validation', detail: 'ostemplate required for LXC (e.g. local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst)' }] }, 422);
    const storage = b.storage || (b.type === 'qemu' ? 'local-lvm' : 'local-lvm');
    const diskGB = b.disk ?? 20;
    const params: Record<string, string | number> = {};
    if (b.vmid) params.vmid = b.vmid;
    if (hostname) params.name = hostname;
    else if (b.name) params.name = b.name;
    if (b.cores) params.cores = b.cores;
    if (b.sockets) params.sockets = b.sockets;
    if (b.memory) params.memory = b.memory;
    if (b.balloon !== undefined) params.balloon = b.balloon;
    if (hostname) params.hostname = hostname;
    if (b.type === 'qemu') {
      params['scsi0'] = `${storage}:${diskGB}`;
      let net0 = `virtio,bridge=${bridge}`;
      if (ip && ip !== 'dhcp') net0 += `,ip=${ip}`;
      else if (ip === 'dhcp') net0 += `,ip=dhcp`;
      if (b.gateway) net0 += `,gw=${b.gateway}`;
      if (b.vlan) net0 += `,tag=${b.vlan}`;
      params.net0 = net0;
      if (b.nameserver) params.nameserver = b.nameserver;
      if (b.searchdomain) params.searchdomain = b.searchdomain;
      if (b.iso) params.ide2 = `${b.iso},media=cdrom`;
      if (b.sshkeys) params.sshkeys = encodeURIComponent(b.sshkeys);
      params.agent = 'enabled=1';
    } else {
      params.hostname = hostname || b.name || `ct${b.vmid || ''}`;
      params.cores = b.cores || 1;
      params.memory = b.memory || 512;
      params.rootfs = `${storage}:${diskGB}`;
      let net0 = `name=eth0,bridge=${bridge}`;
      net0 += `,ip=${ip}`;
      if (b.gateway) net0 += `,gw=${b.gateway}`;
      if (b.vlan) net0 += `,tag=${b.vlan}`;
      params.net0 = net0;
      if (b.ostemplate) params.ostemplate = b.ostemplate;
      if (b.nameserver) params.nameserver = b.nameserver;
      if (b.searchdomain) params.searchdomain = b.searchdomain;
      if (b.sshkeys) params['ssh-public-keys'] = encodeURIComponent(b.sshkeys);
      params.unprivileged = 1;
    }
    try {
      const res = b.type === 'qemu' ? await createQemu(cluster as never, key, b.node, params) : await createLxc(cluster as never, key, b.node, params);
      const vmid = b.vmid || parseInt(String((res as { data?: string }).data || '').replace(/\D/g, '') || '0', 10) || 0;
      if (b.userId && vmid) {
        try { await db.insert(schema.proxmoxVmAssignments).values({ clusterId: id, node: b.node, type: b.type, vmid, userId: b.userId }); } catch {}
      }
      const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
      await audit(db, admin.id, 'proxmox.created', 'proxmox_vm', `${id}/${b.node}/${vmid}`, auditIp(c), { node: b.node, type: b.type, vmid, hostname });
      return c.json({ data: res }, 201);
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
    const key = process.env.ENCRYPTION_KEY!;
    try {
      const res = await vmAction(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, b.action);
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
  app.post('/clusters/:id/nodes/:node/:type/:vmid/:action', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const node = c.req.param('node') || '';
    const type = (c.req.param('type') || 'qemu') as 'qemu' | 'lxc';
    const vmid = parseInt(c.req.param('vmid') || '0', 10);
    const action = c.req.param('action') || '';
    const rows = await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, id)).limit(1);
    const cluster = rows[0];
    if (!cluster || !['qemu', 'lxc'].includes(type)) return c.json({ errors: [{ code: 'not_found', detail: 'Not found' }] }, 404);
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
  return app;
}
