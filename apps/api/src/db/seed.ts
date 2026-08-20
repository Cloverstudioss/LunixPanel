import * as argon2 from 'argon2';
import { createDb } from './index.js';
import * as schema from './schema.js';

const url = process.env.DATABASE_URL || 'postgres://lunix:lunix@localhost:5432/lunixpanel';
const db = createDb(url);

const email = process.env.ADMIN_EMAIL || 'admin@qyrocloud.local';
const username = process.env.ADMIN_USER || 'admin';
const password = process.env.ADMIN_PASS || 'LunixAdmin123!';

const existing = await db.select().from(schema.users).limit(1);
if (existing.length === 0) {
  const hash = await argon2.hash(password);
  const [user] = await db.insert(schema.users).values({ username, email, passwordHash: hash, isAdmin: true, status: 'active' }).returning();
  await db.insert(schema.settings).values([
    { key: 'panel_name', value: 'LunixPanel' },
    { key: 'company', value: 'QyroCloud' },
    { key: 'studio', value: 'Clover Studios' },
    { key: 'grace_days', value: '3' },
  ]).onConflictDoNothing();
  const [loc] = await db.insert(schema.locations).values({ short: 'us', long: 'Default' }).returning();
  console.log(`Seeded admin: ${email} / ${password} (id=${user.id}, loc=${loc.id})`);
} else {
  console.log(`DB already has ${existing.length} user(s), skipping seed. Admin: ${existing.find(u => u.isAdmin)?.email || existing[0].email}`);
}
process.exit(0);
