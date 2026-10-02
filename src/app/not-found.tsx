import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 text-center">
      <h1 className="text-title">This page doesn’t exist</h1>
      <p className="text-secondary text-label-secondary">The link may be old or mistyped.</p>
      <Link href="/" className="pressable mx-auto inline-flex min-h-11 items-center px-4 text-accent">
        Go home
      </Link>
    </main>
  );
}
