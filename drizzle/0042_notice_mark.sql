CREATE TABLE "notice_mark" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notice_mark_user_id_kind_key_pk" PRIMARY KEY("user_id","kind","key"),
	CONSTRAINT "notice_mark_kind" CHECK ("notice_mark"."kind" in ('read', 'maturity_kept'))
);
--> statement-breakpoint
ALTER TABLE "notice_mark" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notice_mark" ADD CONSTRAINT "notice_mark_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notice_mark_user_kind_created" ON "notice_mark" USING btree ("user_id","kind","created_at");--> statement-breakpoint
CREATE POLICY "allot_owner" ON "notice_mark" AS PERMISSIVE FOR ALL TO public USING ("notice_mark"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("notice_mark"."user_id" = current_setting('app.user_id', true));