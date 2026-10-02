import type { Route } from "next";
import type { AppRole } from "@/lib/db/schema";

export const ADMIN_HOME = "/admin" satisfies Route;
export const EMPLOYEE_HOME = "/" satisfies Route;

export function homePathFor(role: AppRole): Route {
  return role === "admin" ? ADMIN_HOME : EMPLOYEE_HOME;
}

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_HOME || pathname.startsWith(`${ADMIN_HOME}/`);
}

/** "Sonam Wangmo" → "Sonam"; falls back to the part of the email before the @. */
export function firstNameFrom(fullName: string | null | undefined, email: string): string {
  const first = fullName?.trim().split(/\s+/)[0];
  if (first) return first;
  return email.split("@")[0] ?? email;
}
