CREATE TYPE "public"."pay_by" AS ENUM('card', 'salary', 'subs');--> statement-breakpoint
CREATE TYPE "public"."round_state" AS ENUM('left', 'paid', 'merged');--> statement-breakpoint
CREATE TYPE "public"."spend_how" AS ENUM('lump', 'installment', 'split');--> statement-breakpoint
CREATE TYPE "public"."spend_interval" AS ENUM('monthly', 'biweekly', 'custom');--> statement-breakpoint
CREATE TABLE "spending" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "spending_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"note" text,
	"category" text NOT NULL,
	"bought" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"fx_rate" numeric(8, 2),
	"how" "spend_how" NOT NULL,
	"pay_by" "pay_by" NOT NULL,
	"count" smallint NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	"interval" "spend_interval",
	"cancelled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "spending_user_id_id" UNIQUE("user_id","id"),
	CONSTRAINT "spending_amount_nonneg" CHECK ("spending"."amount" >= 0),
	CONSTRAINT "spending_fee_nonneg" CHECK ("spending"."fee" >= 0),
	CONSTRAINT "spending_count_range" CHECK ("spending"."count" between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "spending" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "spending_round" (
	"user_id" text NOT NULL,
	"spending_id" text NOT NULL,
	"no" smallint NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"state" "round_state" NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "spending_round_spending_id_no_pk" PRIMARY KEY("spending_id","no"),
	CONSTRAINT "spending_round_amount_nonneg" CHECK ("spending_round"."amount" >= 0),
	CONSTRAINT "spending_round_no_range" CHECK ("spending_round"."no" between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "spending_round" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spending" ADD CONSTRAINT "spending_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_round" ADD CONSTRAINT "spending_round_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_round" ADD CONSTRAINT "spending_round_spending_fk" FOREIGN KEY ("user_id","spending_id") REFERENCES "public"."spending"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "allot_owner" ON "spending" AS PERMISSIVE FOR ALL TO public USING ("spending"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("spending"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "spending_round" AS PERMISSIVE FOR ALL TO public USING ("spending_round"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("spending_round"."user_id" = current_setting('app.user_id', true));