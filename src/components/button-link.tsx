import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

type ButtonLinkProps = { href: Route; variant?: "primary" | "secondary" | "plain"; children: ReactNode; className?: string };

const variants = {
  primary: "bg-accent-fill text-on-accent font-semibold",
  secondary: "bg-fill text-accent font-semibold",
  plain: "text-accent",
};

/** Navigation that looks like a button, for primary actions that open another screen. */
export function ButtonLink({ href, variant = "primary", children, className = "" }: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={`pressable inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control px-4 text-body ${variants[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}
