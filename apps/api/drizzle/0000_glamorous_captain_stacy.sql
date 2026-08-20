CREATE TABLE "account_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(191) NOT NULL,
	"email" varchar(191) NOT NULL,
	"company" varchar(191),
	"reason" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" integer NOT NULL,
	"ip" varchar(45) NOT NULL,
	"ip_alias" varchar(45),
	"port" integer NOT NULL,
	"server_id" integer
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"hash" varchar(255) NOT NULL,
	"perms" jsonb DEFAULT '[]'::jsonb,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" varchar(191) NOT NULL,
	"target_type" varchar(191),
	"target_id" varchar(191),
	"ip" varchar(45),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "egg_variables" (
	"id" serial PRIMARY KEY NOT NULL,
	"egg_id" integer NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	"env_variable" varchar(191) NOT NULL,
	"default_value" varchar(191) DEFAULT '' NOT NULL,
	"user_viewable" boolean DEFAULT true NOT NULL,
	"user_editable" boolean DEFAULT true NOT NULL,
	"rules" varchar(512) DEFAULT 'required|string|max:191' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eggs" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid NOT NULL,
	"nest_id" integer NOT NULL,
	"author" varchar(191) NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	"docker_image" varchar(512) NOT NULL,
	"docker_images" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"startup" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"script" jsonb DEFAULT '{}'::jsonb,
	"raw_json" jsonb,
	CONSTRAINT "eggs_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"short" varchar(32) NOT NULL,
	"long" varchar(191) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nests" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid NOT NULL,
	"author" varchar(191) NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	CONSTRAINT "nests_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid NOT NULL,
	"name" varchar(191) NOT NULL,
	"fqdn" varchar(191) NOT NULL,
	"scheme" varchar(10) DEFAULT 'https' NOT NULL,
	"daemon_token" varchar(512) NOT NULL,
	"daemon_listen" integer DEFAULT 8080 NOT NULL,
	"public" boolean DEFAULT true NOT NULL,
	"behind_proxy" boolean DEFAULT false NOT NULL,
	"location_id" integer,
	"memory" integer DEFAULT 0 NOT NULL,
	"memory_overallocate" integer DEFAULT 0 NOT NULL,
	"disk" integer DEFAULT 0 NOT NULL,
	"disk_overallocate" integer DEFAULT 0 NOT NULL,
	"upload_size" integer DEFAULT 100 NOT NULL,
	"daemon_base" varchar(191) DEFAULT '/var/lib/pterodactyl/volumes' NOT NULL,
	CONSTRAINT "nodes_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "proxmox_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(191) NOT NULL,
	"host" varchar(512) NOT NULL,
	"api_token_id" varchar(191) NOT NULL,
	"api_token_secret_encrypted" text NOT NULL,
	"verify_tls" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proxmox_nodes_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_id" integer NOT NULL,
	"node" varchar(191) NOT NULL,
	"status" varchar(32) DEFAULT 'online' NOT NULL,
	"cpu" integer,
	"mem" integer,
	"uptime" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_variables" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" integer NOT NULL,
	"variable_id" integer NOT NULL,
	"variable_value" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid NOT NULL,
	"uuid_short" varchar(8) NOT NULL,
	"external_id" varchar(191),
	"name" varchar(191) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'installing' NOT NULL,
	"user_id" integer NOT NULL,
	"node_id" integer NOT NULL,
	"egg_id" integer NOT NULL,
	"allocation_id" integer NOT NULL,
	"memory" integer DEFAULT 512 NOT NULL,
	"swap" integer DEFAULT 0 NOT NULL,
	"disk" integer DEFAULT 10240 NOT NULL,
	"io" integer DEFAULT 500 NOT NULL,
	"cpu" integer DEFAULT 100 NOT NULL,
	"threads" varchar(191),
	"oom_disabled" boolean DEFAULT false NOT NULL,
	"startup" text DEFAULT '' NOT NULL,
	"image" varchar(512) NOT NULL,
	"expires_at" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"installed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servers_uuid_unique" UNIQUE("uuid"),
	CONSTRAINT "servers_uuid_short_unique" UNIQUE("uuid_short")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"ip" varchar(45),
	"ua" varchar(512),
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(191) PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid NOT NULL,
	"username" varchar(64) NOT NULL,
	"email" varchar(191) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"totp_secret" varchar(64),
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspended_reason" varchar(255),
	"created_by_admin_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_uuid_unique" UNIQUE("uuid"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "egg_variables" ADD CONSTRAINT "egg_variables_egg_id_eggs_id_fk" FOREIGN KEY ("egg_id") REFERENCES "public"."eggs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eggs" ADD CONSTRAINT "eggs_nest_id_nests_id_fk" FOREIGN KEY ("nest_id") REFERENCES "public"."nests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxmox_clusters" ADD CONSTRAINT "proxmox_clusters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxmox_nodes_cache" ADD CONSTRAINT "proxmox_nodes_cache_cluster_id_proxmox_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."proxmox_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_variables" ADD CONSTRAINT "server_variables_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_variables" ADD CONSTRAINT "server_variables_variable_id_egg_variables_id_fk" FOREIGN KEY ("variable_id") REFERENCES "public"."egg_variables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_egg_id_eggs_id_fk" FOREIGN KEY ("egg_id") REFERENCES "public"."eggs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ar_status_idx" ON "account_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ar_email_idx" ON "account_requests" USING btree ("email");--> statement-breakpoint
CREATE INDEX "alloc_node_idx" ON "allocations" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "eggs_nest_idx" ON "eggs" USING btree ("nest_id");--> statement-breakpoint
CREATE INDEX "servers_user_idx" ON "servers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "servers_node_idx" ON "servers" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_expires_idx" ON "users" USING btree ("expires_at");