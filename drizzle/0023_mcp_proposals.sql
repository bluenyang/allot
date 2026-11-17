CREATE TABLE "mcp_proposal" (
	"user_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"key_id" text NOT NULL,
	"key_name" text NOT NULL,
	"confirm" text NOT NULL,
	"ops" jsonb NOT NULL,
	"note" text,
	"base_hash" text NOT NULL,
	"preview" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"change_set_id" text,
	"revert_of" text,
	CONSTRAINT "mcp_proposal_user_id_id" UNIQUE("user_id","id"),
	CONSTRAINT "mcp_proposal_confirm" CHECK ("mcp_proposal"."confirm" in ('ui', 'chat')),
	CONSTRAINT "mcp_proposal_status" CHECK ("mcp_proposal"."status" in ('pending', 'applied', 'rejected', 'expired', 'stale')),
	CONSTRAINT "mcp_proposal_decided_by" CHECK ("mcp_proposal"."decided_by" is null or "mcp_proposal"."decided_by" in ('user', 'key'))
);
--> statement-breakpoint
ALTER TABLE "mcp_proposal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "change_set" ADD COLUMN "actor_label" text;--> statement-breakpoint
ALTER TABLE "change_set" ADD COLUMN "proposal_id" text;--> statement-breakpoint
ALTER TABLE "mcp_proposal" ADD CONSTRAINT "mcp_proposal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_proposal_user_status" ON "mcp_proposal" USING btree ("user_id","status");--> statement-breakpoint
CREATE POLICY "allot_owner" ON "mcp_proposal" AS PERMISSIVE FOR ALL TO public USING ("mcp_proposal"."user_id" = current_setting('app.user_id', true)) WITH CHECK ("mcp_proposal"."user_id" = current_setting('app.user_id', true));