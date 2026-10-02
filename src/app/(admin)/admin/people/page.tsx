import { Users } from "lucide-react";
import { ButtonLink } from "@/components/button-link";
import { EmptyState } from "@/components/empty-state";
import { InsetSection } from "@/components/inset-section";
import { LinkRow } from "@/components/link-row";
import { Page } from "@/components/page";
import { requireRole } from "@/lib/auth/session";
import { formatDate, thimphuToday } from "@/lib/format";
import { EMPLOYMENT_TYPE_LABEL } from "@/modules/people/labels";
import { type PersonListItem, listPeople } from "@/modules/people/repository";

export const metadata = { title: "People" };

function currentDetail(person: PersonListItem, today: string) {
  const type = person.employmentType ? EMPLOYMENT_TYPE_LABEL[person.employmentType] : null;
  const when = person.startDate > today ? `starts ${formatDate(person.startDate)}` : `since ${formatDate(person.startDate)}`;
  return [type, when].filter(Boolean).join(" · ");
}

export default async function PeoplePage() {
  const user = await requireRole("admin");
  const everyone = await listPeople(user);
  const today = thimphuToday();
  const current = everyone.filter((person) => person.isCurrent);
  const former = everyone.filter((person) => !person.isCurrent);

  return (
    <Page title="People" action={<ButtonLink href="/admin/people/new">Add person</ButtonLink>}>
      {everyone.length === 0 ? (
        <InsetSection>
          <EmptyState icon={Users} title="No one here yet" message="Add your first person to set up their pay and sign-in." />
        </InsetSection>
      ) : (
        <>
          <InsetSection title="Current">
            {current.length ? (
              current.map((person) => (
                <LinkRow key={person.id} href={`/admin/people/${person.id}`} title={person.fullName} detail={currentDetail(person, today)} />
              ))
            ) : (
              <p className="px-4 py-3 text-body text-label-secondary">No one is working here right now.</p>
            )}
          </InsetSection>
          {former.length ? (
            <InsetSection title="Former">
              {former.map((person) => (
                <LinkRow
                  key={person.id}
                  href={`/admin/people/${person.id}`}
                  title={person.fullName}
                  detail={person.endDate ? `Left ${formatDate(person.endDate)}` : undefined}
                />
              ))}
            </InsetSection>
          ) : null}
        </>
      )}
    </Page>
  );
}
