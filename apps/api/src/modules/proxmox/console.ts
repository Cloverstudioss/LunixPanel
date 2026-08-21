import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { vncProxy } from '../../lib/proxmox-client.js';
import { audit, auditIp } from '../../lib/audit.js';

const { upgradeWebSocket } = createBunWebSocket();

type AuthedUser = { id: number; isAdmin: boolean };

async function userFromCookie(db: Db, cookieHeader: string | undefined): Promise<AuthedUser | null> {
  if (!cookieHeader) return null;
  const sid = /(?:^|;\s*)lunix_sid=([a-f0-9]{32})(?:;|$)/.exec(cookieHeader)?.[1];
  if (!sid) return null;
  const s = (await db.select().from(schema.sessions).where(eq(schema.sessions.id, sid)).limit(1))[0];
  if (!s || new Date(s.expiresAt) < new Date()) return null;
  const u = (await db.select().from(schema.users).where(eq(schema.users.id, s.userId)).limit(1))[0];
  if (!u) return null;
  return { id: u.id, isAdmin: u.isAdmin };
}

// Resolve the (cluster, node, type, vmid) + ownership for either an assignment id or a raw ref.
async function resolveVm(db: Db, cx: any) {
  const id = cx.req.param('id');
  if (id) {
    const a = (await db.select().from(schema.proxmoxVmAssignments).where(eq(schema.proxmoxVmAssignments.id, parseInt(id, 10))).limit(1))[0];
    if (!a) return null;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (!cluster) return null;
    return { cluster, node: a.node, type: a.type as 'qemu' | 'lxc', vmid: a.vmid, ownerId: a.userId as number };
  }
  const clusterId = parseInt(cx.req.param('clusterId') || '0', 10);
  const node = cx.req.param('node') || '';
  const type = (cx.req.param('type') || 'qemu') as 'qemu' | 'lxc';
  const vmid = parseInt(cx.req.param('vmid') || '0', 10);
  const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, clusterId)).limit(1))[0];
  if (!cluster) return null;
  const a = (await db.select().from(schema.proxmoxVmAssignments).where(and(
    eq(schema.proxmoxVmAssignments.clusterId, clusterId),
    eq(schema.proxmoxVmAssignments.node, node),
    eq(schema.proxmoxVmAssignments.type, type),
    eq(schema.proxmoxVmAssignments.vmid, vmid),
  )).limit(1))[0];
  return { cluster, node, type, vmid, ownerId: a?.userId ?? null };
}

export default function proxmoxConsoleRoutes(db: Db) {
  const app = new Hono<{ Variables: { user: unknown } }>();

  const consoleWs = () => upgradeWebSocket((c) => {
    let upstream: WebSocket | null = null;
    let closedByUs = false;
    const closeAll = () => {
      if (closedByUs) return;
      closedByUs = true;
      try { upstream?.close(); } catch { /* ignore */ }
    };
    return {
      async onOpen(_evt, ws) {
        try {
          const u = await userFromCookie(db, c.req.header('Cookie'));
          if (!u) { ws.close(4001, 'Unauthorized'); return; }
          const vm = await resolveVm(db, c);
          if (!vm) { ws.close(4004, 'VM not found'); return; }
          if (!u.isAdmin && vm.ownerId !== u.id) { ws.close(4003, 'Not your VPS'); return; }
          const key = process.env.ENCRYPTION_KEY;
          if (!key || key.length < 64) { ws.close(4500, 'ENCRYPTION_KEY not configured'); return; }

          const proxy = await vncProxy(vm.cluster as never, key, vm.node, vm.type, vm.vmid, { websocket: true });
          const base = vm.cluster.host.replace(/\/$/, '').replace(/^http/, 'ws');
          const url = `${base}/api2/json/nodes/${encodeURIComponent(vm.node)}/${vm.type}/${vm.vmid}/vncwebsocket?port=${proxy.port}&vncticket=${encodeURIComponent(proxy.ticket)}`;
          const wsOptions: Record<string, unknown> = {
            headers: { Authorization: `PVEAPIToken=${vm.cluster.apiTokenId}=${(await import('../../lib/crypto.js')).decrypt(vm.cluster.apiTokenSecretEncrypted, key)}` },
            protocols: ['binary'],
          };
          if (!vm.cluster.verifyTls) wsOptions.tls = { rejectUnauthorized: false };
          upstream = new WebSocket(url, wsOptions as never);
          upstream.binaryType = 'arraybuffer';
          upstream.onmessage = (ev) => {
            if (closedByUs) return;
            try { ws.send(ev.data as ArrayBuffer); } catch { closeAll(); }
          };
          upstream.onclose = () => { if (!closedByUs) { closedByUs = true; try { ws.close(1000, 'PVE closed'); } catch { /* ignore */ } } };
          upstream.onerror = () => { if (!closedByUs) { closedByUs = true; try { ws.close(4502, 'PVE connection failed'); } catch { /* ignore */ } } };
          await audit(db, u.id, 'proxmox.console.opened', 'proxmox_vm', String(vm.vmid), auditIp(c as never), { node: vm.node, type: vm.type, vmid: vm.vmid });
        } catch (e) {
          console.error('[pve-console]', e);
          try { ws.close(4500, `Console error: ${String((e as Error).message).slice(0, 120)}`); } catch { /* ignore */ }
        }
      },
      onMessage(evt, ws) {
        if (closedByUs || !upstream || upstream.readyState !== WebSocket.OPEN) return;
        try { upstream.send(evt.data as ArrayBuffer); } catch { closeAll(); }
      },
      onClose() { closeAll(); },
      onError() { closeAll(); },
    };
  });

  app.get('/vms/:id/console/ws', consoleWs());
  app.get('/vms/raw/:clusterId/:node/:type/:vmid/console/ws', consoleWs());
  return app;
}
