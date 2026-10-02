import type { Route } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "./icon";

type PageProps = {
  title: string;
  subtitle?: ReactNode;
  back?: { href: Route; label: string };
  /** The screen's one primary action, beside the title. */
  action?: ReactNode;
  children: ReactNode;
};

/** A screen: optional back link, large title, then content in a single column. */
export function Page({ title, subtitle, back, action, children }: PageProps) {
  return (
    <main className="mx-auto flex w-full max-w-(--page-width) flex-col gap-6 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-8 md:pt-8">
      <header className="flex flex-col gap-1">
        {back ? (
          <Link href={back.href} className="-ml-1.5 inline-flex min-h-11 w-fit items-center text-body text-accent">
            <Icon icon={ChevronLeft} size={22} />
            {back.label}
          </Link>
        ) : null}
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-large-title break-words">{title}</h1>
            {subtitle ? <p className="text-body text-label-secondary">{subtitle}</p> : null}
          </div>
          {action}
        </div>
      </header>
      {children}
    </main>
  );
}
