ALTER TYPE "public"."category" ADD VALUE 'other';--> statement-breakpoint
CREATE TABLE "month_adjust" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "month_adjust_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ym" text NOT NULL,
	"target_id" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text,
	CONSTRAINT "month_adjust_user_id_id" UNIQUE("user_id","id"),
	CONSTRAINT "month_adjust_user_ym_target" UNIQUE("user_id","ym","target_id"),
	CONSTRAINT "month_adjust_amount_nonneg" CHECK ("month_adjust"."amount" >= 0),
	CONSTRAINT "month_adjust_ym" CHECK ("month_adjust"."ym" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "month_adjust" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_account" ADD COLUMN "after_maturity" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "month_adjust" ADD CONSTRAINT "month_adjust_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_adjust" ADD CONSTRAINT "month_adjust_target_fk" FOREIGN KEY ("user_id","target_id") REFERENCES "public"."allocation_target"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "allot_owner" ON "month_adjust" AS PERMISSIVE FOR ALL TO public USING ("month_adjust"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("month_adjust"."user_id" = current_setting('app.user_id', true));