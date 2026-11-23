ALTER TYPE "public"."actor_kind" ADD VALUE 'system';--> statement-breakpoint
CREATE TABLE "foreign_currency" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "foreign_currency_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"rate" numeric(8, 2) NOT NULL,
	"buffer" numeric(5, 2) DEFAULT 0 NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"auto_at" timestamp with time zone,
	"auto_error" text,
	CONSTRAINT "foreign_currency_user_id_id" UNIQUE("user_id","id"),
	CONSTRAINT "foreign_currency_user_code" UNIQUE("user_id","code"),
	CONSTRAINT "foreign_currency_code" CHECK ("foreign_currency"."code" ~ '^[A-Z]{3}$' and "foreign_currency"."code" not in ('KRW', 'USD')),
	CONSTRAINT "foreign_currency_rate_pos" CHECK ("foreign_currency"."rate" > 0),
	CONSTRAINT "foreign_currency_buffer_range" CHECK ("foreign_currency"."buffer" >= 0 and "foreign_currency"."buffer" <= 100)
);
--> statement-breakpoint
ALTER TABLE "foreign_currency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "login_failure" (
	"email" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_item" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "schedule_item_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"day" smallint NOT NULL,
	"account_id" text,
	"direction" text NOT NULL,
	"note" text,
	CONSTRAINT "schedule_item_user_id_id" UNIQUE("user_id","id"),
	CONSTRAINT "schedule_item_day" CHECK ("schedule_item"."day" between 1 and 31),
	CONSTRAINT "schedule_item_direction" CHECK ("schedule_item"."direction" in ('in', 'out'))
);
--> statement-breakpoint
ALTER TABLE "schedule_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_setting" DROP CONSTRAINT "app_setting_id";--> statement-breakpoint
ALTER TABLE "spending" ALTER COLUMN "currency" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "subscription" ALTER COLUMN "currency" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "preference" ADD COLUMN "timezone" text DEFAULT 'Asia/Seoul' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "fx_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "fx_auto_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "fx_auto_error" text;--> statement-breakpoint
ALTER TABLE "foreign_currency" ADD CONSTRAINT "foreign_currency_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item" ADD CONSTRAINT "schedule_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_item" ADD CONSTRAINT "schedule_item_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."bank_account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_setting" ADD CONSTRAINT "app_setting_id" CHECK ("app_setting"."id" in ('api_keys', 'password'));--> statement-breakpoint
ALTER TABLE "spending" ADD CONSTRAINT "spending_currency_code" CHECK ("spending"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_currency_code" CHECK ("subscription"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
CREATE POLICY "allot_owner" ON "foreign_currency" AS PERMISSIVE FOR ALL TO public USING ("foreign_currency"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("foreign_currency"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "schedule_item" AS PERMISSIVE FOR ALL TO public USING ("schedule_item"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("schedule_item"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
DROP TYPE "public"."currency";