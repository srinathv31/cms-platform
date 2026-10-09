"use client";

import type { ReactNode } from "react";
import type { VersionState } from "@/domain/types";
import { useFocusTarget } from "./session/workspace-session";

/**
 * The header's status row: the badge, the version label and the save status. Focus lands here when what it
 * says is the outcome of what the person just did: a submit (it then reads In review, workspace-actions.tsx)
 * or a revert (save-status.tsx). It registers with the session as the `statusRow` focus target, with the
 * state it shows, and `tabIndex={-1}` lets a script land there without adding a Tab stop.
 */
export function StatusRow({ state, className, children }: { state: VersionState; className?: string; children: ReactNode }) {
  const ref = useFocusTarget("statusRow", state);
  return (
    <div ref={ref} data-slot="status-row" role="group" aria-label="Status" tabIndex={-1} className={className}>
      {children}
    </div>
  );
}
