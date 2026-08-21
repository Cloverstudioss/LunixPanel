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

const existingThemes = await db.select().from(schema.themes).limit(1);
if (existingThemes.length === 0) {
  await db.insert(schema.themes).values([
    {
      slug: 'dark', name: 'Dark', mode: 'dark', isActive: true,
      colors: { bg:'#0a0a0a', bgSoft:'#131315', surface:'#17171a', surface2:'#1c1c1e', line:'#212126', lineStrong:'#2a2a30', text:'#f4f4f5', muted:'#9f9fa9', muted2:'#71717a', accent:'#22c55e', accentHover:'#4ade80' },
    },
    {
      slug: 'light', name: 'Light', mode: 'light', isActive: false,
      colors: { bg:'#f7f7f9', bgSoft:'#f0f0f2', surface:'#ffffff', surface2:'#f0f0f2', line:'#d2d2d6', lineStrong:'#b8b8c0', text:'#18181b', muted:'#6b7280', muted2:'#9ca3af', accent:'#2563eb', accentHover:'#3b82f6' },
    },
  ]);
  console.log('Seeded default themes (Dark, Light)');
} else {
  console.log(`DB already has ${existingThemes.length} theme(s)`);
}
process.exit(0);
