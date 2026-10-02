import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/button-link";
import { InsetRow, InsetSection } from "@/components/inset-section";
import { LinkRow } from "@/components/link-row";
import { MaskedValue } from "@/components/masked-value";
import { Money } from "@/components/money";
import { Page } from "@/components/page";
import { PayRows } from "@/components/people/pay-rows";
import { RequestCard } from "@/components/people/request-card";
import { requireRole } from "@/lib/auth/session";
import { formatDate, formatMonth, formatPhone, monthOf } from "@/lib/format";
import { takeHomeFor } from "@/modules/people/estimate";
import { EMPLOYMENT_TYPE_LABEL } from "@/modules/people/labels";
import { getPersonDetail, rulesForMonth } from "@/modules/people/repository";

type Params = { params: Promise<{ id: string }> };

export const metadata = { title: "Person" };

export default async function PersonPage({ params }: Params) {
  const user = await requireRole("admin");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getPersonDetail(user, id);
  if (!detail) notFound();

  const { person, current, upcoming, pendingRequest } = detail;
  const rules = await rulesForMonth(user);
  const takeHome = current && rules ? takeHomeFor(current, rules) : null;
  const type = (current ?? upcoming)?.employmentType;
  const subtitle = person.isCurrent
    ? [type ? EMPLOYMENT_TYPE_LABEL[type] : null, `since ${formatDate(person.startDate)}`].filter(Boolean).join(" · ")
    : `Left on ${formatDate(person.endDate ?? "")}`;

  return (
    <Page
      title={person.fullName}
      subtitle={subtitle}
      back={{ href: "/admin/people", label: "People" }}
      action={<ButtonLink href={`/admin/people/${person.id}/edit`}>Edit details</ButtonLink>}
    >
      {pendingRequest ? (
        <InsetSection title="Needs you">
          <RequestCard request={pendingRequest} showName={false} />
        </InsetSection>
      ) : null}

      <InsetSection title="Pay">
        {current ? (
          <>
            <PayRows terms={current} />
            {takeHome !== null ? (
              <InsetRow label="Take-home about">
                <Money amount={takeHome} className="font-semibold text-label" />
              </InsetRow>
            ) : null}
          </>
        ) : (
          <p className="px-4 py-3 text-body text-label-secondary">Their pay starts when they join.</p>
        )}
        {upcoming ? (
          <InsetRow label={`From ${formatMonth(monthOf(upcoming.effectiveFrom), { withYear: true })}`}>
            <Money
              amount={upcoming.employmentType === "intern" ? upcoming.stipend : upcoming.basic + upcoming.allowances}
              className="text-label"
            />
          </InsetRow>
        ) : null}
        {person.isCurrent ? <LinkRow href={`/admin/people/${person.id}/pay`} title="Change pay" /> : null}
      </InsetSection>

      <InsetSection title="Bank and tax">
        <InsetRow label="Bank">{person.bankName ?? "Not added"}</InsetRow>
        <InsetRow label="Account">
          <MaskedValue personId={person.id} field="bank_account" last4={person.bankAccountLast4} label="account number" />
        </InsetRow>
        <InsetRow label="TPN">
          <MaskedValue personId={person.id} field="tpn" last4={person.tpnLast4} label="TPN" />
        </InsetRow>
      </InsetSection>

      <InsetSection title="Contact">
        <InsetRow label="Email">
          <span className="break-all">{person.email}</span>
        </InsetRow>
        <InsetRow label="Phone">
          <span className="tabular">{person.phone ? formatPhone(person.phone) : "Not added"}</span>
        </InsetRow>
      </InsetSection>

      {person.isCurrent ? (
        <div className="flex justify-center">
          <ButtonLink href={`/admin/people/${person.id}/exit`} variant="plain" className="text-danger">
            Mark as left
          </ButtonLink>
        </div>
      ) : null}
    </Page>
  );
}
