import { lt, eq, and, isNull } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { vmAction } from '../lib/proxmox-client.js';

export async function runExpiryCheck(db: Db, graceDays = 3) {
  const now = new Date();
  const graceUntil = new Date(now.getTime() + graceDays * 24 * 3600 * 1000);

  // Servers that just expired -> enter grace period.
  const expired = await db.select().from(schema.servers).where(and(eq(schema.servers.status, 'active'), lt(schema.servers.expiresAt, now), isNull(schema.servers.graceUntil)));
  for (const s of expired) {
    await db.update(schema.servers).set({ graceUntil }).where(eq(schema.servers.id, s.id));
    await db.insert(schema.auditLogs).values({ userId: s.userId, action: 'server.grace', targetType: 'server', targetId: String(s.id), meta: { graceUntil: graceUntil.toISOString() } });
  }

  // Servers whose grace period has lapsed -> suspend (and actually stop the container).
  const graceOver = await db.select().from(schema.servers).where(and(eq(schema.servers.status, 'active'), lt(schema.servers.graceUntil, now)));
  for (const s of graceOver) {
    await db.update(schema.servers).set({ status: 'suspended', suspendedAt: now, suspendedReason: 'expired_grace_over' }).where(eq(schema.servers.id, s.id));
    await db.insert(schema.auditLogs).values({ userId: s.userId, action: 'server.suspended', targetType: 'server', targetId: String(s.id), meta: { reason: 'expired_grace_over' } });
    try {
      const node = (await db.select().from(schema.nodes).where(eq(schema.nodes.id, s.nodeId)).limit(1))[0];
      if (node) {
        const { setServerPower } = await import('../lib/wings-client.js');
        await setServerPower(node, s.uuid, 'stop', 10);
      }
    } catch { /* best-effort */ }
  }

  // ── Proxmox VPS assignments ──
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 64) return;

  const vpsExpired = await db.select().from(schema.proxmoxVmAssignments).where(and(lt(schema.proxmoxVmAssignments.expiresAt, now), isNull(schema.proxmoxVmAssignments.graceUntil)));
  for (const a of vpsExpired) {
    await db.update(schema.proxmoxVmAssignments).set({ graceUntil }).where(eq(schema.proxmoxVmAssignments.id, a.id));
    await db.insert(schema.auditLogs).values({ userId: a.userId, action: 'proxmox.vps.grace', targetType: 'proxmox_vm', targetId: String(a.id), meta: { vmid: a.vmid, graceUntil: graceUntil.toISOString() } });
  }

  const vpsGraceOver = await db.select().from(schema.proxmoxVmAssignments).where(and(isNull(schema.proxmoxVmAssignments.suspendedAt), lt(schema.proxmoxVmAssignments.graceUntil, now)));
  for (const a of vpsGraceOver) {
    await db.update(schema.proxmoxVmAssignments).set({ suspendedAt: now, suspendedReason: 'expired_grace_over' }).where(eq(schema.proxmoxVmAssignments.id, a.id));
    await db.insert(schema.auditLogs).values({ userId: a.userId, action: 'proxmox.vps.suspended', targetType: 'proxmox_vm', targetId: String(a.id), meta: { vmid: a.vmid, reason: 'expired_grace_over' } });
    if (!key) continue;
    const cluster = (await db.select().from(schema.proxmoxClusters).where(eq(schema.proxmoxClusters.id, a.clusterId)).limit(1))[0];
    if (!cluster) continue;
    // QEMU supports suspend-to-disk (state preserved); LXC only has stop.
    const action = a.type === 'qemu' ? 'suspend' : 'stop';
    try {
      await vmAction(cluster as never, key, a.node, a.type as 'qemu' | 'lxc', a.vmid, action);
    } catch (e) {
      console.error(`[expiry] failed to ${action} VPS ${a.vmid}:`, (e as Error).message);
    }
  }
}

export function startExpiryCron(db: Db, graceDays = 3, intervalMs = 60 * 60 * 1000) {
  runExpiryCheck(db, graceDays).catch(console.error);
  return setInterval(() => runExpiryCheck(db, graceDays).catch(console.error), intervalMs);
}
