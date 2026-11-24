CREATE TABLE "income_extra" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "income_extra_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"date" date NOT NULL,
	"name" text NOT NULL,
	"amount" integer NOT NULL,
	"note" text,
	CONSTRAINT "income_extra_user_id_id" UNIQUE("user_id","id"),
	CONSTRAINT "income_extra_amount_nonneg" CHECK ("income_extra"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "income_extra" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "income_item" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "income_item_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"cycle" text NOT NULL,
	"month" integer,
	"day" integer NOT NULL,
	"amount" integer NOT NULL,
	"account_id" text,
	"note" text,
	CONSTRAINT "income_item_user_id_id" UNIQUE("user_id","id"),
	CONSTRAINT "income_item_cycle" CHECK (("income_item"."cycle" = 'monthly' and "income_item"."month" is null) or ("income_item"."cycle" = 'yearly' and "income_item"."month" between 1 and 12)),
	CONSTRAINT "income_item_day_range" CHECK ("income_item"."day" between 1 and 31),
	CONSTRAINT "income_item_amount_nonneg" CHECK ("income_item"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "income_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "income_receipt" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "income_receipt_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"item_id" text,
	"ym" text NOT NULL,
	"amount" integer NOT NULL,
	"date" date,
	"note" text,
	CONSTRAINT "income_receipt_user_id_id" UNIQUE("user_id","id"),
	CONSTRAINT "income_receipt_amount_nonneg" CHECK ("income_receipt"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "income_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "income_extra" ADD CONSTRAINT "income_extra_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_item" ADD CONSTRAINT "income_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_item" ADD CONSTRAINT "income_item_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."bank_account"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_receipt" ADD CONSTRAINT "income_receipt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_receipt" ADD CONSTRAINT "income_receipt_item_fk" FOREIGN KEY ("user_id","item_id") REFERENCES "public"."income_item"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "allot_owner" ON "income_extra" AS PERMISSIVE FOR ALL TO public USING ("income_extra"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("income_extra"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "income_item" AS PERMISSIVE FOR ALL TO public USING ("income_item"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("income_item"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "income_receipt" AS PERMISSIVE FOR ALL TO public USING ("income_receipt"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("income_receipt"."user_id" = current_setting('app.user_id', true));