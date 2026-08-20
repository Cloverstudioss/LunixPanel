import { lt, eq, and, isNull } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import * as schema from '../db/schema.js';

export async function runExpiryCheck(db: Db, graceDays = 3) {
  const now = new Date();
  const graceUntil = new Date(now.getTime() + graceDays * 24 * 3600 * 1000);

  // Servers that just expired -> enter grace period.
  const expired = await db.select().from(schema.servers).where(and(eq(schema.servers.status, 'active'), lt(schema.servers.expiresAt, now), isNull(schema.servers.graceUntil)));
  for (const s of expired) {
    await db.update(schema.servers).set({ graceUntil }).where(eq(schema.servers.id, s.id));
    await db.insert(schema.auditLogs).values({ userId: s.userId, action: 'server.grace', targetType: 'server', targetId: String(s.id), meta: { graceUntil: graceUntil.toISOString() } });
  }

  // Servers whose grace period has lapsed -> suspend.
  const graceOver = await db.select().from(schema.servers).where(and(eq(schema.servers.status, 'active'), lt(schema.servers.graceUntil, now)));
  for (const s of graceOver) {
    await db.update(schema.servers).set({ status: 'suspended', suspendedAt: now, suspendedReason: 'expired_grace_over' }).where(eq(schema.servers.id, s.id));
    await db.insert(schema.auditLogs).values({ userId: s.userId, action: 'server.suspended', targetType: 'server', targetId: String(s.id), meta: { reason: 'expired_grace_over' } });
  }
}

export function startExpiryCron(db: Db, graceDays = 3, intervalMs = 60 * 60 * 1000) {
  runExpiryCheck(db, graceDays).catch(console.error);
  return setInterval(() => runExpiryCheck(db, graceDays).catch(console.error), intervalMs);
}