CREATE TABLE "holiday_set" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "holiday_set_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"builtin" text,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "holiday_set_user_id_id" UNIQUE("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "holiday_set" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"theme_mode" text DEFAULT 'system' NOT NULL,
	"primary" text,
	"accent" text,
	"radius" text DEFAULT 'base' NOT NULL,
	"density" text DEFAULT 'base' NOT NULL,
	"date_format" text DEFAULT 'iso' NOT NULL,
	"amount_unit" text DEFAULT 'won' NOT NULL,
	"negative" text DEFAULT 'minus' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "day_shift" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday_set" ADD CONSTRAINT "holiday_set_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference" ADD CONSTRAINT "preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_set_user_builtin" ON "holiday_set" USING btree ("user_id","builtin") WHERE "holiday_set"."builtin" is not null;--> statement-breakpoint
CREATE POLICY "allot_owner" ON "holiday_set" AS PERMISSIVE FOR ALL TO public USING ("holiday_set"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("holiday_set"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "preference" AS PERMISSIVE FOR ALL TO public USING ("preference"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("preference"."user_id" = current_setting('app.user_id', true));