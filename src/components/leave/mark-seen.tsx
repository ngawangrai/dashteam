"use client";

import { useEffect } from "react";
import { markDecisionsSeen } from "@/modules/leave/actions";

/** Opening Leave clears the dot on the Leave tab. */
export function MarkDecisionsSeen({ unseen }: { unseen: number }) {
  useEffect(() => {
    if (unseen > 0) void markDecisionsSeen();
  }, [unseen]);
  return null;
}
