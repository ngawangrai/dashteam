import type { ReactNode } from "react";

type InsetSectionProps = {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
};

/** A rounded, inset group of related content, as in iOS Settings. */
export function InsetSection({ title, footer, children }: InsetSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      {title ? <h2 className="px-4 text-caption uppercase text-label-secondary">{title}</h2> : null}
      <div className="rounded-card bg-surface">{children}</div>
      {footer ? <div className="px-4 text-caption text-label-secondary">{footer}</div> : null}
    </section>
  );
}

/** One line in an inset section: a label on the left, its value on the right. */
export function InsetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-b border-separator/60 px-4 py-2.5 last:border-b-0">
      <span className="text-body">{label}</span>
      <span className="min-w-0 text-right text-body text-label-secondary">{children}</span>
    </div>
  );
}
