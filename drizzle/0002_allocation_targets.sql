CREATE TYPE "public"."allocation_kind" AS ENUM('living', 'subscriptions', 'fixed', 'remainder');--> statement-breakpoint
CREATE TABLE "allocation_target" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "allocation_target_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"kind" "allocation_kind" NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "phase_amount" (
	"phase_id" text NOT NULL,
	"target_id" text NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "phase_amount_phase_id_target_id_pk" PRIMARY KEY("phase_id","target_id"),
	CONSTRAINT "phase_amount_nonneg" CHECK ("phase_amount"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "remainder_split" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "remainder_split_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"ratio" numeric(5, 4) NOT NULL,
	CONSTRAINT "remainder_split_ratio_range" CHECK ("remainder_split"."ratio" >= 0 and "remainder_split"."ratio" <= 1)
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "sub_round" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "phase_amount" ADD CONSTRAINT "phase_amount_phase_id_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phase"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_amount" ADD CONSTRAINT "phase_amount_target_id_allocation_target_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."allocation_target"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_target_single_kind" ON "allocation_target" USING btree ("kind") WHERE "allocation_target"."kind" <> 'fixed';