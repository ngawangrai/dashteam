// Loaded by instrumentation.ts on the Node.js runtime only, since it stops the process.
// Next.js logs an error thrown from register() and then serves every page as a 500, so a missing
// setting has to end the process here for the server to truly refuse to start.
export async function loadSettingsOrExit(): Promise<void> {
  try {
    await import("@/lib/env/public");
    await import("@/lib/env/server");
  } catch (error) {
    const message = error instanceof Error ? error.message : "DashTeam can't start: its settings couldn't be read.";
    // The one log line the app writes: setting names only, never values (see lib/env/schema.ts).
    // eslint-disable-next-line no-console
    console.error(message);
    process.exit(1);
  }
}
