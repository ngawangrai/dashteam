import type { Chhertum } from "@/modules/rules/types";

// The list the admin uploads or keys into the bank to pay a locked month. Built from the snapshot,
// so it always matches what was locked. Amounts are plain numbers (no grouping) so banks can read them.

export type BankListRow = { name: string; bank: string | null; account: string | null; takeHome: Chhertum };

const CH_PER_NU = 100;

function cell(value: string): string {
  // A cell starting with = + - or @ is a formula to a spreadsheet; a leading quote keeps it text.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const amount = (chhertum: Chhertum) => `${Math.floor(chhertum / CH_PER_NU)}.${String(chhertum % CH_PER_NU).padStart(2, "0")}`;

export function bankListCsv(rows: readonly BankListRow[]): string {
  const lines = [
    ["Name", "Bank", "Account number", "Amount (Nu.)"],
    ...rows.map((row) => [row.name, row.bank ?? "", row.account ?? "", amount(row.takeHome)]),
  ];
  return lines.map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
}
