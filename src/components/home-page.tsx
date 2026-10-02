import type { ReactNode } from "react";

type HomePageProps = {
  title: string;
  children: ReactNode;
};

export function HomePage({ title, children }: HomePageProps) {
  return (
    <main className="mx-auto flex w-full max-w-(--page-width) flex-col gap-6 px-4 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <h1 className="text-large-title">{title}</h1>
      {children}
    </main>
  );
}
