import { pgTable, serial, varchar, text, boolean, timestamp, integer, jsonb, index, uuid, bigint } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').notNull().unique().$defaultFn(() => crypto.randomUUID()),
  username: varchar('username', { length: 64 }).notNull().unique(),
  email: varchar('email', { length: 191 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  totpSecret: varchar('totp_secret', { length: 64 }),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  graceUntil: timestamp('grace_until', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  suspendedReason: varchar('suspended_reason', { length: 255 }),
  createdByAdminId: integer('created_by_admin_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('users_email_idx').on(t.email), index('users_expires_idx').on(t.expiresAt)]);

export const sessions = pgTable('sessions', {
  id: varchar('id', { length: 64 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ip: varchar('ip', { length: 45 }),
  ua: varchar('ua', { length: 512 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  prefix: varchar('prefix', { length: 16 }).notNull(),
  hash: varchar('hash', { length: 255 }).notNull(),
  perms: jsonb('perms').$type<string[]>().default([]),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const locations = pgTable('locations', {
  id: serial('id').primaryKey(),
  short: varchar('short', { length: 32 }).notNull(),
  long: varchar('long', { length: 191 }).notNull(),
});

export const nodes = pgTable('nodes', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').notNull().unique().$defaultFn(() => crypto.randomUUID()),
  name: varchar('name', { length: 191 }).notNull(),
  fqdn: varchar('fqdn', { length: 191 }).notNull(),
  scheme: varchar('scheme', { length: 10 }).notNull().default('https'),
  daemonToken: varchar('daemon_token', { length: 512 }).notNull(),
  daemonListen: integer('daemon_listen').notNull().default(8080),
  public: boolean('public').notNull().default(true),
  behindProxy: boolean('behind_proxy').notNull().default(false),
  locationId: integer('location_id').references(() => locations.id),
  memory: integer('memory').notNull().default(0),
  memoryOverallocate: integer('memory_overallocate').notNull().default(0),
  disk: integer('disk').notNull().default(0),
  diskOverallocate: integer('disk_overallocate').notNull().default(0),
  uploadSize: integer('upload_size').notNull().default(100),
  daemonBase: varchar('daemon_base', { length: 191 }).notNull().default('/var/lib/pterodactyl/volumes'),
});

export const allocations = pgTable('allocations', {
  id: serial('id').primaryKey(),
  nodeId: integer('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  ip: varchar('ip', { length: 45 }).notNull(),
  ipAlias: varchar('ip_alias', { length: 45 }),
  port: integer('port').notNull(),
  serverId: integer('server_id'),
}, (t) => [index('alloc_node_idx').on(t.nodeId)]);

export const nests = pgTable('nests', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').notNull().unique().$defaultFn(() => crypto.randomUUID()),
  author: varchar('author', { length: 191 }).notNull(),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description'),
});

export const eggs = pgTable('eggs', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').notNull().unique().$defaultFn(() => crypto.randomUUID()),
  nestId: integer('nest_id').notNull().references(() => nests.id, { onDelete: 'cascade' }),
  author: varchar('author', { length: 191 }).notNull(),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description'),
  dockerImage: varchar('docker_image', { length: 512 }).notNull(),
  dockerImages: jsonb('docker_images').$type<Record<string, string>>().notNull().default({}),
  banner: varchar('banner', { length: 512 }),
  startup: text('startup').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  script: jsonb('script').$type<Record<string, unknown>>().default({}),
  rawJson: jsonb('raw_json').$type<Record<string, unknown>>(),
}, (t) => [index('eggs_nest_idx').on(t.nestId)]);

export const eggVariables = pgTable('egg_variables', {
  id: serial('id').primaryKey(),
  eggId: integer('egg_id').notNull().references(() => eggs.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description'),
  envVariable: varchar('env_variable', { length: 191 }).notNull(),
  defaultValue: varchar('default_value', { length: 191 }).notNull().default(''),
  userViewable: boolean('user_viewable').notNull().default(true),
  userEditable: boolean('user_editable').notNull().default(true),
  rules: varchar('rules', { length: 512 }).notNull().default('required|string|max:191'),
  sort: integer('sort').notNull().default(0),
});

export const servers = pgTable('servers', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').notNull().unique().$defaultFn(() => crypto.randomUUID()),
  uuidShort: varchar('uuid_short', { length: 8 }).notNull().unique(),
  externalId: varchar('external_id', { length: 191 }),
  name: varchar('name', { length: 191 }).notNull(),
  description: text('description'),
  banner: varchar('banner', { length: 2048 }),
  status: varchar('status', { length: 20 }).notNull().default('installing'),
  userId: integer('user_id').notNull().references(() => users.id),
  nodeId: integer('node_id').notNull().references(() => nodes.id),
  eggId: integer('egg_id').notNull().references(() => eggs.id),
  allocationId: integer('allocation_id').notNull().references(() => allocations.id),
  allocationLimit: integer('allocation_limit').notNull().default(1),
  backupLimit: integer('backup_limit').notNull().default(0),
  memory: integer('memory').notNull().default(512),
  swap: integer('swap').notNull().default(0),
  disk: integer('disk').notNull().default(10240),
  io: integer('io').notNull().default(500),
  cpu: integer('cpu').notNull().default(100),
  threads: varchar('threads', { length: 191 }),
  oomDisabled: boolean('oom_disabled').notNull().default(false),
  startup: text('startup').notNull().default(''),
  image: varchar('image', { length: 512 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  graceUntil: timestamp('grace_until', { withTimezone: true }),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  suspendedReason: varchar('suspended_reason', { length: 255 }),
  installedAt: timestamp('installed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('servers_user_idx').on(t.userId), index('servers_node_idx').on(t.nodeId)]);

export const serverVariables = pgTable('server_variables', {
  id: serial('id').primaryKey(),
  serverId: integer('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  variableId: integer('variable_id').notNull().references(() => eggVariables.id, { onDelete: 'cascade' }),
  variableValue: text('variable_value').notNull().default(''),
});

export const backups = pgTable('backups', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').notNull().unique().$defaultFn(() => crypto.randomUUID()),
  serverId: integer('server_id').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 191 }).notNull(),
  size: bigint('size', { mode: 'number' }).notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('running'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [index('backups_server_idx').on(t.serverId)]);

export const proxmoxClusters = pgTable('proxmox_clusters', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 191 }).notNull(),
  host: varchar('host', { length: 512 }).notNull(),
  apiTokenId: varchar('api_token_id', { length: 191 }).notNull(),
  apiTokenSecretEncrypted: text('api_token_secret_encrypted').notNull(),
  verifyTls: boolean('verify_tls').notNull().default(false),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const proxmoxNodesCache = pgTable('proxmox_nodes_cache', {
  id: serial('id').primaryKey(),
  clusterId: integer('cluster_id').notNull().references(() => proxmoxClusters.id, { onDelete: 'cascade' }),
  node: varchar('node', { length: 191 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('online'),
  cpu: integer('cpu'),
  mem: integer('mem'),
  uptime: integer('uptime'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const proxmoxVmAssignments = pgTable('proxmox_vm_assignments', {
  id: serial('id').primaryKey(),
  clusterId: integer('cluster_id').notNull().references(() => proxmoxClusters.id, { onDelete: 'cascade' }),
  node: varchar('node', { length: 191 }).notNull(),
  type: varchar('type', { length: 10 }).notNull(),
  vmid: integer('vmid').notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('pve_assign_cluster_node_vmid_idx').on(t.clusterId, t.node, t.vmid)]);

export const settings = pgTable('settings', {
  key: varchar('key', { length: 191 }).primaryKey(),
  value: text('value').notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  action: varchar('action', { length: 191 }).notNull(),
  targetType: varchar('target_type', { length: 191 }),
  targetId: varchar('target_id', { length: 191 }),
  ip: varchar('ip', { length: 45 }),
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
