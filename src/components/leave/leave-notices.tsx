import { Info } from "lucide-react";
import { Icon } from "@/components/icon";
import { InsetSection } from "@/components/inset-section";

/** Notes about the person's leave, such as a holiday change that altered a count. Shown until seen. */
export function LeaveNotices({ notices }: { notices: { id: string; message: string }[] }) {
  if (!notices.length) return null;
  return (
    <InsetSection title="Updates">
      {notices.map((notice) => (
        <p key={notice.id} className="flex items-start gap-3 border-b border-separator/60 px-4 py-3 text-body text-pretty last:border-b-0">
          <Icon icon={Info} size={20} className="mt-0.5 shrink-0 text-accent" />
          {notice.message}
        </p>
      ))}
    </InsetSection>
  );
}
