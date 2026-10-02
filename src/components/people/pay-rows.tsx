import { InsetRow } from "@/components/inset-section";
import { Money } from "@/components/money";
import type { PayTerms } from "@/modules/people/pay";

/** Basic and allowance, or stipend, as rows. */
export function PayRows({ terms }: { terms: PayTerms }) {
  return terms.employmentType === "intern" ? (
    <InsetRow label="Stipend">
      <Money amount={terms.stipend} className="text-label" />
    </InsetRow>
  ) : (
    <>
      <InsetRow label="Basic">
        <Money amount={terms.basic} className="text-label" />
      </InsetRow>
      <InsetRow label="Allowance">
        <Money amount={terms.allowances} className="text-label" />
      </InsetRow>
    </>
  );
}
