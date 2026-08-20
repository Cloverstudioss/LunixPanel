import { lt, eq, and } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import * as schema from '../db/schema.js';

export async function runExpiryCheck(db: Db, graceDays = 3) {
  const now = new Date();
  const activeUsers = await db.select().from(schema.users).where(and(eq(schema.users.status, 'active'), lt(schema.users.expiresAt, now)));
  for (const u of activeUsers) {
    if (!u.expiresAt || u.graceUntil) continue;
    const graceUntil = new Date(now.getTime() + graceDays * 24 * 3600 * 1000);
    await db.update(schema.users).set({ status: 'grace', graceUntil }).where(eq(schema.users.id, u.id));
    await db.insert(schema.auditLogs).values({ userId: u.id, action: 'user.grace', targetType: 'user', targetId: String(u.id), meta: { graceUntil: graceUntil.toISOString() } });
  }

  const graceUsers = await db.select().from(schema.users).where(and(eq(schema.users.status, 'grace'), lt(schema.users.graceUntil, now)));
  for (const u of graceUsers) {
    await db.update(schema.users).set({ status: 'suspended', suspendedAt: now, suspendedReason: 'expired_grace_over' }).where(eq(schema.users.id, u.id));
    const userServers = await db.select().from(schema.servers).where(eq(schema.servers.userId, u.id));
    for (const s of userServers) {
      if (s.status !== 'suspended') {
        await db.update(schema.servers).set({ status: 'suspended' }).where(eq(schema.servers.id, s.id));
      }
    }
    await db.insert(schema.auditLogs).values({ userId: u.id, action: 'user.suspended', targetType: 'user', targetId: String(u.id), meta: { reason: 'expired_grace_over' } });
  }

  const expiringServers = await db.select().from(schema.servers).where(and(eq(schema.servers.status, 'active'), lt(schema.servers.expiresAt, now)));
  for (const s of expiringServers) {
    const graceUntil = s.graceUntil ?? new Date(now.getTime() + graceDays * 24 * 3600 * 1000);
    if (!s.graceUntil) {
      await db.update(schema.servers).set({ status: 'suspended', graceUntil }).where(eq(schema.servers.id, s.id));
    } else if (new Date(s.graceUntil) < now) {
      await db.update(schema.servers).set({ status: 'suspended' }).where(eq(schema.servers.id, s.id));
    }
  }
}

export function startExpiryCron(db: Db, graceDays = 3, intervalMs = 60 * 60 * 1000) {
  runExpiryCheck(db, graceDays).catch(console.error);
  return setInterval(() => runExpiryCheck(db, graceDays).catch(console.error), intervalMs);
}
