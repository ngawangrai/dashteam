// Loading states that match the final layout, so nothing jumps when content arrives.

function Bar({ className }: { className: string }) {
  return <div className={`rounded-control bg-surface ${className}`} />;
}

export function PageSkeleton({ sections = 2, withBack = false }: { sections?: number; withBack?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="mx-auto flex w-full max-w-(--page-width) flex-col gap-6 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-8 md:pt-8">
      {withBack ? <Bar className="h-6 w-24" /> : null}
      <Bar className="h-[2.5625rem] w-56" />
      {Array.from({ length: sections }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="mx-4 h-4 w-20 rounded-control bg-surface" />
          <div className="h-40 rounded-card bg-surface" />
        </div>
      ))}
    </div>
  );
}
