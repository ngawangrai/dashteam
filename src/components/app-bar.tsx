import { SignOutButton } from "./sign-out-button";

/** Translucent top bar; content scrolls underneath it. */
export function AppBar() {
  return (
    <header className="bg-bar sticky top-0 z-10 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-11 w-full max-w-(--page-width) items-center justify-between pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]">
        <span className="text-body font-semibold">DashTeam</span>
        <SignOutButton />
      </div>
    </header>
  );
}
