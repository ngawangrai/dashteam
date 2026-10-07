"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { FormMessage } from "@/components/field";
import { makeScheduleNow } from "@/modules/filing/actions";

/** Makes a locked month's IT-1(a) if the step after locking didn't. */
export function MakeScheduleButton({ monthKey, monthName }: { monthKey: string; monthName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          startTransition(async () => {
            const result = await makeScheduleNow(monthKey);
            if (result.status === "done") {
              toast(result.message);
              router.refresh();
            } else if (result.status === "error") setError(result.message);
          })
        }
      >
        {pending ? "Making it…" : `Make ${monthName}’s IT-1(a)`}
      </Button>
      <FormMessage message={error} />
    </>
  );
}
