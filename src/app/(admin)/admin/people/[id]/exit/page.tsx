import { notFound, redirect } from "next/navigation";
import { Page } from "@/components/page";
import { ExitForm } from "@/components/people/exit-form";
import { firstNameFrom } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { thimphuToday } from "@/lib/format";
import { getPersonDetail } from "@/modules/people/repository";

export const metadata = { title: "Mark as left" };

export default async function ExitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("admin");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getPersonDetail(user, id);
  if (!detail) notFound();
  const { person } = detail;
  if (!person.isCurrent) redirect(`/admin/people/${person.id}`);

  const today = thimphuToday();
  return (
    <Page title="Mark as left" back={{ href: `/admin/people/${person.id}`, label: person.fullName }}>
      <ExitForm
        personId={person.id}
        firstName={firstNameFrom(person.fullName, person.email)}
        startDate={person.startDate}
        today={today < person.startDate ? person.startDate : today}
      />
    </Page>
  );
}
