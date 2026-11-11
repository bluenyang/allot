CREATE TYPE "public"."actor_kind" AS ENUM('user', 'api_key');--> statement-breakpoint
CREATE TYPE "public"."change_op" AS ENUM('insert', 'update', 'delete');--> statement-breakpoint
CREATE TABLE "change_log" (
	"user_id" text NOT NULL,
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "change_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"set_id" text NOT NULL,
	"table_name" text NOT NULL,
	"row_key" jsonb NOT NULL,
	"op" "change_op" NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
ALTER TABLE "change_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "change_set" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"revert_of" text,
	"reverted_by" text,
	CONSTRAINT "change_set_user_id_id" UNIQUE("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "change_set" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_set_fk" FOREIGN KEY ("user_id","set_id") REFERENCES "public"."change_set"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_set" ADD CONSTRAINT "change_set_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_set" ON "change_log" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "change_set_user_at" ON "change_set" USING btree ("user_id","at");--> statement-breakpoint
CREATE POLICY "allot_owner" ON "change_log" AS PERMISSIVE FOR ALL TO public USING ("change_log"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("change_log"."user_id" = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "allot_owner" ON "change_set" AS PERMISSIVE FOR ALL TO public USING ("change_set"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("change_set"."user_id" = current_setting('app.user_id', true));