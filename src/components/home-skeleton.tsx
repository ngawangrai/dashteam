/** Matches the home layout (large title, one section) so nothing jumps when it loads. */
export function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mx-auto flex w-full max-w-(--page-width) flex-col gap-6 px-4 pt-4">
        <div className="h-[2.5625rem] w-48 rounded-control bg-surface" />
        <div className="h-44 rounded-card bg-surface" />
      </div>
    </div>
  );
}
