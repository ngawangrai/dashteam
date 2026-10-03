CREATE TYPE "public"."payroll_line_kind" AS ENUM('arrear', 'bonus', 'other_earning', 'leave_recovery', 'advance_recovery', 'other_deduction');--> statement-breakpoint
CREATE TYPE "public"."payroll_line_source" AS ENUM('manual', 'exit_settlement', 'correction');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'locked');--> statement-breakpoint
ALTER TYPE "public"."rule_key" ADD VALUE 'payroll_settings';--> statement-breakpoint
CREATE TABLE "payroll_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"check_key" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_acknowledgements_month_check" UNIQUE("month","check_key"),
	CONSTRAINT "payroll_acknowledgements_first_of_month" CHECK (extract(day from "payroll_acknowledgements"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "payroll_acknowledgements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "payroll_line_kind" NOT NULL,
	"amount_ch" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" "payroll_line_source" DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_lines_first_of_month" CHECK (extract(day from "payroll_lines"."month") = 1),
	CONSTRAINT "payroll_lines_amount_positive" CHECK ("payroll_lines"."amount_ch" > 0)
);
--> statement-breakpoint
ALTER TABLE "payroll_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"status" "payroll_run_status" DEFAULT 'draft' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"people_count" integer,
	"gross_ch" bigint,
	"health_contribution_ch" bigint,
	"provident_fund_ch" bigint,
	"gis_ch" bigint,
	"tds_ch" bigint,
	"recoveries_ch" bigint,
	"take_home_ch" bigint,
	"remit_ch" bigint,
	"due_date" date,
	"rule_ids" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_month" UNIQUE("month"),
	CONSTRAINT "payroll_runs_first_of_month" CHECK (extract(day from "payroll_runs"."month") = 1),
	CONSTRAINT "payroll_runs_locked_complete" CHECK ("payroll_runs"."status" = 'draft' or ("payroll_runs"."locked_at" is not null and "payroll_runs"."people_count" is not null and "payroll_runs"."gross_ch" is not null
        and "payroll_runs"."health_contribution_ch" is not null and "payroll_runs"."provident_fund_ch" is not null and "payroll_runs"."gis_ch" is not null
        and "payroll_runs"."tds_ch" is not null and "payroll_runs"."recoveries_ch" is not null and "payroll_runs"."take_home_ch" is not null
        and "payroll_runs"."remit_ch" is not null and "payroll_runs"."due_date" is not null and "payroll_runs"."rule_ids" is not null))
);
--> statement-breakpoint
ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"employment_type" "employment_type" NOT NULL,
	"person" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"rule_ids" text[] NOT NULL,
	"gross_ch" bigint NOT NULL,
	"health_contribution_ch" bigint NOT NULL,
	"provident_fund_ch" bigint NOT NULL,
	"gis_ch" bigint NOT NULL,
	"tds_ch" bigint NOT NULL,
	"recoveries_ch" bigint NOT NULL,
	"take_home_ch" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_snapshots_run_person" UNIQUE("run_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "payroll_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_acknowledgements" ADD CONSTRAINT "payroll_acknowledgements_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_snapshots" ADD CONSTRAINT "payroll_snapshots_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_snapshots" ADD CONSTRAINT "payroll_snapshots_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_lines_month" ON "payroll_lines" USING btree ("month");--> statement-breakpoint
CREATE POLICY "payroll_acknowledgements_admin" ON "payroll_acknowledgements" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "payroll_lines_admin" ON "payroll_lines" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "payroll_runs_admin" ON "payroll_runs" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "payroll_snapshots_admin" ON "payroll_snapshots" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));