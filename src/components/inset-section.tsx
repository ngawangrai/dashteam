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
