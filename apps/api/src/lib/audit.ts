import type { Db } from '../db/index.js';
import * as schema from '../db/schema.js';

export async function audit(db: Db, userId: number | null, action: string, targetType?: string, targetId?: string, ip?: string, meta?: Record<string, unknown>) {
  try { await db.insert(schema.auditLogs).values({ userId, action, targetType, targetId, ip, meta }); } catch {}
}

export function auditIp(c: { req: { header: (n: string) => string | undefined } }) {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || '';
}
