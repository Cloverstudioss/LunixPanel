import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.js';

const ENV_MAP: Record<string, string> = {
  panel_name: 'APP_NAME',
  company: 'APP_VENDOR',
  studio: 'APP_STUDIO',
  app_url: 'APP_URL',
  cors_origin: 'CORS_ORIGIN',
  grace_days: 'GRACE_DAYS',
};

export default function settingsRoutes(db: Db) {
  const app = new Hono();
  app.get('/', requireAdmin, async (c) => {
    const rows = await db.select().from(schema.settings);
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    for (const [k, env] of Object.entries(ENV_MAP)) if (out[k] == null && process.env[env]) out[k] = process.env[env] as string;
    return c.json({ data: out });
  });
  app.patch('/', requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, string> | null;
    if (!body || typeof body !== 'object') return c.json({ errors: [{ code: 'validation', detail: 'Invalid body' }] }, 422);
    for (const [k, v] of Object.entries(body)) {
      if (typeof v !== 'string') continue;
      if (v.length > 500) return c.json({ errors: [{ code: 'validation', detail: `${k} too long` }] }, 422);
      await db.insert(schema.settings).values({ key: k, value: v }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v } });
    }
    return c.json({ data: { ok: true } });
  });
  return app;
}
