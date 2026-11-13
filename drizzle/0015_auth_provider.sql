CREATE TABLE "auth_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean,
	"signup" text,
	"rules" jsonb,
	"options" jsonb,
	"client_secret_enc" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "auth_provider_id" CHECK ("auth_provider"."id" in ('password', 'oidc', 'github', 'google')),
	CONSTRAINT "auth_provider_signup" CHECK ("auth_provider"."signup" is null or "auth_provider"."signup" in ('closed', 'approval', 'rules'))
);
