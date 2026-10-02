import { describe, expect, it } from "vitest";
import { firstNameFrom, homePathFor, isAdminPath } from "@/lib/auth/roles";

describe("homePathFor", () => {
  it("sends admins to the admin home", () => {
    expect(homePathFor("admin")).toBe("/admin");
  });

  it("sends employees to their own home", () => {
    expect(homePathFor("employee")).toBe("/");
  });
});

describe("isAdminPath", () => {
  it.each(["/admin", "/admin/", "/admin/payroll", "/admin/leave/123"])("treats %s as admin", (path) => {
    expect(isAdminPath(path)).toBe(true);
  });

  it.each(["/", "/login", "/administrator", "/payslips/admin"])("does not treat %s as admin", (path) => {
    expect(isAdminPath(path)).toBe(false);
  });
});

describe("firstNameFrom", () => {
  it("uses the first word of the full name", () => {
    expect(firstNameFrom("Sonam Wangmo", "sonam@xceed.studio")).toBe("Sonam");
  });

  it("falls back to the email when there is no name", () => {
    expect(firstNameFrom(null, "sonam@xceed.studio")).toBe("sonam");
    expect(firstNameFrom("   ", "sonam@xceed.studio")).toBe("sonam");
  });
});
