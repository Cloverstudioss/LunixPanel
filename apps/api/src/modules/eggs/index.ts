import { Hono } from 'hono';
import { z } from 'zod';
import { validator } from 'hono/validator';
import { PterodactylEggSchema } from '@lunixpanel/shared';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.js';

function zJson<T extends z.ZodTypeAny>(s: T) {
  return validator('json', (v, c) => {
    const r = s.safeParse(v);
    if (!r.success) return c.json({ errors: [{ code: 'validation', detail: r.error.message }] }, 422);
    return r.data as z.infer<T>;
  });
}

const VariableBody = z.object({
  name: z.string().min(1).max(191),
  description: z.string().max(1000).optional().default(''),
  env_variable: z.string().min(1).max(191),
  default_value: z.string().max(191).optional().default(''),
  user_viewable: z.boolean().optional().default(true),
  user_editable: z.boolean().optional().default(true),
  rules: z.string().max(512).optional().default('required|string|max:191'),
  sort: z.number().int().optional().default(0),
});

const EggBody = z.object({
  name: z.string().min(1).max(191).optional(),
  author: z.string().min(1).max(191).optional(),
  description: z.string().max(1000).nullable().optional(),
  docker_image: z.string().min(1).max(512).optional(),
  docker_images: z.record(z.string()).optional(),
  banner: z.string().max(512).nullable().optional(),
  startup: z.string().min(1).max(2048).optional(),
  config: z.record(z.unknown()).optional(),
  script: z.record(z.unknown()).optional(),
});

export default function eggRoutes(db: Db) {
  const app = new Hono();
  app.get('/', async (c) => { const rows = await db.select().from(schema.eggs); return c.json({ data: rows }); });
  app.get('/:id', async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const rows = await db.select().from(schema.eggs).where(eq(schema.eggs.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Egg not found' }] }, 404);
    const variables = await db.select().from(schema.eggVariables).where(eq(schema.eggVariables.eggId, id));
    return c.json({ data: { ...rows[0], variables } });
  });
  app.post('/import', requireAdmin, async (c) => {
    const contentType = c.req.header('content-type') || '';
    let raw = '';
    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.parseBody();
      const file = form['file'];
      if (!file || typeof file === 'string') return c.json({ errors: [{ code: 'validation', detail: 'Upload a .egg JSON file' }] }, 422);
      raw = await (file as File).text();
    } else {
      raw = await c.req.text().catch(() => '');
    }
    if (!raw.trim()) return c.json({ errors: [{ code: 'invalid_json', detail: 'Missing egg data' }] }, 400);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return c.json({ errors: [{ code: 'invalid_json', detail: 'Invalid JSON — not a valid egg file' }] }, 400); }
    const parsed = PterodactylEggSchema.safeParse(body);
    if (!parsed.success) return c.json({ errors: [{ code: 'validation', detail: parsed.error.message }] }, 422);
    const egg = parsed.data;
    const dockerImage = Object.values(egg.docker_images)[0] || 'ghcr.io/pterodactyl/yolks:alpine';
    const nests = await db.select().from(schema.nests).where(eq(schema.nests.name, 'Imported')).limit(1);
    let nestId = nests[0]?.id;
    if (!nestId) { const [nest] = await db.insert(schema.nests).values({ name: 'Imported', author: 'LunixPanel', description: 'Auto-created' }).returning(); nestId = nest.id; }
    const script = (egg as Record<string, unknown>).scripts ? (egg as unknown as { scripts: { installation: Record<string, unknown> } }).scripts.installation : (egg as unknown as { script: Record<string, unknown> }).script || {};
    const [row] = await db.insert(schema.eggs).values({ nestId, author: egg.author, name: egg.name, description: (egg.description as string) || null, dockerImage, dockerImages: egg.docker_images, startup: egg.startup, config: egg.config as Record<string, unknown>, script: script as Record<string, unknown>, rawJson: body as Record<string, unknown> }).returning();
    for (const v of egg.variables) await db.insert(schema.eggVariables).values({ eggId: row.id, name: v.name, description: v.description, envVariable: v.env_variable, defaultValue: v.default_value, userViewable: v.user_viewable, userEditable: v.user_editable, rules: v.rules, sort: v.sort });
    return c.json({ data: row }, 201);
  });
  app.post('/', requireAdmin, zJson(z.object({ ...EggBody.shape, name: z.string().min(1).max(191), docker_image: z.string().min(1).max(512), startup: z.string().min(1).max(2048), variables: z.array(VariableBody).optional().default([]) })), async (c) => {
    const b = c.req.valid('json' as never) as { name: string; author?: string; description?: string | null; docker_image: string; docker_images?: Record<string, string>; banner?: string | null; startup: string; config?: Record<string, unknown>; script?: Record<string, unknown>; variables?: typeof VariableBody._type[] };
    const nests = await db.select().from(schema.nests).where(eq(schema.nests.name, 'Imported')).limit(1);
    let nestId = nests[0]?.id;
    if (!nestId) { const [nest] = await db.insert(schema.nests).values({ name: 'Imported', author: 'LunixPanel' }).returning(); nestId = nest.id; }
    const [row] = await db.insert(schema.eggs).values({ nestId, author: b.author || 'LunixPanel', name: b.name, description: b.description ?? null, dockerImage: b.docker_image, dockerImages: b.docker_images || { default: b.docker_image }, banner: b.banner ?? null, startup: b.startup, config: b.config || {}, script: b.script || {}, rawJson: b }).returning();
    for (const v of (b.variables || [])) await db.insert(schema.eggVariables).values({ eggId: row.id, name: v.name, description: v.description, envVariable: v.env_variable, defaultValue: v.default_value, userViewable: v.user_viewable, userEditable: v.user_editable, rules: v.rules, sort: v.sort });
    return c.json({ data: row }, 201);
  });
  app.patch('/:id', requireAdmin, zJson(EggBody), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const b = c.req.valid('json' as never) as { name?: string; author?: string; description?: string | null; docker_image?: string; docker_images?: Record<string, string>; banner?: string | null; startup?: string; config?: Record<string, unknown>; script?: Record<string, unknown> };
    const rows = await db.select().from(schema.eggs).where(eq(schema.eggs.id, id)).limit(1);
    if (!rows[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Egg not found' }] }, 404);
    const update: Record<string, unknown> = {};
    if (b.name !== undefined) update.name = b.name;
    if (b.author !== undefined) update.author = b.author;
    if (b.description !== undefined) update.description = b.description;
    if (b.docker_image !== undefined) update.dockerImage = b.docker_image;
    if (b.docker_images !== undefined) update.dockerImages = b.docker_images;
    if (b.banner !== undefined) update.banner = b.banner;
    if (b.startup !== undefined) update.startup = b.startup;
    if (b.config !== undefined) update.config = b.config;
    if (b.script !== undefined) update.script = b.script;
    if (Object.keys(update).length === 0) return c.json({ errors: [{ code: 'validation', detail: 'No fields to update' }] }, 422);
    const [row] = await db.update(schema.eggs).set(update).where(eq(schema.eggs.id, id)).returning();
    return c.json({ data: row });
  });
  app.delete('/:id', requireAdmin, async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const servers = await db.select().from(schema.servers).where(eq(schema.servers.eggId, id)).limit(1);
    if (servers[0]) return c.json({ errors: [{ code: 'conflict', detail: 'Egg is in use by a server — delete the server first.' }] }, 409);
    await db.delete(schema.eggVariables).where(eq(schema.eggVariables.eggId, id));
    const [row] = await db.delete(schema.eggs).where(eq(schema.eggs.id, id)).returning();
    if (!row) return c.json({ errors: [{ code: 'not_found', detail: 'Egg not found' }] }, 404);
    return c.json({ data: { ok: true } });
  });
  app.post('/:id/variables', requireAdmin, zJson(VariableBody), async (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    const egg = await db.select().from(schema.eggs).where(eq(schema.eggs.id, id)).limit(1);
    if (!egg[0]) return c.json({ errors: [{ code: 'not_found', detail: 'Egg not found' }] }, 404);
    const b = c.req.valid('json' as never) as typeof VariableBody._type;
    const [row] = await db.insert(schema.eggVariables).values({ eggId: id, name: b.name, description: b.description, envVariable: b.env_variable, defaultValue: b.default_value, userViewable: b.user_viewable, userEditable: b.user_editable, rules: b.rules, sort: b.sort }).returning();
    return c.json({ data: row }, 201);
  });
  app.patch('/:id/variables/:vid', requireAdmin, zJson(VariableBody), async (c) => {
    const vid = parseInt(c.req.param('vid') || '0', 10);
    const b = c.req.valid('json' as never) as typeof VariableBody._type;
    const [row] = await db.update(schema.eggVariables).set({ name: b.name, description: b.description, envVariable: b.env_variable, defaultValue: b.default_value, userViewable: b.user_viewable, userEditable: b.user_editable, rules: b.rules, sort: b.sort }).where(eq(schema.eggVariables.id, vid)).returning();
    if (!row) return c.json({ errors: [{ code: 'not_found', detail: 'Variable not found' }] }, 404);
    return c.json({ data: row });
  });
  app.delete('/:id/variables/:vid', requireAdmin, async (c) => {
    const vid = parseInt(c.req.param('vid') || '0', 10);
    const [row] = await db.delete(schema.eggVariables).where(eq(schema.eggVariables.id, vid)).returning();
    if (!row) return c.json({ errors: [{ code: 'not_found', detail: 'Variable not found' }] }, 404);
    return c.json({ data: { ok: true } });
  });
  return app;
}