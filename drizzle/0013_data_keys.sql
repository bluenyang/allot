CREATE TABLE "system_key" (
	"id" text PRIMARY KEY NOT NULL,
	"dek_id" text NOT NULL,
	"kid" text NOT NULL,
	"wrapped" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_key" (
	"user_id" text PRIMARY KEY NOT NULL,
	"dek_id" text NOT NULL,
	"kid" text NOT NULL,
	"wrapped" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_key" ADD CONSTRAINT "user_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "allot_owner" ON "user_key" AS PERMISSIVE FOR ALL TO public USING ("user_key"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("user_key"."user_id" = current_setting('app.user_id', true));