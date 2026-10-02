CREATE TYPE "public"."change_request_status" AS ENUM('pending', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_table" text NOT NULL,
	"entity_id" uuid,
	"transaction_id" bigint NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"employment_type" "employment_type" NOT NULL,
	"basic_ch" bigint,
	"allowances_ch" bigint,
	"stipend_ch" bigint,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "pay_records_person_effective_from" UNIQUE("person_id","effective_from"),
	CONSTRAINT "pay_records_first_of_month" CHECK (extract(day from "pay_records"."effective_from") = 1),
	CONSTRAINT "pay_records_fields_match_type" CHECK (("pay_records"."employment_type" = 'full_time' and "pay_records"."basic_ch" is not null and "pay_records"."allowances_ch" is not null and "pay_records"."stipend_ch" is null)
       or ("pay_records"."employment_type" = 'intern' and "pay_records"."stipend_ch" is not null and "pay_records"."basic_ch" is null and "pay_records"."allowances_ch" is null)),
	CONSTRAINT "pay_records_not_negative" CHECK (coalesce("pay_records"."basic_ch", 0) >= 0 and coalesce("pay_records"."allowances_ch", 0) >= 0 and coalesce("pay_records"."stipend_ch", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "pay_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"bank_name" text,
	"bank_account_ciphertext" text,
	"bank_account_last4" text,
	"tpn_ciphertext" text,
	"tpn_last4" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_profile_id_unique" UNIQUE("profile_id"),
	CONSTRAINT "people_email_lowercase" CHECK ("people"."email" = lower("people"."email")),
	CONSTRAINT "people_end_after_start" CHECK ("people"."end_date" is null or "people"."end_date" >= "people"."start_date"),
	CONSTRAINT "people_bank_account_pair" CHECK (("people"."bank_account_ciphertext" is null) = ("people"."bank_account_last4" is null)),
	CONSTRAINT "people_tpn_pair" CHECK (("people"."tpn_ciphertext" is null) = ("people"."tpn_last4" is null))
);
--> statement-breakpoint
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"requested_by" uuid,
	"phone" text,
	"bank_name" text,
	"bank_account_ciphertext" text,
	"bank_account_last4" text,
	"status" "change_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_change_requests_something_changes" CHECK ("profile_change_requests"."phone" is not null or "profile_change_requests"."bank_name" is not null or "profile_change_requests"."bank_account_ciphertext" is not null),
	CONSTRAINT "profile_change_requests_bank_account_pair" CHECK (("profile_change_requests"."bank_account_ciphertext" is null) = ("profile_change_requests"."bank_account_last4" is null))
);
--> statement-breakpoint
ALTER TABLE "profile_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_records" ADD CONSTRAINT "pay_records_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_records" ADD CONSTRAINT "pay_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_transaction" ON "audit_log" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity" ON "audit_log" USING btree ("entity_table","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_unique" ON "people" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "profile_change_requests_one_pending" ON "profile_change_requests" USING btree ("person_id") WHERE "profile_change_requests"."status" = 'pending';--> statement-breakpoint
CREATE POLICY "audit_log_select_admin" ON "audit_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "pay_records_select_own_or_admin" ON "pay_records" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("pay_records"."person_id" = (select public.current_person_id()) or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "pay_records_insert_admin" ON "pay_records" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "pay_records_delete_admin" ON "pay_records" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "people_select_own_or_admin" ON "people" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("people"."id" = (select public.current_person_id()) or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "people_insert_admin" ON "people" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "people_update_admin" ON "people" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));--> statement-breakpoint
CREATE POLICY "profile_change_requests_select_own_or_admin" ON "profile_change_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("profile_change_requests"."person_id" = (select public.current_person_id()) or (select public.is_admin()));--> statement-breakpoint
CREATE POLICY "profile_change_requests_insert_own" ON "profile_change_requests" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("profile_change_requests"."person_id" = (select public.current_person_id()) and "profile_change_requests"."status" = 'pending' and "profile_change_requests"."requested_by" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profile_change_requests_update_own_or_admin" ON "profile_change_requests" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("profile_change_requests"."person_id" = (select public.current_person_id()) or (select public.is_admin())) WITH CHECK ("profile_change_requests"."person_id" = (select public.current_person_id()) or (select public.is_admin()));