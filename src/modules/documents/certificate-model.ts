import { formatLongDate, formatNu } from "@/lib/format";
import { type PayTerms, monthlyPayOf } from "@/modules/people/pay";
import type { CompanyDetails } from "@/modules/rules/types";

// A salary certificate: a one-page company letter confirming who someone is to Xceed and what they're
// paid now. Pure: the person, the pay record in force on the issue date and the signatory in, the
// letter out. It's stored once when issued, so a later raise never changes it.

export type CertificateInput = {
  person: { name: string; jobTitle: string; startDate: string };
  /** The pay record in force on the issue date. */
  terms: PayTerms;
  addressee: string;
  purpose: string;
  signatory: { name: string; title: string };
  company: CompanyDetails;
  reference: string;
  issuedOn: string;
};

export type CertificateModel = {
  company: { name: string; addressLines: string[]; showLogo: boolean };
  reference: string;
  issuedOn: string;
  addressee: string[];
  subject: string;
  paragraphs: string[];
  signOff: string;
  signatory: { name: string; title: string };
  person: { name: string; jobTitle: string; employmentType: PayTerms["employmentType"] };
  /** The pay as stated, so the app can show it without reading the letter. */
  monthlyPay: number;
  payEffectiveFrom: string;
};

/** XS-SC-2026-004: the year it was issued, then its place among that year's certificates. */
export function certificateReference(year: number, position: number): string {
  return `XS-SC-${year}-${String(position).padStart(3, "0")}`;
}

const possessive = (name: string) => `${name}’s`;

/** A date or an amount never splits across lines in the letter ("3 / March 2025", "Nu. / 45,000"). */
const whole = (text: string) => text.replace(/ /g, "\u00a0");
const money = (amount: number) => whole(formatNu(amount));

/** "a home loan", "For a home loan." and "for a home loan" all read the same in the letter. */
export function purposePhrase(purpose: string): string {
  return purpose
    .trim()
    .replace(/[.\s]+$/, "")
    .replace(/^for\s+/i, "");
}

export function payStatement(name: string, terms: PayTerms): string {
  if (terms.employmentType === "intern") return `${possessive(name)} current monthly stipend is ${money(terms.stipend)}.`;
  const total = money(monthlyPayOf(terms));
  if (!terms.allowances) return `${possessive(name)} current monthly salary is ${total}.`;
  return `${possessive(name)} current monthly salary is ${total}: basic pay of ${money(terms.basic)} and allowances of ${money(terms.allowances)}.`;
}

export function certificateModel(input: CertificateInput): CertificateModel {
  const { person, terms, company } = input;
  const since = whole(formatLongDate(person.startDate));
  const employed =
    terms.employmentType === "intern"
      ? `This is to certify that ${person.name} has been an intern with ${company.name} since ${since}.`
      : `This is to certify that ${person.name} has been employed full-time with ${company.name} since ${since}.`;
  const purpose = purposePhrase(input.purpose);
  const request = purpose ? `This certificate is issued at ${possessive(person.name)} request for ${purpose}.` : `This certificate is issued at the request of ${person.name}.`;
  const addressee = input.addressee
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    company: { name: company.name, addressLines: company.addressLines, showLogo: company.showLogo },
    reference: input.reference,
    issuedOn: formatLongDate(input.issuedOn),
    addressee: addressee.length ? addressee : ["To whom it may concern"],
    subject: "Salary certificate",
    paragraphs: [`${employed} ${possessive(person.name)} current designation is ${person.jobTitle.trim()}.`, payStatement(person.name, terms), request],
    signOff: `For ${company.name}`,
    signatory: { name: input.signatory.name, title: input.signatory.title },
    person: { name: person.name, jobTitle: person.jobTitle.trim(), employmentType: terms.employmentType },
    monthlyPay: monthlyPayOf(terms),
    payEffectiveFrom: terms.effectiveFrom,
  };
}
