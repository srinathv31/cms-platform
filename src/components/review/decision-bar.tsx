"use client";

import { BlockedButton } from "@/components/primitives/blocked-button";
import { Button } from "@/components/ui/button";
import type { DecisionAccess, DecisionRow } from "./decision-model";
import { RV } from "./review-grid";

// The stacked layout's decision bar. Below 53rem the decision rail sits under the whole document, so
// Approve would be a long scroll away: this bar sticks to the bottom of the main pane with the same two
// decisions, under the same rules (open; greyed but focusable when blocked, with the reason beside them
// describing both; absent for a viewer who isn't an approver). Once the viewer has decided here it says so in a line, since the rail's
// own line (the live status, and where focus goes) is a long scroll below; for a version that was decided
// before, or isn't in review, there is no bar. Beside the rail it is hidden (CSS, in the grid), and the
// rail's own pair is the one. It leaves the window's bottom right clear for the Demo pill.

export function DecisionBar({
  access,
  row,
  decidedHere,
  onApprove,
  onRequest,
}: {
  access: DecisionAccess;
  /** Anything but buttons: the version has been decided, or isn't in review, and there is nothing to press. */
  row: DecisionRow;
  /** The viewer made the decision on this screen: the bar confirms it. */
  decidedHere: boolean;
  onApprove: (opener: HTMLElement) => void;
  onRequest: (opener: HTMLElement) => void;
}) {
  if (row.kind !== "buttons") {
    // The rail's line is the status (it is announced and takes focus); this one only shows it.
    return decidedHere && row.kind === "line" ? (
      <div data-slot="decision-bar" className={RV.bar}>
        <p aria-hidden className="min-w-0 truncate text-[14px] leading-6 text-text-muted">
          {row.text}
        </p>
      </div>
    ) : null;
  }
  if (access.kind === "hidden") return null;
  if (access.kind === "blocked") {
    const reasonId = "decision-bar-blocked";
    return (
      <div data-slot="decision-bar" role="group" aria-label="Decide" className={RV.bar}>
        <BlockedButton variant="default" reason={access.reason} describedBy={reasonId}>
          Approve
        </BlockedButton>
        <BlockedButton className="bg-surface" reason={access.reason} describedBy={reasonId}>
          Request changes
        </BlockedButton>
        <p id={reasonId} className="min-w-0 truncate text-[13px] leading-5 text-text-muted" title={access.reason}>
          {access.reason}
        </p>
      </div>
    );
  }
  return (
    <div data-slot="decision-bar" role="group" aria-label="Decide" className={RV.bar}>
      <Button onClick={(event) => onApprove(event.currentTarget)}>Approve</Button>
      <Button variant="outline" className="bg-surface" onClick={(event) => onRequest(event.currentTarget)}>
        Request changes
      </Button>
    </div>
  );
}
