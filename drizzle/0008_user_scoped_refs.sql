ALTER TABLE "living" ADD PRIMARY KEY ("user_id");--> statement-breakpoint
ALTER TABLE "settings" ADD PRIMARY KEY ("user_id");--> statement-breakpoint
ALTER TABLE "phase_amount" ADD CONSTRAINT "phase_amount_phase_fk" FOREIGN KEY ("user_id","phase_id") REFERENCES "public"."phase"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_amount" ADD CONSTRAINT "phase_amount_target_fk" FOREIGN KEY ("user_id","target_id") REFERENCES "public"."allocation_target"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change" ADD CONSTRAINT "plan_change_sub_fk" FOREIGN KEY ("user_id","sub_id") REFERENCES "public"."subscription"("user_id","id") ON DELETE cascade ON UPDATE no action;