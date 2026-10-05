CREATE TYPE "public"."email_kind" AS ENUM('payslip', 'payslip_resend', 'payslip_self', 'leave_requested', 'leave_decided');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."rule_key" ADD VALUE 'company_details';--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "email_kind" NOT NULL,
	"payslip_id" uuid,
	"leave_request_id" uuid,
	"to_email" text NOT NULL,
	"dedupe_key" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_id" text,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_deliveries_dedupe" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "email_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"month" date NOT NULL,
	"reference" text NOT NULL,
	"employment_type" "employment_type" NOT NULL,
	"take_home_ch" bigint NOT NULL,
	"content" jsonb NOT NULL,
	"pdf" "bytea" NOT NULL,
	"pdf_sha256" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" uuid,
	CONSTRAINT "payslips_snapshot" UNIQUE("snapshot_id"),
	CONSTRAINT "payslips_reference" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "payslips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_snapshot_id_payroll_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."payroll_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_payslip" ON "email_deliveries" USING btree ("payslip_id");--> statement-breakpoint
CREATE INDEX "email_deliveries_status" ON "email_deliveries" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "payslips_person_month" ON "payslips" USING btree ("person_id","month");--> statement-breakpoint
CREATE POLICY "email_deliveries_select_admin_or_requester" ON "email_deliveries" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.is_admin()) or "email_deliveries"."requested_by" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "payslips_select_own_or_admin" ON "payslips" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("payslips"."person_id" = (select public.current_person_id()) or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "payslips_insert_admin" ON "payslips" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.is_admin()));