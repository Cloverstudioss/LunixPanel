import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { BRANDING } from '@lunixpanel/shared';
import { createDb } from './db/index.js';
import { authMiddleware, requireAuth } from './middleware/auth.js';
import { paidCheck } from './middleware/paidCheck.js';
import { rateLimit } from './middleware/rateLimit.js';
import { startExpiryCron } from './cron/expiryChecker.js';
import authRoutes from './modules/auth/index.js';
import eggRoutes from './modules/eggs/index.js';
import proxmoxRoutes from './modules/proxmox/index.js';
import proxmoxConsoleRoutes from './modules/proxmox/console.js';
import userRoutes from './modules/users/index.js';
import nodeRoutes from './modules/nodes/index.js';
import serverRoutes from './modules/servers/index.js';
import scheduleRoutes, { startScheduleRunner } from './modules/schedules/index.js';
import databaseRoutes from './modules/databases/index.js';
import remoteRoutes from './modules/remote/index.js';
import settingsRoutes from './modules/settings/index.js';
import themeRoutes from './modules/themes/index.js';
import auditRoutes from './modules/audit/index.js';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://lunix:lunix@localhost:5432/lunixpanel';
const GRACE_DAYS = parseInt(process.env.GRACE_DAYS || '3', 10);

let db: ReturnType<typeof createDb>;
try {
  db = createDb(DATABASE_URL);
} catch {
  db = null as unknown as ReturnType<typeof createDb>;
}

const app = new Hono<{ Variables: { user: unknown; db: typeof db } }>();

app.use('*', logger());
app.use('*', async (c, next) => {
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-XSS-Protection', '0');
  await next();
});
app.use('*', cors({
  origin: (origin) => {
    const allowed = (process.env.CORS_ORIGIN || 'http://localhost:25050').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.includes('*')) return origin || allowed[0];
    if (!origin) return allowed[0];
    return allowed.includes(origin) ? origin : allowed[0];
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));
app.use('*', async (c, next) => { c.set('db', db); await next(); });

app.get('/api/health', (c) => c.json({ status: 'ok', name: BRANDING.panel, vendor: BRANDING.vendor, studio: BRANDING.studio, version: '0.1.0' }));

app.route('/api/remote', remoteRoutes(db as never));

app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 8, keyPrefix: 'login' }));
app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5, keyPrefix: 'reg' }));

if (db) {
  app.use('*', authMiddleware(db));
  app.use('/api/servers/*', paidCheck as never);
  app.route('/api/auth', authRoutes(db));
  app.route('/api/eggs', eggRoutes(db));
  app.route('/api/proxmox', proxmoxRoutes(db));
  app.route('/api/proxmox', proxmoxConsoleRoutes(db));
  app.route('/api/users', userRoutes(db));
  app.route('/api/nodes', nodeRoutes(db));
  app.route('/api/servers', serverRoutes(db));
  app.route('/api/schedules', scheduleRoutes(db));
  app.route('/api/databases', databaseRoutes(db));
  app.route('/api/settings', settingsRoutes(db));
  app.route('/api/themes', themeRoutes(db));
  app.route('/api/audit', auditRoutes(db));

  app.get('/api/me', requireAuth, async (c) => {
    const u = c.get('user') as { id: number; uuid: string; email: string; username: string; isAdmin: boolean; status: string; expiresAt: Date | null; graceUntil: Date | null };
    return c.json({ data: u });
  });

  if (process.env.NODE_ENV !== 'test') {
    startExpiryCron(db, GRACE_DAYS);
    startScheduleRunner(db);
  }
}

app.onError((err, c) => {
  console.error(err);
  return c.json({ errors: [{ code: 'internal_error', detail: 'Something went wrong' }] }, 500);
});

const port = parseInt(process.env.PORT || '3000', 10);
const { websocket: bunWebSocketHandler } = await import('hono/bun');
export default { port, fetch: app.fetch, websocket: bunWebSocketHandler };
export { app, db };
