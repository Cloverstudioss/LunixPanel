DO $$ BEGIN ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_user_id_users_id_fk"; EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "allocation_limit" integer DEFAULT 1 NOT NULL; EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "backup_limit" integer DEFAULT 0 NOT NULL; EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "database_limit" integer DEFAULT 0 NOT NULL; EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone; EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "suspended_reason" varchar(255); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "proxmox_vm_assignments" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone; EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "proxmox_vm_assignments" ADD COLUMN IF NOT EXISTS "grace_until" timestamp with time zone; EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "proxmox_vm_assignments" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone; EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "proxmox_vm_assignments" ADD COLUMN IF NOT EXISTS "suspended_reason" varchar(255); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "database_hosts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(191) NOT NULL,
	"host" varchar(191) NOT NULL,
	"port" integer DEFAULT 3306 NOT NULL,
	"username" varchar(64) NOT NULL,
	"password_encrypted" text NOT NULL,
	"max_databases" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "databases" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"database_host_id" integer NOT NULL,
	"database_name" varchar(64) NOT NULL,
	"username" varchar(64) NOT NULL,
	"password_encrypted" text NOT NULL,
	"remote" varchar(64) DEFAULT '%' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "databases_database_name_unique" UNIQUE("database_name")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "schedule_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"sequence_id" integer DEFAULT 0 NOT NULL,
	"action" varchar(20) NOT NULL,
	"payload" text,
	"time_offset_seconds" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"name" varchar(191) NOT NULL,
	"cron" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "backups" ADD CONSTRAINT "backups_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "databases" ADD CONSTRAINT "databases_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "databases" ADD CONSTRAINT "databases_database_host_id_database_hosts_id_fk" FOREIGN KEY ("database_host_id") REFERENCES "public"."database_hosts"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "proxmox_ips" ADD CONSTRAINT "proxmox_ips_cluster_id_proxmox_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."proxmox_clusters"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "proxmox_ips" ADD CONSTRAINT "proxmox_ips_assignment_id_proxmox_vm_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."proxmox_vm_assignments"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "proxmox_vm_assignments" ADD CONSTRAINT "proxmox_vm_assignments_cluster_id_proxmox_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."proxmox_clusters"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "proxmox_vm_assignments" ADD CONSTRAINT "proxmox_vm_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "schedules" ADD CONSTRAINT "schedules_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "backups_server_idx" ON "backups" USING btree ("server_id"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "databases_server_idx" ON "databases" USING btree ("server_id"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "pve_ip_cluster_node_idx" ON "proxmox_ips" USING btree ("cluster_id","node"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "pve_ip_address_idx" ON "proxmox_ips" USING btree ("address"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "pve_ip_assignment_idx" ON "proxmox_ips" USING btree ("assignment_id"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "pve_template_name_idx" ON "proxmox_templates" USING btree ("name"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "pve_assign_cluster_node_vmid_idx" ON "proxmox_vm_assignments" USING btree ("cluster_id","node","vmid"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "schedule_tasks_schedule_idx" ON "schedule_tasks" USING btree ("schedule_id"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "schedules_server_idx" ON "schedules" USING btree ("server_id"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "schedules_next_run_idx" ON "schedules" USING btree ("next_run_at"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "themes_slug_idx" ON "themes" USING btree ("slug"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE INDEX IF NOT EXISTS "themes_active_idx" ON "themes" USING btree ("is_active"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint


DO $$ BEGIN CREATE UNIQUE INDEX IF NOT EXISTS "alloc_node_ip_port_uq" ON "allocations" USING btree ("node_id","ip","port"); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; WHEN duplicate_column THEN NULL; END $$;
