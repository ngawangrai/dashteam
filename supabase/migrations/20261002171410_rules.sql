CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'intern');--> statement-breakpoint
CREATE TYPE "public"."rule_key" AS ENUM('tds', 'health_contribution', 'provident_fund', 'gis', 'proration', 'it1a_inclusion');--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" "rule_key" NOT NULL,
	"employment_type" "employment_type" NOT NULL,
	"effective_from" date NOT NULL,
	"value" jsonb NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "rules_key_type_effective_from" UNIQUE("key","employment_type","effective_from"),
	CONSTRAINT "rules_effective_from_first_of_month" CHECK (extract(day from "rules"."effective_from") = 1)
);
--> statement-breakpoint
ALTER TABLE "rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "rules_select_admin" ON "rules" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.is_admin()));