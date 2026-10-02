import type { EmploymentType } from "@/modules/rules/types";

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = { full_time: "Full-time", intern: "Intern" };

export const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "full_time", label: "Full-time" },
  { value: "intern", label: "Intern" },
] as const satisfies readonly { value: EmploymentType; label: string }[];
