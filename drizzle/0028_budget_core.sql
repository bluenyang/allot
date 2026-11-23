ALTER TYPE "public"."allocation_kind" ADD VALUE 'saving';--> statement-breakpoint
ALTER TYPE "public"."allocation_kind" ADD VALUE 'invest';--> statement-breakpoint
ALTER TYPE "public"."spend_how" ADD VALUE 'buffer';--> statement-breakpoint
CREATE TABLE "account_balance" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "account_balance_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_id" text NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"note" text,
	CONSTRAINT "account_balance_user_id_id" UNIQUE("user_id","id"),
	CONSTRAINT "account_balance_amount_nonneg" CHECK ("account_balance"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_balance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account_phase_amount" (
	"user_id" text NOT NULL,
	"phase_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "account_phase_amount_phase_id_account_id_pk" PRIMARY KEY("phase_id","account_id"),
	CONSTRAINT "account_phase_amount_nonneg" CHECK ("account_phase_amount"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_phase_amount" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "card" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "card_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"last4" text DEFAULT '' NOT NULL,
	"account_id" text,
	"billing_day" smallint,
	"note" text,
	CONSTRAINT "card_user_id_id" UNIQUE("user_id","id"),
	CONSTRAINT "card_last4" CHECK ("card"."last4" = '' or "card"."last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "card_billing_day" CHECK ("card"."billing_day" is null or "card"."billing_day" between 1 and 31)
);
--> statement-breakpoint
ALTER TABLE "card" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "living_item" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "living_item_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"kind" text DEFAULT '' NOT NULL,
	"pay_method" text DEFAULT '' NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"from_month" text,
	"code" text,
	"note" text,
	CONSTRAINT "living_item_user_id_id" UNIQUE("user_id","id"),
	CONSTRAINT "living_item_amount_nonneg" CHECK ("living_item"."amount" >= 0),
	CONSTRAINT "living_item_from_ym" CHECK ("living_item"."from_month" is null or "living_item"."from_month" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "living_item_code" CHECK ("living_item"."code" is null or "living_item"."code" in ('food', 'transit', 'allowance'))
);
--> statement-breakpoint
ALTER TABLE "living_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "living_phase_amount" (
	"user_id" text NOT NULL,
	"phase_id" text NOT NULL,
	"item_id" text NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "living_phase_amount_phase_id_item_id_pk" PRIMARY KEY("phase_id","item_id"),
	CONSTRAINT "living_phase_amount_nonneg" CHECK ("living_phase_amount"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "living_phase_amount" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocation_target" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "bank" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "last4" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "kind" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "rate" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "term" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "buffer" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "goal" integer;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "annual_limit" integer;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "group" text;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "ratio" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "from_month" text;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "stop_from" text;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "goal_ack" integer;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "saving_split" text DEFAULT 'amount' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "invest_split" text DEFAULT 'ratio' NOT NULL;--> statement-breakpoint
ALTER TABLE "spending" ADD COLUMN "card_id" text;--> statement-breakpoint
ALTER TABLE "spending" ADD COLUMN "refill_from" date;--> statement-breakpoint
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."bank_account"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_phase_amount" ADD CONSTRAINT "account_phase_amount_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_phase_amount" ADD CONSTRAINT "account_phase_amount_phase_fk" FOREIGN KEY ("user_id","phase_id") REFERENCES "public"."phase"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_phase_amount" ADD CONSTRAINT "account_phase_amount_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."bank_account"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."bank_account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "living_item" ADD CONSTRAINT "living_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "living_phase_amount" ADD CONSTRAINT "living_phase_amount_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "living_phase_amount" ADD CONSTRAINT "living_phase_amount_phase_fk" FOREIGN KEY ("user_id","phase_id") REFERENCES "public"."phase"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "living_phase_amount" ADD CONSTRAINT "living_phase_amount_item_fk" FOREIGN KEY ("user_id","item_id") REFERENCES "public"."living_item"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "living_item_user_code" ON "living_item" USING btree ("user_id","code") WHERE "living_item"."code" is not null;--> statement-breakpoint
ALTER TABLE "allocation_target" ADD CONSTRAINT "allocation_target_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."bank_account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending" ADD CONSTRAINT "spending_card_fk" FOREIGN KEY ("user_id","card_id") REFERENCES "public"."card"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_last4" CHECK ("bank_account"."last4" = '' or "bank_account"."last4" ~ '^[0-9]{4}$');--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_group" CHECK ("bank_account"."group" is null or "bank_account"."group" in ('saving', 'invest'));--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_amounts_nonneg" CHECK ("bank_account"."buffer" >= 0 and "bank_account"."amount" >= 0 and ("bank_account"."goal" is null or "bank_account"."goal" >= 0) and ("bank_account"."annual_limit" is null or "bank_account"."annual_limit" >= 0));--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_ratio_range" CHECK ("bank_account"."ratio" is null or ("bank_account"."ratio" >= 0 and "bank_account"."ratio" <= 1));--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_from_ym" CHECK ("bank_account"."from_month" is null or "bank_account"."from_month" ~ '^[0-9]{4}-[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_stop_ym" CHECK ("bank_account"."stop_from" is null or "bank_account"."stop_from" ~ '^[0-9]{4}-[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_saving_split" CHECK ("settings"."saving_split" in ('amount', 'ratio'));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_invest_split" CHECK ("settings"."invest_split" in ('amount', 'ratio'));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "account_balance" AS PERMISSIVE FOR ALL TO public USING ("account_balance"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("account_balance"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "account_phase_amount" AS PERMISSIVE FOR ALL TO public USING ("account_phase_amount"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("account_phase_amount"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "card" AS PERMISSIVE FOR ALL TO public USING ("card"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("card"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "living_item" AS PERMISSIVE FOR ALL TO public USING ("living_item"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("living_item"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "living_phase_amount" AS PERMISSIVE FOR ALL TO public USING ("living_phase_amount"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("living_phase_amount"."user_id" = current_setting('app.user_id', true));