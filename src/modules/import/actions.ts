"use server";

import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { claimsFor, requireRole } from "@/lib/auth/session";
import { asUser } from "@/lib/db/client";
import { filings, payrollImports, payrollRuns, payrollSnapshots, people } from "@/lib/db/schema";
import { firstOfMonth, formatMonth } from "@/lib/format";
import { labelNextWrites } from "@/modules/audit/labels";
import { generatePayslips } from "@/modules/documents/issue";
import type { SnapshotPerson } from "@/modules/run/repository";
import { type ImportMonthSummary, type ImportProblem, PAYROLL_IMPORT_MAX_BYTES, checkPayrollImport } from "./payroll-csv";
import { importContext, importRunIds } from "./repository";
import { importedSnapshot } from "./snapshot";

// Bringing in past months: check a file, bring it in whole, or take an import back out. Admins only.
// The file is checked again on import, so what's saved is always what passed.

export type ImportCheckState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "checked"; filename: string; errors: ImportProblem[]; warnings: ImportProblem[]; months: ImportMonthSummary[]; rows: number };

export type ImportDoneState = { status: "done"; importId: string; message: string } | { status: "error"; message: string; check?: ImportCheckState };

async function readFile(formData: FormData): Promise<{ filename: string; bytes: Buffer; text: string } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file first." };
  if (file.size > PAYROLL_IMPORT_MAX_BYTES) return { error: "That file is over 1 MB. A year of payroll for the team is far smaller, so check it’s the right file." };
  const filename = file.name.slice(0, 200) || "payroll.csv";
  if (!/\.csv$/i.test(filename) && file.type !== "text/csv") return { error: "Choose a .csv file. In Excel or Google Sheets, use Save as or Download as CSV." };
  const bytes = Buffer.from(await file.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Older Excel saves CSV in Windows-1252; the template is plain ASCII, so this reads it right.
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return { filename, bytes, text };
}

/** Checks a file and returns everything the preview shows. Saves nothing. */
export async function checkPayrollFile(_previous: ImportCheckState, formData: FormData): Promise<ImportCheckState> {
  const admin = await requireRole("admin");
  const file = await readFile(formData);
  if ("error" in file) return { status: "error", message: file.error };
  const result = checkPayrollImport(file.text, await importContext(admin));
  return { status: "checked", filename: file.filename, errors: result.errors, warnings: result.warnings, months: result.months, rows: result.rows.length };
}

/** Brings the file in, all of it or nothing. Payslips are made afterwards; nobody is emailed. */
export async function importPayrollFile(formData: FormData): Promise<ImportDoneState> {
  const admin = await requireRole("admin");
  const file = await readFile(formData);
  if ("error" in file) return { status: "error", message: file.error };
  const check = checkPayrollImport(file.text, await importContext(admin));
  if (check.errors.length || !check.rows.length) {
    return {
      status: "error",
      message: "The file changed since it was checked. Look at the problems below.",
      check: { status: "checked", filename: file.filename, errors: check.errors, warnings: check.warnings, months: check.months, rows: check.rows.length },
    };
  }

  let importId: string;
  try {
    importId = await asUser(claimsFor(admin), async (tx) => {
      await labelNextWrites(tx, "payroll.imported");
      const [created] = await tx
        .insert(payrollImports)
        .values({
          filename: file.filename,
          csv: file.bytes,
          csvSha256: createHash("sha256").update(file.bytes).digest("hex"),
          months: check.months.map((m) => firstOfMonth(m.month)),
          rows: check.rows.length,
          importedBy: admin.id,
        })
        .returning({ id: payrollImports.id });
      const id = created?.id ?? "";
      const personIds = [...new Set(check.rows.map((row) => row.personId))];
      const records = await tx.select().from(people).where(inArray(people.id, personIds));
      const byId = new Map(records.map((person) => [person.id, person]));

      for (const summary of check.months) {
        const month = firstOfMonth(summary.month);
        const [run] = await tx.insert(payrollRuns).values({ month, source: "imported", importId: id }).returning({ id: payrollRuns.id });
        const runId = run?.id ?? "";
        const rows = check.rows.filter((row) => row.monthKey === summary.monthKey);
        await tx.insert(payrollSnapshots).values(
          rows.map((row) => {
            const person = byId.get(row.personId);
            const { inputs, result } = importedSnapshot(row);
            const snapshotPerson: SnapshotPerson = {
              phone: person?.phone ?? null,
              bankName: person?.bankName ?? null,
              bankAccountCiphertext: person?.bankAccountCiphertext ?? null,
              bankAccountLast4: person?.bankAccountLast4 ?? null,
              tpnCiphertext: person?.tpnCiphertext ?? null,
              tpnLast4: person?.tpnLast4 ?? null,
            };
            return {
              runId,
              personId: row.personId,
              fullName: person?.fullName ?? row.fullName,
              email: person?.email ?? "",
              employmentType: row.employmentType,
              person: snapshotPerson,
              inputs,
              result,
              ruleIds: [],
              grossCh: row.figures.gross,
              healthContributionCh: row.figures.hc,
              providentFundCh: row.figures.pf,
              gisCh: row.figures.gis,
              tdsCh: row.figures.tds,
              recoveriesCh: row.figures.otherDeductions,
              takeHomeCh: row.figures.takeHome,
            };
          }),
        );
        const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((total, row) => total + pick(row), 0);
        await tx
          .update(payrollRuns)
          .set({
            status: "locked",
            peopleCount: rows.length,
            grossCh: sum((r) => r.figures.gross),
            healthContributionCh: sum((r) => r.figures.hc),
            providentFundCh: sum((r) => r.figures.pf),
            gisCh: sum((r) => r.figures.gis),
            tdsCh: sum((r) => r.figures.tds),
            recoveriesCh: sum((r) => r.figures.otherDeductions),
            takeHomeCh: sum((r) => r.figures.takeHome),
            remitCh: sum((r) => r.figures.tds + r.figures.hc),
            ruleIds: [],
          })
          .where(eq(payrollRuns.id, runId));
        // So the month's past filing (date, payment reference, acknowledgement) can be recorded.
        await tx.insert(filings).values({ runId, month });
      }
      return id;
    });
  } catch {
    return { status: "error", message: "We couldn’t bring that in just now. Nothing was saved. Try again in a minute." };
  }

  after(async () => {
    for (const runId of await importRunIds(admin, importId)) {
      try {
        await generatePayslips(runId, admin);
      } catch {
        // A month whose payslips didn't get made shows as such, with Make payslips.
      }
    }
  });
  revalidatePath("/admin", "layout");
  const count = check.months.length;
  const first = check.months[0];
  const last = check.months.at(-1);
  const span = first && last ? (count === 1 ? formatMonth(first.month, { withYear: true }) : `${formatMonth(first.month, { withYear: true })} to ${formatMonth(last.month, { withYear: true })}`) : "";
  return { status: "done", importId, message: `${count === 1 ? "1 month" : `${count} months`} brought in: ${span}.` };
}

export type RemoveImportState = { status: "done"; message: string } | { status: "error"; message: string };

/** Takes an import back out, whole. Only until a month is locked in DashTeam. */
export async function removePayrollImport(importId: string): Promise<RemoveImportState> {
  const admin = await requireRole("admin");
  if (!z.uuid().safeParse(importId).success) return { status: "error", message: "That import couldn’t be found." };
  try {
    await asUser(claimsFor(admin), (tx) => tx.execute(sql`select public.remove_payroll_import(${importId})`));
  } catch (error) {
    const text = String(error);
    if (text.includes("permanent once a month is locked")) return { status: "error", message: "These months are permanent now that a month is locked in DashTeam." };
    if (text.includes("already been emailed")) return { status: "error", message: "Someone has emailed themselves a payslip from these months, so they’re kept." };
    if (text.includes("already been removed")) return { status: "done", message: "Those months were already taken out." };
    return { status: "error", message: "We couldn’t take that out just now. Try again in a minute." };
  }
  revalidatePath("/admin", "layout");
  return { status: "done", message: "Those months are taken out. Bring in a corrected file whenever you’re ready." };
}

/** Undo for taking an import out: brings the same file back in, exactly as it was kept. */
export async function restorePayrollImport(importId: string): Promise<ImportDoneState> {
  const admin = await requireRole("admin");
  if (!z.uuid().safeParse(importId).success) return { status: "error", message: "That import couldn’t be found." };
  const [kept] = await asUser(claimsFor(admin), (tx) => tx.select({ filename: payrollImports.filename, csv: payrollImports.csv }).from(payrollImports).where(eq(payrollImports.id, importId)).limit(1));
  if (!kept) return { status: "error", message: "That import couldn’t be found." };
  const formData = new FormData();
  formData.set("file", new File([new Uint8Array(kept.csv)], kept.filename, { type: "text/csv" }));
  return importPayrollFile(formData);
}
