"use client";

import { Button } from "@/components/button";

// Keeps the navigation in place when one screen fails.
export default function ScreenError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 pt-24 text-center">
      <h1 className="text-title">This screen didn’t load</h1>
      <p className="text-secondary text-pretty text-label-secondary">Try again in a minute. If it keeps happening, sign out and back in.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
