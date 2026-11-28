import { describe, expect, it } from "vitest";
import { EnvError, parsePublicEnv, parseServerEnv } from "./schema";

const SERVER = {
  DATABASE_URL: "postgresql://postgres:hunter2@127.0.0.1:54322/postgres",
  SUPABASE_SECRET_KEY: "sb_secret_local",
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  MAILPIT_URL: "http://127.0.0.1:54324",
  EMAIL_FROM: "Xceed Studio <payroll@dashteam.local>",
  APP_URL: "http://localhost:3000",
  CRON_SECRET: "c".repeat(32),
};
const PUBLIC = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local" };

const errorFrom = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return (error as Error).message;
  }
  throw new Error("expected the settings to be refused");
};

describe("server settings", () => {
  it("accepts a full local configuration", () => {
    expect(parseServerEnv(SERVER, undefined)).toMatchObject({ EMAIL_FROM: SERVER.EMAIL_FROM, MAILPIT_URL: SERVER.MAILPIT_URL });
  });

  it("accepts production with Resend instead of Mailpit", () => {
    const production = { ...SERVER, MAILPIT_URL: undefined, RESEND_API_KEY: "re_live", APP_URL: "https://dashteam.example" };
    expect(parseServerEnv(production, "production").RESEND_API_KEY).toBe("re_live");
  });

  it.each(["DATABASE_URL", "SUPABASE_SECRET_KEY", "FIELD_ENCRYPTION_KEY", "EMAIL_FROM", "APP_URL", "CRON_SECRET"])(
    "names %s when it's missing, with no default to fall back on",
    (name) => {
      expect(errorFrom(() => parseServerEnv({ ...SERVER, [name]: undefined }, undefined))).toContain(`wrong: ${name}.`);
    },
  );

  it("treats an empty value as missing", () => {
    expect(errorFrom(() => parseServerEnv({ ...SERVER, APP_URL: "" }, undefined))).toContain("APP_URL");
  });

  it("names every problem at once", () => {
    const message = errorFrom(() => parseServerEnv({ ...SERVER, EMAIL_FROM: undefined, APP_URL: undefined, MAILPIT_URL: undefined }, undefined));
    expect(message).toBe(
      "DashTeam can't start. These settings are missing or wrong: EMAIL_FROM, APP_URL. Set exactly one of RESEND_API_KEY (production) or MAILPIT_URL (local and CI). Locally, run `pnpm env:local`.",
    );
  });

  it("refuses no email transport, and refuses two", () => {
    expect(errorFrom(() => parseServerEnv({ ...SERVER, MAILPIT_URL: undefined }, undefined))).toContain("exactly one of RESEND_API_KEY");
    expect(errorFrom(() => parseServerEnv({ ...SERVER, RESEND_API_KEY: "re_live" }, undefined))).toContain("exactly one of RESEND_API_KEY");
  });

  it("refuses a short cron secret and a key that isn't 32 bytes", () => {
    expect(errorFrom(() => parseServerEnv({ ...SERVER, CRON_SECRET: "short" }, undefined))).toContain("CRON_SECRET");
    expect(errorFrom(() => parseServerEnv({ ...SERVER, FIELD_ENCRYPTION_KEY: "abc" }, undefined))).toContain("FIELD_ENCRYPTION_KEY");
  });

  it("never repeats a value in the message", () => {
    const message = errorFrom(() => parseServerEnv({ ...SERVER, DATABASE_URL: "mysql://root:hunter2@db" }, undefined));
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("hunter2");
  });
});

describe("previews", () => {
  it("refuses a Vercel preview even with every setting in place", () => {
    const expected = "DashTeam doesn't run on preview deployments. There's no staging database, and a preview must never reach production.";
    expect(errorFrom(() => parseServerEnv(SERVER, "preview"))).toBe(expected);
    expect(errorFrom(() => parsePublicEnv(PUBLIC, "preview"))).toBe(expected);
  });

  it("runs on Vercel production and on hosts that don't set VERCEL_ENV", () => {
    expect(parsePublicEnv(PUBLIC, "production")).toEqual(PUBLIC);
    expect(parsePublicEnv(PUBLIC, undefined)).toEqual(PUBLIC);
  });
});

describe("public settings", () => {
  it("names a missing Supabase URL", () => {
    expect(errorFrom(() => parsePublicEnv({ ...PUBLIC, NEXT_PUBLIC_SUPABASE_URL: undefined }, undefined))).toContain(
      "NEXT_PUBLIC_SUPABASE_URL",
    );
  });
});
