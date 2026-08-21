CREATE TABLE "themes" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL UNIQUE,
	"name" varchar(191) NOT NULL,
	"mode" varchar(10) NOT NULL DEFAULT 'dark',
	"colors" jsonb NOT NULL DEFAULT '{}',
	"is_active" boolean NOT NULL DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "themes_slug_idx" ON "themes" USING btree ("slug");
CREATE INDEX "themes_active_idx" ON "themes" USING btree ("is_active");

-- statement-breakpoint
-- Ensure only one active theme at any time
CREATE UNIQUE INDEX "themes_active_one" ON "themes" ("is_active") WHERE "is_active" = true;
