import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/button-link";
import { InsetRow, InsetSection } from "@/components/inset-section";
import { LinkRow } from "@/components/link-row";
import { MaskedValue } from "@/components/masked-value";
import { Money } from "@/components/money";
import { Page } from "@/components/page";
import { PayslipList } from "@/components/documents/payslip-list";
import { PayRows } from "@/components/people/pay-rows";
import { RequestCard } from "@/components/people/request-card";
import { BalanceSummary } from "@/components/leave/balance-summary";
import { ExitLeaveSettlement } from "@/components/leave/exit-settlement";
import { LeaveList } from "@/components/leave/leave-list";
import { RequestLeaveSheet } from "@/components/leave/request-sheet";
import { firstNameFrom } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { lockedRange } from "@/modules/run/repository";
import { enterLeaveFor } from "@/modules/leave/actions";
import { balancesFor, exitLeaveFor, loadLeaveContext, sheetContextFor } from "@/modules/leave/repository";
import { formatDate, formatMonth, formatPhone, monthOf, thimphuToday } from "@/lib/format";
import { payslipsFor } from "@/modules/documents/repository";
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
  const [rules, leave, exit, payslips] = await Promise.all([rulesForMonth(user), loadLeaveContext(user, person.id), exitLeaveFor(user, person.id), payslipsFor(user, person.id)]);
  const today = thimphuToday();
  const sheet = leave ? sheetContextFor(leave, await lockedRange(user)) : null;
  const firstName = firstNameFrom(person.fullName, person.email);
  const recentLeave = leave ? [...leave.requests].reverse().slice(0, 5) : [];
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

      {exit.state !== "none" ? (
        <ExitLeaveSettlement
          personId={person.id}
          firstName={firstName}
          settlement={exit.settlement}
          decided={exit.state === "decided" ? { status: exit.decision.status, finalCh: exit.decision.finalCh } : null}
        />
      ) : null}

      {leave && leave.employmentType ? (
        <>
          <BalanceSummary lines={balancesFor(leave, Number(today.slice(0, 4)))} title="Leave" />
          {recentLeave.length ? (
            <InsetSection title="Recent leave">
              <LeaveList requests={recentLeave} today={today} canCancelStarted />
            </InsetSection>
          ) : null}
          {sheet && person.isCurrent ? (
            <div className="flex justify-center">
              <RequestLeaveSheet
                context={{ ...sheet, today }}
                action={enterLeaveFor.bind(null, person.id)}
                forName={firstName}
                triggerLabel={`Add leave for ${firstName}`}
                triggerVariant="plain"
              />
            </div>
          ) : null}
        </>
      ) : null}

      {payslips.length ? <PayslipList payslips={payslips} mode="admin" personName={person.fullName} title="Payslips" /> : null}

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
