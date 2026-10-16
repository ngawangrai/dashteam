CREATE TYPE "public"."certificate_request_status" AS ENUM('pending', 'issued', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_source" AS ENUM('live', 'imported');--> statement-breakpoint
ALTER TYPE "public"."email_kind" ADD VALUE 'certificate_issued';--> statement-breakpoint
ALTER TYPE "public"."rule_key" ADD VALUE 'certificate_settings';--> statement-breakpoint
CREATE TABLE "certificate_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"addressee" text DEFAULT '' NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"status" "certificate_request_status" DEFAULT 'pending' NOT NULL,
	"decision_note" text DEFAULT '' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_requests_lengths" CHECK (char_length("certificate_requests"."addressee") <= 200 and char_length("certificate_requests"."purpose") <= 120 and char_length("certificate_requests"."decision_note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "certificate_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_opening_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"leave_year" integer NOT NULL,
	"leave_type" "leave_type" NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"as_of" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_opening_balances_person_year_type" UNIQUE("person_id","leave_year","leave_type"),
	CONSTRAINT "leave_opening_balances_half_days" CHECK ("leave_opening_balances"."days" >= 0 and "leave_opening_balances"."days" * 2 = floor("leave_opening_balances"."days" * 2))
);
--> statement-breakpoint
ALTER TABLE "leave_opening_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"from_month" date NOT NULL,
	"to_month" date NOT NULL,
	"issued_on" date NOT NULL,
	"reference" text NOT NULL,
	"content" jsonb NOT NULL,
	"pdf" "bytea" NOT NULL,
	"pdf_sha256" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_statements_reference" UNIQUE("reference"),
	CONSTRAINT "pay_statements_person_range_day" UNIQUE("person_id","from_month","to_month","issued_on"),
	CONSTRAINT "pay_statements_range" CHECK ("pay_statements"."from_month" <= "pay_statements"."to_month")
);
--> statement-breakpoint
ALTER TABLE "pay_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"csv" "bytea" NOT NULL,
	"csv_sha256" text NOT NULL,
	"months" date[] NOT NULL,
	"rows" integer NOT NULL,
	"imported_by" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "payroll_imports_csv_size" CHECK (octet_length("payroll_imports"."csv") between 1 and 1048576)
);
--> statement-breakpoint
ALTER TABLE "payroll_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salary_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"issued_on" date NOT NULL,
	"content" jsonb NOT NULL,
	"pdf" "bytea" NOT NULL,
	"pdf_sha256" text NOT NULL,
	"rule_ids" text[] NOT NULL,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_certificates_request" UNIQUE("request_id"),
	CONSTRAINT "salary_certificates_reference" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "salary_certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "signature_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_images_type" CHECK ("signature_images"."content_type" in ('image/png', 'image/jpeg')),
	CONSTRAINT "signature_images_size" CHECK (octet_length("signature_images"."bytes") between 1 and 512000)
);
--> statement-breakpoint
ALTER TABLE "signature_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_runs" DROP CONSTRAINT "payroll_runs_locked_complete";--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD COLUMN "certificate_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "source" "payroll_run_source" DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "certificate_requests" ADD CONSTRAINT "certificate_requests_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_requests" ADD CONSTRAINT "certificate_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_requests" ADD CONSTRAINT "certificate_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_opening_balances" ADD CONSTRAINT "leave_opening_balances_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_opening_balances" ADD CONSTRAINT "leave_opening_balances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_statements" ADD CONSTRAINT "pay_statements_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_statements" ADD CONSTRAINT "pay_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_imports" ADD CONSTRAINT "payroll_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_imports" ADD CONSTRAINT "payroll_imports_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_certificates" ADD CONSTRAINT "salary_certificates_request_id_certificate_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."certificate_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_certificates" ADD CONSTRAINT "salary_certificates_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_certificates" ADD CONSTRAINT "salary_certificates_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_images" ADD CONSTRAINT "signature_images_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_requests_one_pending" ON "certificate_requests" USING btree ("person_id") WHERE "certificate_requests"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_certificate_id_salary_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."salary_certificates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_import_id_payroll_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."payroll_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_import_matches_source" CHECK (("payroll_runs"."source" = 'imported') = ("payroll_runs"."import_id" is not null));--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_locked_complete" CHECK ("payroll_runs"."status" = 'draft' or ("payroll_runs"."locked_at" is not null and "payroll_runs"."people_count" is not null and "payroll_runs"."gross_ch" is not null
        and "payroll_runs"."health_contribution_ch" is not null and "payroll_runs"."provident_fund_ch" is not null and "payroll_runs"."gis_ch" is not null
        and "payroll_runs"."tds_ch" is not null and "payroll_runs"."recoveries_ch" is not null and "payroll_runs"."take_home_ch" is not null
        and "payroll_runs"."remit_ch" is not null and ("payroll_runs"."due_date" is not null or "payroll_runs"."source" = 'imported') and "payroll_runs"."rule_ids" is not null));--> statement-breakpoint
CREATE POLICY "payroll_snapshots_select_own" ON "payroll_snapshots" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("payroll_snapshots"."person_id" = (select public.current_person_id()));--> statement-breakpoint
CREATE POLICY "certificate_requests_select_own_or_admin" ON "certificate_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("certificate_requests"."person_id" = (select public.current_person_id()) or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "certificate_requests_insert_own" ON "certificate_requests" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("certificate_requests"."person_id" = (select public.current_person_id()) and "certificate_requests"."status" = 'pending' and "certificate_requests"."requested_by" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "certificate_requests_update_own_or_admin" ON "certificate_requests" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("certificate_requests"."person_id" = (select public.current_person_id()) or (select public.is_admin())) WITH CHECK ("certificate_requests"."person_id" = (select public.current_person_id()) or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "leave_opening_balances_select_own_or_admin" ON "leave_opening_balances" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("leave_opening_balances"."person_id" = (select public.current_person_id()) or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "leave_opening_balances_write_admin" ON "leave_opening_balances" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "pay_statements_select_own_or_admin" ON "pay_statements" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("pay_statements"."person_id" = (select public.current_person_id()) or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "pay_statements_insert_own_or_admin" ON "pay_statements" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (("pay_statements"."person_id" = (select public.current_person_id()) or (select public.is_admin())) and "pay_statements"."created_by" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "payroll_imports_admin" ON "payroll_imports" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "salary_certificates_select_own_or_admin" ON "salary_certificates" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("salary_certificates"."person_id" = (select public.current_person_id()) or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "salary_certificates_insert_admin" ON "salary_certificates" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "signature_images_admin" ON "signature_images" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));