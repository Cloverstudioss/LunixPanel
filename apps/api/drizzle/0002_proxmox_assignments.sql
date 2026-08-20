CREATE TABLE "proxmox_vm_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_id" integer NOT NULL,
	"node" varchar(191) NOT NULL,
	"type" varchar(10) NOT NULL,
	"vmid" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proxmox_vm_assignments" ADD CONSTRAINT "proxmox_vm_assignments_cluster_id_proxmox_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."proxmox_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxmox_vm_assignments" ADD CONSTRAINT "proxmox_vm_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pve_assign_cluster_node_vmid_idx" ON "proxmox_vm_assignments" USING btree ("cluster_id","node","vmid");--> statement-breakpoint
CREATE UNIQUE INDEX "pve_assign_unique_vm" ON "proxmox_vm_assignments" USING btree ("cluster_id","node","vmid");
