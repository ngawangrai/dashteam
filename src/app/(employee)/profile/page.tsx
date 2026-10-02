import { InsetRow, InsetSection } from "@/components/inset-section";
import { MaskedValue } from "@/components/masked-value";
import { Page } from "@/components/page";
import { PayRows } from "@/components/people/pay-rows";
import { RequestChange, WithdrawRequest } from "@/components/people/request-change";
import { SignOutButton } from "@/components/sign-out-button";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatPhone, maskedLast4, thimphuToday } from "@/lib/format";
import { EMPLOYMENT_TYPE_LABEL } from "@/modules/people/labels";
import { getOwnProfile } from "@/modules/people/repository";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await getOwnProfile(user);

  // An admin who isn't on payroll has a login but no staff record.
  if (!profile) {
    return (
      <Page title="Profile">
        <InsetSection footer="You don’t have a staff record. To get payslips here, add yourself under People.">
          <InsetRow label="Email">
            <span className="break-all">{user.email}</span>
          </InsetRow>
        </InsetSection>
        <div className="flex justify-center md:hidden">
          <SignOutButton />
        </div>
      </Page>
    );
  }

  const { person, current, pendingRequest } = profile;
  const pending = pendingRequest;

  return (
    <Page
      title={person.fullName}
      subtitle={[current ? EMPLOYMENT_TYPE_LABEL[current.employmentType] : null, `since ${formatDate(person.startDate)}`]
        .filter(Boolean)
        .join(" · ")}
    >
      {pending ? (
        <InsetSection
          title="Waiting for approval"
          footer={`Sent ${formatDate(thimphuToday(pending.createdAt))}. Your admin will approve or decline it.`}
        >
          {pending.phone ? <InsetRow label="New phone">{formatPhone(pending.phone.to)}</InsetRow> : null}
          {pending.bank ? (
            <InsetRow label="New bank">
              {[pending.bank.to.name, pending.bank.to.last4 ? maskedLast4(pending.bank.to.last4) : null].filter(Boolean).join(" ")}
            </InsetRow>
          ) : null}
          <div className="flex justify-end px-2">
            <WithdrawRequest requestId={pending.id} />
          </div>
        </InsetSection>
      ) : null}

      <InsetSection title="Contact">
        <InsetRow label="Email">
          <span className="break-all">{person.email}</span>
        </InsetRow>
        <InsetRow label="Phone">
          <span className="tabular">{person.phone ? formatPhone(person.phone) : "Not added"}</span>
        </InsetRow>
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

      {current ? (
        <InsetSection title="Pay">
          <PayRows terms={current} />
        </InsetSection>
      ) : null}

      {pending ? null : (
        <RequestChange current={{ phone: person.phone, bankName: person.bankName, bankAccountLast4: person.bankAccountLast4 }} />
      )}

      <div className="flex justify-center md:hidden">
        <SignOutButton />
      </div>
    </Page>
  );
}
