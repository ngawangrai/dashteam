ALTER TYPE "public"."rule_key" ADD VALUE 'filing_settings';--> statement-breakpoint
CREATE TABLE "filing_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filing_receipts_type" CHECK ("filing_receipts"."content_type" in ('application/pdf', 'image/png', 'image/jpeg')),
	CONSTRAINT "filing_receipts_size" CHECK (octet_length("filing_receipts"."bytes") between 1 and 5242880)
);
--> statement-breakpoint
ALTER TABLE "filing_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "filing_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sent_on" date NOT NULL,
	"months" jsonb NOT NULL,
	"recipients" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filing_reminders_sent_on" UNIQUE("sent_on")
);
--> statement-breakpoint
ALTER TABLE "filing_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"month" date NOT NULL,
	"filed_on" date,
	"payment_reference" text,
	"acknowledgement_number" text,
	"receipt_id" uuid,
	"entered" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "filings_run" UNIQUE("run_id"),
	CONSTRAINT "filings_filed_complete" CHECK ("filings"."filed_on" is null or ("filings"."payment_reference" is not null and ("filings"."acknowledgement_number" is not null or "filings"."receipt_id" is not null)))
);
--> statement-breakpoint
ALTER TABLE "filings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "it1a_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"month" date NOT NULL,
	"rows" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"xls" "bytea" NOT NULL,
	"xls_sha256" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" uuid,
	CONSTRAINT "it1a_schedules_run" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "it1a_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "filing_receipts" ADD CONSTRAINT "filing_receipts_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_receipts" ADD CONSTRAINT "filing_receipts_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_receipt_id_filing_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."filing_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it1a_schedules" ADD CONSTRAINT "it1a_schedules_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "it1a_schedules" ADD CONSTRAINT "it1a_schedules_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "filing_receipts_admin" ON "filing_receipts" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "filing_reminders_admin" ON "filing_reminders" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "filings_admin" ON "filings" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "it1a_schedules_admin" ON "it1a_schedules" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));