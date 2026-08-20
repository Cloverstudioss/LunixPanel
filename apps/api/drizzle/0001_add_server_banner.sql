ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "banner" varchar(2048);
--> statement-breakpoint
ALTER TABLE "eggs" ADD COLUMN IF NOT EXISTS "banner" varchar(512);
