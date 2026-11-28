// Next.js runs register() once when a server starts. Loading the settings here makes a server that
// is missing any of them (or is a Vercel preview) stop at start, with the names, instead of failing
// on someone's first request.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadSettingsOrExit } = await import("./instrumentation-node");
  await loadSettingsOrExit();
}
