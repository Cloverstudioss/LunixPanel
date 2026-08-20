import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.js';
import { requireAuth } from '../../middleware/auth.js';
import { encrypt } from '../../lib/crypto.js';
import { listNodes, listVms, vmAction } from '../../lib/proxmox-client.js';

function zJson<T extends z.ZodTypeAny>(s: T) {
  return validator('json', (value, c) => {
    const r = s.safeParse(value);
    if (!r.success) return c.json({ errors: [{ code: 'validation', detail: r.error.message }] }, 422);
    return r.data as z.infer<T>;
  });
}

export default function proxmoxRoutes(db: Db) {
  const app = new Hono();
  app.get('/vms', requireAuth, async (c) => {
    const key = process.env.ENCRYPTION_KEY;
    if (!key || key.length < 64) return c.json({ data: [] });
    const clusters = await db.select().from(schema.proxmoxClusters);
    const all: { clusterId: number; clusterName: string; node: string; type: string; vmid: number; name: string; status: string; maxmem: number; maxdisk: number; cpus: number }[] = [];
    for (const cl of clusters) {
      try {
        const vms = await listVms(cl as never, key);
        for (const v of vms) all.push({ clusterId: cl.id, clusterName: cl.name, ...v });
      } catch { /* skip unreachable cluster */ }
    }
    return c.json({ data: all });
  });
  app.get('/clusters', requireAdmin, async (c) => {
    const rows = await db.select().from(schema.proxmoxClusters);
    return c.json({ data: rows.map((r) => ({ ...r, apiTokenSecretEncrypted: undefined })) });
  });
  app.post('/clusters', requireAdmin, zJson(z.object({ name: z.string().min(1), host: z.string().url(), api_token_id: z.string().min(1), api_token_secret: z.string().min(1), verify_tls: z.boolean().optional() })), async (c) => {
    const body = c.req.valid('json' as never) as { name: string; host: string; api_token_id: string; api_token_secret: string; verify_tls?: boolean };
    const admin = (c as unknown as { get: (k: string) => unknown }).get('user') as { id: number };
    const key = process.env.ENCRYPTION_KEY;
    if (!key || key.length < 64) return c.json({ errors: [{ code: 'config', detail: 'ENCRYPTION_KEY not set (64 hex chars)' }] }, 500);
    const enc = encrypt(body.api_token_secret, key);
    const [row] = await db.insert(schema.proxmoxClusters).values({ name: body.name, host: body.host, apiTokenId: body.api_token_id, apiTokenSecretEncrypted: enc, verifyTls: body.verify_tls ?? false, createdBy: admin.id }).returning();
    const test = await fetch(`${body.host.replace(/\/$/, '')}/api2/json/version`, { headers: { Authorization: `PVEAPIToken=${body.api_token_id}=${body.api_token_secret}` } } as RequestInit).then((r) => r.ok).catch(() => false);
    return c.json({ data: { ...row, apiTokenSecretEncrypted: undefined, connection_ok: test } }, 201);
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
      await db.insert(schema.auditLogs).values({ userId: admin.id, action: `proxmox.${action}`, targetType: 'proxmox_vm', targetId: `${id}/${node}/${vmid}`, ip: c.req.header('x-forwarded-for') || '', meta: { clusterId: id, node, type, vmid, action } });
      return c.json({ data: res });
    } catch (e) {
      return c.json({ errors: [{ code: 'proxmox_error', detail: String(e) }] }, 502);
    }
  });
  return app;
}
