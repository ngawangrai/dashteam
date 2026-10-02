import { notFound } from "next/navigation";
import { Page } from "@/components/page";
import { EditPersonForm } from "@/components/people/edit-person-form";
import { requireRole } from "@/lib/auth/session";
import { formatPhone } from "@/lib/format";
import { getPersonDetail } from "@/modules/people/repository";

export const metadata = { title: "Edit details" };

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("admin");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getPersonDetail(user, id);
  if (!detail) notFound();
  const { person } = detail;

  return (
    <Page title="Edit details" back={{ href: `/admin/people/${person.id}`, label: person.fullName }}>
      <EditPersonForm
        personId={person.id}
        initial={{
          fullName: person.fullName,
          email: person.email,
          phone: person.phone ? formatPhone(person.phone) : "",
          startDate: person.startDate,
          bankName: person.bankName ?? "",
          // Never pre-filled: the full numbers stay encrypted unless someone asks to see them.
          bankAccount: "",
          tpn: "",
        }}
        stored={{ bankAccountLast4: person.bankAccountLast4, tpnLast4: person.tpnLast4 }}
      />
    </Page>
  );
}
