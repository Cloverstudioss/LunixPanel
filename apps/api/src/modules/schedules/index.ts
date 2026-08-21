import { Hono } from 'hono';
import { z } from 'zod';
import { Cron } from 'croner';
import { eq, and, lte, or, isNull } from 'drizzle-orm';
import crypto from 'node:crypto';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.js';

type AuthedUser = { id: number; isAdmin: boolean };

function zJson<T extends z.ZodTypeAny>(s: T) {
  return async (c: { req: { json: () => Promise<unknown> }; json: (o: unknown, st?: number) => Response }, next: () => Promise<void>) => {
    const body = await c.req.json().catch(() => null);
    const r = s.safeParse(body);
    if (!r.success) return c.json({ errors: [{ code: 'validation', detail: r.error.message }] }, 422);
    (c as unknown as Record<string, unknown>).validated = r.data;
    await next();
  };
}

function nextRun(cronExpr: string): Date | null {
  try {
    const job = new Cron(cronExpr, { paused: true });
    const next = job.nextRun();
    job.stop();
    return next || null;
  } catch {
    return null;
  }
}

export function validateCron(expr: string): boolean {
  try { new Cron(expr); return true; } catch { return false; }
}

// Execute one schedule's tasks sequentially against wings.
async function runSchedule(db: Db, scheduleId: number): Promise<void> {
  const sched = (await db.select().from(schema.schedules).where(eq(schema.schedules.id, scheduleId)).limit(1))[0];
  if (!sched) return;
  const server = (await db.select().from(schema.servers).where(eq(schema.servers.id, sched.serverId)).limit(1))[0];
  if (!server || server.status === 'suspended') return;
  const node = (await db.select().from(schema.nodes).where(eq(schema.nodes.id, server.nodeId)).limit(1))[0];
  if (!node) return;
  const tasks = await db.select().from(schema.scheduleTasks).where(eq(schema.scheduleTasks.scheduleId, scheduleId));
  tasks.sort((a, b) => a.sequenceId - b.sequenceId);
  const { setServerPower, sendServerCommand } = await import('../../lib/wings-client.js');
  for (const t of tasks) {
    if (t.timeOffsetSeconds > 0) await new Promise((r) => setTimeout(r, t.timeOffsetSeconds * 1000));
    try {
      if (t.action === 'command' && t.payload) {
        await sendServerCommand(node, server.uuid, t.payload);
      } else if (t.action === 'power' && t.payload && ['start', 'stop', 'restart', 'kill'].includes(t.payload)) {
        await setServerPower(node, server.uuid, t.payload as 'start' | 'stop' | 'restart' | 'kill');
      } else if (t.action === 'backup') {
        const uuid = crypto.randomUUID();
        const name = `schedule-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
        const [row] = await db.insert(schema.backups).values({ uuid, serverId: server.id, name, status: 'running' }).returning();
        try {
          const r = await fetch(`${node.scheme}://${node.fqdn}:${node.daemonListen}/api/servers/${server.uuid}/backup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${node.daemonToken}` },
            body: JSON.stringify({ adapter: 'wings', uuid, ignore: '' }),
            signal: AbortSignal.timeout(30000),
          });
          if (!r.ok) await db.update(schema.backups).set({ status: 'failed', completedAt: new Date() }).where(eq(schema.backups.id, row.id));
        } catch {
          await db.update(schema.backups).set({ status: 'failed', completedAt: new Date() }).where(eq(schema.backups.id, row.id));
        }
      }
    } catch (e) {
      console.error(`[schedules] task ${t.action} failed for server ${server.id}:`, (e as Error).message);
    }
  }
}

export function startScheduleRunner(db: Db, intervalMs = 60_000) {
  const tick = async () => {
    const now = new Date();
    const due = await db.select().from(schema.schedules).where(and(
      eq(schema.schedules.active, true),
      or(isNull(schema.schedules.nextRunAt), lte(schema.schedules.nextRunAt, now)),
    ));
    for (const s of due) {
      // Claim the slot first so overlapping ticks don't double-run.
      const next = nextRun(s.cron);
      const claim = eq(schema.schedules.id, s.id);
      await db.update(schema.schedules).set({ lastRunAt: now, nextRunAt: next }).where(claim);
      runSchedule(db, s.id).catch((e) => console.error(`[schedules] run ${s.id} failed:`, e));
    }
  };
  setTimeout(tick, 5_000).unref?.();
  return setInterval(tick, intervalMs);
}

export default function scheduleRoutes(db: Db) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as AuthedUser;
    if (!u) return c.json({ errors: [{ code: 'unauthorized', detail: 'Authentication required' }] }, 401);
    await next();
  });

  async function ownedServer(c: { get: (k: string) => unknown; json: (o: unknown, st?: number) => Response }, serverId: number) {
    const u = (c as unknown as { get: (k: string) => unknown }).get('user') as AuthedUser;
    const s = (await db.select().from(schema.servers).where(eq(schema.servers.id, serverId)).limit(1))[0];
    if (!s) return { res: c.json({ errors: [{ code: 'not_found', detail: 'Server not found' }] }, 404) };
    if (!u.isAdmin && s.userId !== u.id) return { res: c.json({ errors: [{ code: 'forbidden', detail: 'Not your server' }] }, 403) };
    return { s, u };
  }

  app.get('/', async (c) => {
    const serverId = parseInt(c.req.query('serverId') || '0', 10);
    if (!serverId) return c.json({ errors: [{ code: 'validation', detail: 'serverId query required' }] }, 422);
    const owned = await ownedServer(c, serverId);
    if ('res' in owned) return owned.res;
    const rows = await db.select().from(schema.schedules).where(eq(schema.schedules.serverId, serverId));
    const withTasks = await Promise.all(rows.map(async (r) => ({
      ...r,
      tasks: await db.select().from(schema.scheduleTasks).where(eq(schema.scheduleTasks.scheduleId, r.id)),
    })));
    return c.json({ data: withTasks });
  });

  app.post('/', zJson(z.object({
    serverId: z.number().int(),
    name: z.string().min(1).max(191),
    cron: z.string().min(9).max(64),
    active: z.boolean().default(true),
    tasks: z.array(z.object({
      action: z.enum(['command', 'power', 'backup']),
      payload: z.string().max(500).nullable().optional(),
      timeOffsetSeconds: z.number().int().min(0).max(3600).default(0),
    })).min(1).max(10),
  })), async (c) => {
    const b = (c as unknown as { get: (k: string) => unknown }).get('validated') as { serverId: number; name: string; cron: string; active: boolean; tasks: { action: string; payload?: string | null; timeOffsetSeconds?: number }[] };
    const owned = await ownedServer(c, b.serverId);
    if ('res' in owned) return owned.res;
    if (!validateCron(b.cron)) return c.json({ errors: [{ code: 'validation', detail: `Invalid cron expression "${b.cron}"` }] }, 422);
    const [row] = await db.insert(schema.schedules).values({ serverId: b.serverId, name: b.name.trim(), cron: b.cron.trim(), active: b.active, nextRunAt: b.active ? nextRun(b.cron) : null }).returning();
    let seq = 0;
    for (const t of b.tasks) {
      await db.insert(schema.scheduleTasks).values({ scheduleId: row.id, sequenceId: seq++, action: t.action, payload: t.payload ?? null, timeOffsetSeconds: t.timeOffsetSeconds ?? 0 });
    }
    return c.json({ data: { ...row, tasks: b.tasks } }, 201);
  });

  app.patch('/:id', zJson(z.object({
    name: z.string().min(1).max(191).optional(),
    cron: z.string().min(9).max(64).optional(),
    active: z.boolean().optional(),
    tasks: z.array(z.object({
      action: z.enum(['command', 'power', 'backup']),
      payload: z.string().max(500).nullable().optional(),
      timeOffsetSeconds: z.number().int().min(0).max(3600).default(0),
    })).optional(),
  })), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = (c as unknown as { get: (k: string) => unknown }).get('validated') as { name?: string; cron?: string; active?: boolean; tasks?: { action: string; payload?: string | null; timeOffsetSeconds?: number }[] };
    const sched = (await db.select().from(schema.schedules).where(eq(schema.schedules.id, id)).limit(1))[0];
    if (!sched) return c.json({ errors: [{ code: 'not_found', detail: 'Schedule not found' }] }, 404);
    const owned = await ownedServer(c, sched.serverId);
    if ('res' in owned) return owned.res;
    const update: Record<string, unknown> = {};
    if (b.name !== undefined) update.name = b.name.trim();
    if (b.cron !== undefined) {
      if (!validateCron(b.cron)) return c.json({ errors: [{ code: 'validation', detail: `Invalid cron expression "${b.cron}"` }] }, 422);
      update.cron = b.cron.trim();
      update.nextRunAt = nextRun(b.cron);
    }
    if (b.active !== undefined) {
      update.active = b.active;
      update.nextRunAt = b.active ? nextRun(String(update.cron ?? sched.cron)) : null;
    }
    await db.update(schema.schedules).set(update).where(eq(schema.schedules.id, id));
    if (b.tasks) {
      await db.delete(schema.scheduleTasks).where(eq(schema.scheduleTasks.scheduleId, id));
      let seq = 0;
      for (const t of b.tasks) {
        await db.insert(schema.scheduleTasks).values({ scheduleId: id, sequenceId: seq++, action: t.action, payload: t.payload ?? null, timeOffsetSeconds: t.timeOffsetSeconds ?? 0 });
      }
    }
    const [row] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id)).limit(1);
    const tasks = await db.select().from(schema.scheduleTasks).where(eq(schema.scheduleTasks.scheduleId, id));
    return c.json({ data: { ...row, tasks } });
  });

  app.delete('/:id', async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const sched = (await db.select().from(schema.schedules).where(eq(schema.schedules.id, id)).limit(1))[0];
    if (!sched) return c.json({ errors: [{ code: 'not_found', detail: 'Schedule not found' }] }, 404);
    const owned = await ownedServer(c, sched.serverId);
    if ('res' in owned) return owned.res;
    await db.delete(schema.schedules).where(eq(schema.schedules.id, id));
    return c.json({ data: { ok: true } });
  });

  app.post('/:id/run', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const sched = (await db.select().from(schema.schedules).where(eq(schema.schedules.id, id)).limit(1))[0];
    if (!sched) return c.json({ errors: [{ code: 'not_found', detail: 'Schedule not found' }] }, 404);
    runSchedule(db, id).catch((e) => console.error(`[schedules] manual run ${id} failed:`, e));
    return c.json({ data: { ok: true } }, 202);
  });

  return app;
}
