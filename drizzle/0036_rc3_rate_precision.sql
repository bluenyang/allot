ALTER TABLE "foreign_currency" ALTER COLUMN "rate" SET DATA TYPE numeric(14, 6);--> statement-breakpoint
ALTER TABLE "spending" ALTER COLUMN "fx_rate" SET DATA TYPE numeric(14, 6);