"use client";

import type { CSSProperties } from "react";
import { Toaster as SonnerToaster } from "sonner";

// One toaster for the whole app, mounted in the root layout. Colours come from DashTeam's tokens,
// so it follows light and dark mode. On phones it sits above the tab bar.
export function Toaster() {
  return (
    <SonnerToaster
      theme="system"
      position="bottom-center"
      offset={24}
      mobileOffset={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
      style={
        {
          "--normal-bg": "var(--color-surface)",
          "--normal-text": "var(--color-label)",
          "--normal-border": "var(--color-separator)",
          "--border-radius": "var(--radius-card)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "!font-sans !text-secondary",
          actionButton: "!bg-accent-fill !text-on-accent !rounded-control !min-h-8 !px-3 !text-secondary !font-semibold",
        },
      }}
    />
  );
}
