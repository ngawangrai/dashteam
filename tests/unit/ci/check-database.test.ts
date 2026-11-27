import { describe, expect, it } from "vitest";
import { explainConnectionError, parseTarget, pausedMessage } from "../../../scripts/ci/check-database";

const REF = "abcdefghijklmnopqrst";

describe("parseTarget", () => {
  it("reads the project ref from a session pooler user", () => {
    expect(parseTarget(`postgresql://postgres.${REF}:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`)).toEqual({
      ref: REF,
      sharedPooler: true,
    });
  });

  it("reads the project ref from a direct host", () => {
    expect(parseTarget(`postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres`)).toEqual({ ref: REF, sharedPooler: false });
  });

  it("has no ref for a local database, so the paused check is skipped", () => {
    expect(parseTarget("postgresql://postgres:postgres@127.0.0.1:54322/postgres")).toEqual({ ref: null, sharedPooler: false });
  });

  it("says when the shared pooler is used without the project in the user", () => {
    const result = parseTarget("postgresql://postgres:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres");
    expect(result).toEqual({ problem: expect.stringContaining("postgres.<project ref>") });
  });

  it("says when the string isn't a connection string at all", () => {
    expect(parseTarget("not a url")).toEqual({ problem: expect.stringContaining("isn't a valid connection string") });
    expect(parseTarget("https://example.com")).toEqual({ problem: expect.stringContaining("postgresql://") });
  });
});

describe("messages", () => {
  it("tells you how to restore a paused project", () => {
    expect(pausedMessage("production")).toBe(
      "The production project looks paused. Free Supabase projects pause after 7 days without activity. Restore it in Supabase (open the project, then Restore project), wait until it shows Healthy, then run this workflow again.",
    );
  });

  it.each([
    [{ code: "28P01", message: "password authentication failed for user" }, "turned the password down"],
    [{ code: "XX000", message: "Tenant or user not found" }, "doesn't know this user"],
    [{ code: "CONNECT_TIMEOUT", message: "write CONNECT_TIMEOUT" }, "didn't answer within 20 seconds"],
    [{ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" }, "host doesn't exist"],
    [{ code: "ECONNREFUSED", message: "connect ECONNREFUSED" }, "Session pooler uses 5432"],
  ])("explains %o", (error, expected) => {
    expect(explainConnectionError(error, "production")).toContain(expected);
  });

  it("never repeats a connection string from an unknown error", () => {
    const message = explainConnectionError({ message: "boom near postgresql://postgres.x:hunter2@host:5432/postgres" }, "staging");
    expect(message).not.toContain("hunter2");
    expect(message).toContain("[connection string]");
  });
});
