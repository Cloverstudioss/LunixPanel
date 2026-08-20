import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DATABASE_URL || 'postgres://lunix:lunix@localhost:5432/lunixpanel';
const client = postgres(url, { max: 1 });
const db = drizzle(client);
await migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations done');
await client.end();
