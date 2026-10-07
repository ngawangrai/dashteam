import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { claimsFor, type SessionUser } from "@/lib/auth/session";
import { decryptField } from "@/lib/crypto/field";
import { asUser } from "@/lib/db/client";
import { filings, it1aSchedules, payrollRuns, payrollSnapshots, rules } from "@/lib/db/schema";
import { monthOf } from "@/lib/format";
import { labelNextWrites } from "@/modules/audit/labels";
import { lockedRunId } from "@/modules/documents/issue";
import type { PayslipSnapshot } from "@/modules/documents/model";
import { resolveRules } from "@/modules/rules/resolve";
import type { PayrollMonth } from "@/modules/rules/types";
import { toRuleRow } from "@/modules/rules/rows";
import type { SnapshotPerson } from "@/modules/run/repository";
import { ReconciliationError, type ScheduleRow, scheduleRows, scheduleTotals } from "./schedule";
import { fillIt1aTemplate } from "./template";

// Making a locked month's IT-1(a) schedule: once, from its snapshots, after the lock has committed.
// It never runs inside the lock, so nothing here can fail or undo a lock. A schedule that doesn't
// reconcile to the snapshot is never written; the filing screen says so and offers to try again.

export type MakeScheduleResult = { status: "made" | "already" } | { status: "not_locked" } | { status: "mismatch"; message: string };

/** The schedule's rows for the screens: everything but the TPN, which shows only its last 4. */
const forScreens = (rows: ScheduleRow[]) => rows.map((row) => ({ ...row, tpn: row.tpn ? `••••${row.tpn.slice(-4)}` : "" }));

export async function makeSchedule(runId: string, actor: SessionUser): Promise<MakeScheduleResult> {
  const data = await asUser(claimsFor(actor), async (tx) => {
    const [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "locked"))).limit(1);
    if (!run) return null;
    const [existing] = await tx.select({ id: it1aSchedules.id }).from(it1aSchedules).where(eq(it1aSchedules.runId, runId)).limit(1);
    const snapshots = await tx.select().from(payrollSnapshots).where(eq(payrollSnapshots.runId, runId)).orderBy(asc(payrollSnapshots.fullName));
    const ruleRows = (await tx.select().from(rules)).map(toRuleRow);
    return { run, existing: Boolean(existing), snapshots, ruleRows };
  });
  if (!data) return { status: "not_locked" };
  if (data.existing) return { status: "already" };

  const month = monthOf(data.run.month);
  let rows: ScheduleRow[];
  try {
    rows = scheduleRows(
      data.snapshots.map((snapshot) => {
        const person = snapshot.person as SnapshotPerson;
        return {
          personId: snapshot.personId,
          month,
          fullName: snapshot.fullName,
          employmentType: snapshot.employmentType,
          person: { tpnLast4: person.tpnLast4 },
          inputs: snapshot.inputs as PayslipSnapshot["inputs"],
          result: snapshot.result as PayslipSnapshot["result"],
          // The TPN as it was at lock: the snapshot keeps the ciphertext, bound to the person and field.
          tpn: person.tpnCiphertext ? decryptField(person.tpnCiphertext, { personId: snapshot.personId, field: "tpn" }) : null,
        };
      }),
      {
        // The rules in force for the month: dated and unchangeable once it's locked, so these are the
        // very rules pay was worked out with.
        proration: (type) => resolveRules(data.ruleRows, type, month).proration,
        included: (type) => resolveRules(data.ruleRows, type, month).it1aInclusion.include,
      },
    );
  } catch (error) {
    if (error instanceof ReconciliationError) return { status: "mismatch", message: error.message };
    throw error;
  }

  const xls = fillIt1aTemplate(rows);
  await asUser(claimsFor(actor), async (tx) => {
    await labelNextWrites(tx, "filing.schedule_made");
    await tx
      .insert(it1aSchedules)
      .values({
        runId,
        month: data.run.month,
        rows: forScreens(rows),
        totals: scheduleTotals(rows),
        xls,
        xlsSha256: createHash("sha256").update(xls).digest("hex"),
        generatedBy: actor.id,
      })
      .onConflictDoNothing({ target: it1aSchedules.runId });
    await tx.insert(filings).values({ runId, month: data.run.month }).onConflictDoNothing({ target: filings.runId });
  });
  return { status: "made" };
}

/** makeSchedule for a locked month, by month. Never throws: it runs in the background after a lock. */
export async function makeScheduleForMonth(month: PayrollMonth, actor: SessionUser): Promise<void> {
  try {
    const runId = await lockedRunId(month, actor);
    if (runId) await makeSchedule(runId, actor);
  } catch {
    // The filing screen shows a month with no schedule yet, with a way to make it.
  }
}
