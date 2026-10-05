"use client";

import { Button } from "@/components/ui/button";
import type { DecisionAccess } from "./decision-model";
import { RV } from "./review-grid";

// The stacked layout's decision bar. Below 53rem the decision rail sits under the whole document, so
// Approve would be a long scroll away: this bar sticks to the bottom of the main pane with the same two
// decisions, under the same rules (open, dim for the author with the reason beside them, absent for a
// viewer who isn't an approver). Once the viewer has decided here it says so in a line, since the rail's
// own line (the live status, and where focus goes) is a long scroll below; for a version that was decided
// before, or isn't in review, there is no bar. Beside the rail it is hidden (CSS, in the grid), and the
// rail's own pair is the one. It leaves the window's bottom right clear for the Demo pill.

export function DecisionBar({
  access,
  line,
  decidedHere,
  onApprove,
  onRequest,
}: {
  access: DecisionAccess;
  /** The version has been decided, or isn't in review: there is nothing to press. */
  line: string | null;
  /** The viewer made the decision on this screen: the bar confirms it. */
  decidedHere: boolean;
  onApprove: (opener: HTMLElement) => void;
  onRequest: (opener: HTMLElement) => void;
}) {
  if (line !== null) {
    // The rail's line is the status (it is announced and takes focus); this one only shows it.
    return decidedHere ? (
      <div data-slot="decision-bar" className={RV.bar}>
        <p aria-hidden className="min-w-0 truncate text-[14px] leading-6 text-text-muted">
          {line}
        </p>
      </div>
    ) : null;
  }
  if (access.kind === "hidden") return null;
  const open = access.kind === "open";
  const reasonId = "decision-bar-blocked";
  return (
    <div data-slot="decision-bar" role="group" aria-label="Decide" className={RV.bar}>
      <Button disabled={!open} aria-describedby={open ? undefined : reasonId} onClick={(event) => onApprove(event.currentTarget)}>
        Approve
      </Button>
      <Button
        variant="outline"
        className="bg-surface"
        disabled={!open}
        aria-describedby={open ? undefined : reasonId}
        onClick={(event) => onRequest(event.currentTarget)}
      >
        Request changes
      </Button>
      {access.kind === "blocked" ? (
        <p id={reasonId} className="min-w-0 truncate text-[13px] leading-5 text-text-muted" title={access.reason}>
          {access.reason}
        </p>
      ) : null}
    </div>
  );
}
