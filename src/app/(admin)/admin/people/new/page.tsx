import { Page } from "@/components/page";
import { AddPersonForm } from "@/components/people/add-person-form";
import { requireRole } from "@/lib/auth/session";
import { thimphuToday } from "@/lib/format";
import { rulesForMonth } from "@/modules/people/repository";

export const metadata = { title: "Add person" };

export default async function AddPersonPage() {
  const user = await requireRole("admin");
  const rules = await rulesForMonth(user);
  return (
    <Page title="Add person" back={{ href: "/admin/people", label: "People" }}>
      <AddPersonForm rules={rules} today={thimphuToday()} />
    </Page>
  );
}
