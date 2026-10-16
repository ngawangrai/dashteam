import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { asUser, type Tx } from "@/lib/db/client";
import { payStatements, payrollSnapshots, payslips, people } from "@/lib/db/schema";
import { firstOfMonth, monthOf, thimphuToday } from "@/lib/format";
import { labelNextWrites } from "@/modules/audit/labels";
import { resolveCompanyDetails } from "@/modules/rules/resolve";
import { loadRuleRows } from "@/modules/rules/repository";
import type { Chhertum, EmploymentType, PayrollMonth } from "@/modules/rules/types";
import { isImportedInputs } from "./model";
import { renderStatement } from "./render";
import { type StatementModel, type StatementRange, type StatementSnapshot, statementModel, statementReference } from "./statement-model";

// Pay statements: a person's locked months across a range, read from their snapshots as the signed-in
// person (RLS: their own, or anyone's for an admin), made into a PDF once and stored.

export type PaidMonth = { monthKey: string; gross: Chhertum; takeHome: Chhertum; imported: boolean; employmentType: EmploymentType };

/** Every locked month a person was paid in, oldest first, with the figures a statement prints. */
async function paidMonths(tx: Tx, personId: string): Promise<(StatementSnapshot & { monthKey: string })[]> {
  // Snapshots carry no month; their payslip does, and both are written for every locked month.
  const rows = await tx
    .select({ month: payslips.month, employmentType: payrollSnapshots.employmentType, gross: payrollSnapshots.grossCh, takeHome: payrollSnapshots.takeHomeCh, inputs: payrollSnapshots.inputs })
    .from(payrollSnapshots)
    .innerJoin(payslips, eq(payslips.snapshotId, payrollSnapshots.id))
    .where(eq(payrollSnapshots.personId, personId))
    .orderBy(asc(payslips.month));
  return rows.map((row) => ({
    month: monthOf(row.month),
    monthKey: row.month.slice(0, 7),
    employmentType: row.employmentType,
    gross: row.gross,
    takeHome: row.takeHome,
    imported: isImportedInputs(row.inputs),
  }));
}

/** The months a statement can cover, for the statement sheet. */
export async function statementMonthsFor(user: SessionUser, personId: string): Promise<PaidMonth[]> {
  const months = await asUser(claimsFor(user), (tx) => paidMonths(tx, personId));
  return months.map(({ monthKey, gross, takeHome, imported, employmentType }) => ({ monthKey, gross, takeHome, imported, employmentType }));
}

export type MadeStatement = { status: "made"; id: string; model: StatementModel } | { status: "nothing_paid" } | { status: "not_found" };

const index = ({ year, month }: PayrollMonth) => year * 12 + month - 1;

/**
 * Makes the statement for a range, or returns the one already made for that range today. Locked
 * months never change, so the same range on the same day is always the same document.
 */
export async function makeStatement(user: SessionUser, personId: string, range: StatementRange): Promise<MadeStatement> {
  const ruleRows = await loadRuleRows(claimsFor(user));
  const issuedOn = thimphuToday();
  const company = resolveCompanyDetails(ruleRows, monthOf(issuedOn));
  return asUser(claimsFor(user), async (tx) => {
    const [person] = await tx.select({ fullName: people.fullName, tpnLast4: people.tpnLast4 }).from(people).where(eq(people.id, personId)).limit(1);
    if (!person) return { status: "not_found" };
    const snapshots = (await paidMonths(tx, personId)).filter((s) => index(s.month) >= index(range.from) && index(s.month) <= index(range.to));
    if (!snapshots.length) return { status: "nothing_paid" };

    const where = and(
      eq(payStatements.personId, personId),
      eq(payStatements.fromMonth, firstOfMonth(range.from)),
      eq(payStatements.toMonth, firstOfMonth(range.to)),
      eq(payStatements.issuedOn, issuedOn),
    );
    const [existing] = await tx.select({ id: payStatements.id, content: payStatements.content }).from(payStatements).where(where).limit(1);
    if (existing) return { status: "made", id: existing.id, model: existing.content as StatementModel };

    const [numbered] = await tx.execute<{ position: number }>(sql`select public.next_document_number('statement') as position`);
    const reference = statementReference(Number(issuedOn.slice(0, 4)), Number(numbered?.position ?? 1));
    const model = statementModel({ person: { name: person.fullName, tpnLast4: person.tpnLast4 }, range, snapshots, company, reference, issuedOn });
    const { pdf, sha256 } = await renderStatement(model);
    await labelNextWrites(tx, "statement.generated");
    const [row] = await tx
      .insert(payStatements)
      .values({ personId, fromMonth: firstOfMonth(range.from), toMonth: firstOfMonth(range.to), issuedOn, reference, content: model, pdf, pdfSha256: sha256, createdBy: user.id })
      .returning({ id: payStatements.id });
    return { status: "made", id: row?.id ?? "", model };
  });
}

/** For the file route: the stored PDF and what to call it, if the signed-in person may see it. */
export async function statementFile(user: SessionUser, id: string): Promise<{ pdf: Buffer; filename: string } | null> {
  return asUser(claimsFor(user), async (tx) => {
    const [row] = await tx.select({ pdf: payStatements.pdf, content: payStatements.content }).from(payStatements).where(eq(payStatements.id, id)).limit(1);
    if (!row) return null;
    await tx.execute(sql`select public.record_document_download('statement', ${id})`);
    const model = row.content as StatementModel;
    const who = user.role === "admin" ? `, ${model.person.name}` : "";
    return { pdf: row.pdf, filename: `Pay statement ${model.period}${who}.pdf` };
  });
}
