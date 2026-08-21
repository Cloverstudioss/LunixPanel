CREATE TABLE "proxmox_ips" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_id" integer NOT NULL,
	"node" varchar(191) NOT NULL,
	"bridge" varchar(191) NOT NULL DEFAULT 'vmbr0',
	"address" varchar(191) NOT NULL,
	"gateway" varchar(191),
	"vlan" integer,
	"description" varchar(191),
	"assignment_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "proxmox_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(191) NOT NULL,
	"description" text,
	"type" varchar(10) NOT NULL,
	"ostemplate" varchar(512),
	"iso" varchar(512),
	"storage" varchar(191),
	"default_cores" integer,
	"default_memory" integer,
	"default_disk" integer,
	"banner" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- statement-breakpoint
ALTER TABLE "proxmox_ips" ADD CONSTRAINT "proxmox_ips_cluster_id_proxmox_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."proxmox_clusters"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "proxmox_ips" ADD CONSTRAINT "proxmox_ips_assignment_id_proxmox_vm_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."proxmox_vm_assignments"("id") ON DELETE SET NULL ON UPDATE no action;
-- statement-breakpoint
CREATE INDEX "pve_ip_cluster_node_idx" ON "proxmox_ips" USING btree ("cluster_id","node");
CREATE INDEX "pve_ip_address_idx" ON "proxmox_ips" USING btree ("address");
CREATE INDEX "pve_ip_assignment_idx" ON "proxmox_ips" USING btree ("assignment_id");
CREATE INDEX "pve_template_name_idx" ON "proxmox_templates" USING btree ("name");
