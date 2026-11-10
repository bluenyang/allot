CREATE TYPE "public"."category" AS ENUM('ai', 'telecom', 'content', 'tool', 'insurance', 'life');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('KRW', 'USD');--> statement-breakpoint
CREATE TYPE "public"."cycle" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."event_state" AS ENUM('done', 'doing', 'todo');--> statement-breakpoint
CREATE TYPE "public"."pay_path" AS ENUM('direct', 'google', 'apple', 'telecom');--> statement-breakpoint
CREATE TYPE "public"."sub_status" AS ENUM('active', 'cancelled', 'company');--> statement-breakpoint
CREATE TABLE "bank_account" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "bank_account_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"inflow" text DEFAULT '' NOT NULL,
	"outflow" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_item" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "check_item_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debt" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "debt_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"principal" integer NOT NULL,
	"rate" text DEFAULT '' NOT NULL,
	"method" text DEFAULT '' NOT NULL,
	"plan" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isa_split" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "isa_split_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"ratio" numeric(5, 4) NOT NULL,
	CONSTRAINT "isa_split_ratio_range" CHECK ("isa_split"."ratio" >= 0 and "isa_split"."ratio" <= 1)
);
--> statement-breakpoint
CREATE TABLE "living" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"food" integer NOT NULL,
	"transit" integer NOT NULL,
	"allowance" integer NOT NULL,
	CONSTRAINT "living_single_row" CHECK ("living"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "phase" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "phase_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"label" text NOT NULL,
	"name" text NOT NULL,
	"from_month" text NOT NULL,
	"to_month" text,
	"cheongyak" integer DEFAULT 0 NOT NULL,
	"cma" integer DEFAULT 0 NOT NULL,
	"future" integer DEFAULT 0 NOT NULL,
	"reserve" integer DEFAULT 0 NOT NULL,
	"note" text,
	CONSTRAINT "phase_from_ym" CHECK ("phase"."from_month" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "phase_to_ym" CHECK ("phase"."to_month" is null or "phase"."to_month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "plan_change" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "plan_change_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sub_id" text NOT NULL,
	"effective" date,
	"patch" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "plan_change_patch_object" CHECK (jsonb_typeof("plan_change"."patch") = 'object')
);
--> statement-breakpoint
CREATE TABLE "plan_event" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "plan_event_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"when" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"state" "event_state" DEFAULT 'todo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"net_pay" integer NOT NULL,
	"fx_rate" numeric(8, 2) NOT NULL,
	"fx_buffer" numeric(5, 2) NOT NULL,
	"pay_day" smallint NOT NULL,
	"transfer_day" smallint NOT NULL,
	"billing_day" smallint NOT NULL,
	"round_unit" integer NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "subscription_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"category" "category" NOT NULL,
	"plan" text DEFAULT '' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"vat" numeric(5, 2) DEFAULT 0 NOT NULL,
	"cycle" "cycle" NOT NULL,
	"status" "sub_status" DEFAULT 'active' NOT NULL,
	"next_date" date NOT NULL,
	"path" "pay_path" DEFAULT 'direct' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"note" text,
	CONSTRAINT "subscription_amount_nonneg" CHECK ("subscription"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "plan_change" ADD CONSTRAINT "plan_change_sub_id_subscription_id_fk" FOREIGN KEY ("sub_id") REFERENCES "public"."subscription"("id") ON DELETE cascade ON UPDATE no action;