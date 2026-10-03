CREATE TYPE "public"."child_order" AS ENUM('first_or_second', 'later');--> statement-breakpoint
CREATE TYPE "public"."holiday_kind" AS ENUM('fixed', 'lunar', 'one_off');--> statement-breakpoint
CREATE TYPE "public"."holiday_scope" AS ENUM('national', 'thimphu');--> statement-breakpoint
CREATE TYPE "public"."holiday_status" AS ENUM('confirmed', 'tentative');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('annual', 'sick', 'professional_development', 'maternity', 'paternity', 'bereavement', 'family_emergency', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('accepted', 'changed', 'waived');--> statement-breakpoint
ALTER TYPE "public"."rule_key" ADD VALUE 'leave_policy';--> statement-breakpoint
ALTER TYPE "public"."rule_key" ADD VALUE 'leave_carry_forward';--> statement-breakpoint
ALTER TYPE "public"."rule_key" ADD VALUE 'working_week';--> statement-breakpoint
ALTER TYPE "public"."rule_key" ADD VALUE 'proration_cutoff';--> statement-breakpoint
ALTER TYPE "public"."rule_key" ADD VALUE 'leave_backdate';--> statement-breakpoint
ALTER TYPE "public"."rule_key" ADD VALUE 'leave_exit_payout';--> statement-breakpoint
CREATE TABLE "exit_leave_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"leave_year" integer NOT NULL,
	"days_over" numeric(6, 1) NOT NULL,
	"daily_rate_ch" bigint NOT NULL,
	"suggested_ch" bigint NOT NULL,
	"final_ch" bigint,
	"unused_annual_days" numeric(6, 1) NOT NULL,
	"status" "settlement_status" NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exit_leave_settlements_person_year" UNIQUE("person_id","leave_year"),
	CONSTRAINT "exit_leave_settlements_amount_matches_status" CHECK (("exit_leave_settlements"."status" = 'waived' and "exit_leave_settlements"."final_ch" is null) or ("exit_leave_settlements"."status" <> 'waived' and "exit_leave_settlements"."final_ch" is not null and "exit_leave_settlements"."final_ch" >= 0))
);
--> statement-breakpoint
ALTER TABLE "exit_leave_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"year" integer NOT NULL,
	"kind" "holiday_kind" NOT NULL,
	"scope" "holiday_scope" NOT NULL,
	"status" "holiday_status" NOT NULL,
	"source" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_name_year" UNIQUE("name","year"),
	CONSTRAINT "holidays_end_after_start" CHECK ("holidays"."end_date" >= "holidays"."start_date"),
	CONSTRAINT "holidays_within_year" CHECK (extract(year from "holidays"."start_date") = "holidays"."year" and extract(year from "holidays"."end_date") = "holidays"."year"),
	CONSTRAINT "holidays_source_given" CHECK (length(trim("holidays"."source")) > 0)
);
--> statement-breakpoint
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"leave_request_id" uuid,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "leave_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"leave_type" "leave_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_half" boolean DEFAULT false NOT NULL,
	"end_half" boolean DEFAULT false NOT NULL,
	"child_order" "child_order",
	"event_date" date,
	"note" text DEFAULT '' NOT NULL,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"decision_note" text DEFAULT '' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"owner_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_end_after_start" CHECK ("leave_requests"."end_date" >= "leave_requests"."start_date"),
	CONSTRAINT "leave_requests_one_half_on_a_single_day" CHECK (not ("leave_requests"."start_date" = "leave_requests"."end_date" and "leave_requests"."start_half" and "leave_requests"."end_half"))
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exit_leave_settlements" ADD CONSTRAINT "exit_leave_settlements_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_leave_settlements" ADD CONSTRAINT "exit_leave_settlements_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_notices" ADD CONSTRAINT "leave_notices_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_notices" ADD CONSTRAINT "leave_notices_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holidays_dates" ON "holidays" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "leave_notices_person" ON "leave_notices" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "leave_requests_person_dates" ON "leave_requests" USING btree ("person_id","start_date");--> statement-breakpoint
CREATE POLICY "rules_select_with_access" ON "rules" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.has_access()));--> statement-breakpoint
CREATE POLICY "exit_leave_settlements_admin" ON "exit_leave_settlements" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "holidays_select_with_access" ON "holidays" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.has_access()));--> statement-breakpoint
CREATE POLICY "holidays_insert_admin" ON "holidays" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "holidays_update_admin" ON "holidays" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "holidays_delete_admin" ON "holidays" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "leave_notices_select_own_or_admin" ON "leave_notices" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("leave_notices"."person_id" = (select public.current_person_id()) or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "leave_notices_insert_admin" ON "leave_notices" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "leave_notices_update_own" ON "leave_notices" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("leave_notices"."person_id" = (select public.current_person_id())) WITH CHECK ("leave_notices"."person_id" = (select public.current_person_id()));--> statement-breakpoint
CREATE POLICY "leave_requests_select_own_or_admin" ON "leave_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("leave_requests"."person_id" = (select public.current_person_id()) or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "leave_requests_insert_own_pending_or_admin" ON "leave_requests" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (("leave_requests"."person_id" = (select public.current_person_id()) and "leave_requests"."status" = 'pending' and "leave_requests"."requested_by" = (select auth.uid()))
        or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "leave_requests_update_own_or_admin" ON "leave_requests" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("leave_requests"."person_id" = (select public.current_person_id()) or (select public.is_admin())) WITH CHECK ("leave_requests"."person_id" = (select public.current_person_id()) or (select public.is_admin()));