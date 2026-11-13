ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "admission" text DEFAULT 'approval' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_status" CHECK ("user"."status" in ('active', 'pending'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_admission" CHECK ("user"."admission" in ('seed', 'admin', 'approval', 'rule', 'bootstrap'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role" CHECK ("user"."role" in ('admin', 'user'));