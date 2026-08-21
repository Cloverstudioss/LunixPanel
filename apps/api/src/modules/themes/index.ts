import { Hono } from 'hono';
import { eq, desc, ne } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.js';

type Theme = {
  id: number;
  slug: string;
  name: string;
  mode: string;
  colors: Record<string, string>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const DEFAULT_DARK_THEME = {
  slug: 'dark',
  mode: 'dark',
  colors: {
    bg: '#0a0a0a', bgSoft: '#131315', surface: '#17171a', surface2: '#1c1c1e',
    line: '#212126', lineStrong: '#2a2a30',
    text: '#f4f4f5', muted: '#9f9fa9', muted2: '#71717a',
    accent: '#22c55e', accentHover: '#4ade80',
  },
};

const THEME_KEYS = ['bg', 'bgSoft', 'surface', 'surface2', 'line', 'lineStrong',
  'text', 'muted', 'muted2', 'accent', 'accentHover'] as const;

function sanitizeColors(input: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (THEME_KEYS.includes(k as (typeof THEME_KEYS)[number]) && typeof v === 'string') {
        result[k] = v;
      }
    }
  }
  return result;
}

function serialize(t: typeof schema.themes.$inferSelect): Theme {
  return {
    id: t.id, slug: t.slug, name: t.name, mode: t.mode,
    colors: t.colors as Record<string, string>,
    isActive: t.isActive, createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

export default function themeRoutes(db: Db) {
  const app = new Hono();

  // Public: get the active theme (or default)
  app.get('/active', async (c) => {
    const rows = await db.select().from(schema.themes).where(eq(schema.themes.isActive, true)).limit(1);
    if (rows.length > 0) return c.json({ data: serialize(rows[0]) });
    return c.json({ data: DEFAULT_DARK_THEME });
  });

  // Admin: list all themes
  app.get('/', requireAdmin, async (c) => {
    const rows = await db.select().from(schema.themes).orderBy(desc(schema.themes.isActive), schema.themes.id);
    return c.json({ data: rows.map(serialize) });
  });

  // Admin: get one theme
  app.get('/:id', requireAdmin, async (c) => {
    const id = Number(c.req.param('id'));
    const rows = await db.select().from(schema.themes).where(eq(schema.themes.id, id)).limit(1);
    if (rows.length === 0) return c.json({ errors: [{ code: 'not_found', detail: 'Theme not found' }] }, 404);
    return c.json({ data: serialize(rows[0]) });
  });

  // Admin: create a theme
  app.post('/', requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null) as {
      name?: string; slug?: string; mode?: string; colors?: unknown; isActive?: boolean;
    } | null;
    if (!body || !body.name || !body.slug) {
      return c.json({ errors: [{ code: 'validation', detail: 'name and slug are required' }] }, 422);
    }
    if (!['dark', 'light'].includes(body.mode || 'dark')) {
      return c.json({ errors: [{ code: 'validation', detail: 'mode must be "dark" or "light"' }] }, 422);
    }
    const colors = sanitizeColors(body.colors);
    try {
      if (body.isActive) {
        await db.update(schema.themes).set({ isActive: false }).where(eq(schema.themes.isActive, true));
      }
      const [created] = await db.insert(schema.themes).values({
        slug: body.slug, name: body.name, mode: body.mode || 'dark',
        colors, isActive: body.isActive || false,
      }).returning();
      return c.json({ data: serialize(created) }, 201);
    } catch (e: any) {
      if (e?.code === '23505') {
        return c.json({ errors: [{ code: 'conflict', detail: 'A theme with that slug already exists' }] }, 409);
      }
      throw e;
    }
  });

  // Admin: update a theme
  app.patch('/:id', requireAdmin, async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => null) as {
      name?: string; slug?: string; mode?: string; colors?: unknown; isActive?: boolean;
    } | null;
    if (!body) return c.json({ errors: [{ code: 'validation', detail: 'Invalid body' }] }, 422);

    const rows = await db.select().from(schema.themes).where(eq(schema.themes.id, id)).limit(1);
    if (rows.length === 0) return c.json({ errors: [{ code: 'not_found', detail: 'Theme not found' }] }, 404);
    const existing = rows[0];

    if (body.mode && !['dark', 'light'].includes(body.mode)) {
      return c.json({ errors: [{ code: 'validation', detail: 'mode must be "dark" or "light"' }] }, 422);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.slug !== undefined) updates.slug = body.slug;
    if (body.mode !== undefined) updates.mode = body.mode;
    if (body.colors !== undefined) updates.colors = sanitizeColors(body.colors);
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    if (body.isActive === true && !existing.isActive) {
      await db.update(schema.themes).set({ isActive: false }).where(eq(schema.themes.isActive, true));
    }

    try {
      const [updated] = await db.update(schema.themes)
        .set(updates)
        .where(eq(schema.themes.id, id))
        .returning();
      return c.json({ data: serialize(updated) });
    } catch (e: any) {
      if (e?.code === '23505') {
        return c.json({ errors: [{ code: 'conflict', detail: 'A theme with that slug already exists' }] }, 409);
      }
      throw e;
    }
  });

  // Admin: delete a theme (cannot delete the active one)
  app.delete('/:id', requireAdmin, async (c) => {
    const id = Number(c.req.param('id'));
    const rows = await db.select().from(schema.themes).where(eq(schema.themes.id, id)).limit(1);
    if (rows.length === 0) return c.json({ errors: [{ code: 'not_found', detail: 'Theme not found' }] }, 404);
    if (rows[0].isActive) {
      return c.json({ errors: [{ code: 'conflict', detail: 'Cannot delete the active theme' }] }, 409);
    }
    await db.delete(schema.themes).where(eq(schema.themes.id, id));
    return c.json({ data: { ok: true } });
  });

  return app;
}
