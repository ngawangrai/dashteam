import { Page } from "@/components/page";
import { SignatoryForm } from "@/components/documents/signatory-form";
import { requireRole } from "@/lib/auth/session";
import { signatoryView } from "@/modules/documents/signatory";

export const metadata = { title: "Salary certificates" };

export default async function CertificateSettingsPage() {
  const user = await requireRole("admin");
  const current = await signatoryView(user);
  return (
    <Page title="Who signs certificates" subtitle="Printed at the foot of every salary certificate" back={{ href: "/profile", label: "Profile" }}>
      <SignatoryForm current={current} />
    </Page>
  );
}
