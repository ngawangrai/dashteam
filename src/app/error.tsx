"use client";

import { Button } from "@/components/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 text-center">
      <h1 className="text-title">Something went wrong on our side</h1>
      <p className="text-secondary text-label-secondary">Try again. If it keeps happening, let your admin know.</p>
      <Button onClick={reset} className="mx-auto">
        Try again
      </Button>
    </main>
  );
}
