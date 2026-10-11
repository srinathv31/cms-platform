"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Route } from "next";
import type { OutputKey } from "@/domain/review-outputs";
import { reviewPath } from "@/domain/rounds";
import type { ReviewScreenData } from "@/server/queries/review-models";
import type { Approved } from "./approve-dialog";
import { approvalStage, approveWaitsOn, decisionAccess, decisionRow, type LocalDecision } from "./decision-model";
import type { NextRound } from "./decision-rail";
import type { GoLiveMoment } from "./use-go-live";

/**
 * The review screen's decision: whether Approve and Request changes are the viewer's to press (`access`), what
 * stands in their place once decided (`row`), the two dialogs they open, and where focus goes when a dialog
 * closes. This is the one place the approve wiring lives: the dialogs' props come from `approveDialog` and
 * `requestDialog`, the buttons (the rail's and the stacked layout's bar) call `open`, and the approval's
 * go-live moment is started and finished here (`goLive`, use-go-live.ts).
 *
 * The server's data is the truth and arrives anew after every action; what is kept here is what the viewer did
 * on this screen (`local`: "You approved v3."). Approve also waits on the outputs the approver has viewed in
 * the Preview (`viewed`, use-viewed-outputs.ts): `approveBlocked` is why, in the domain's sentence, while one
 * is missing or can't be shown (`cannotShow`; decision 0037).
 */
export function useReviewDecision({
  data,
  team,
  goLive,
  viewed,
  cannotShow,
}: {
  data: ReviewScreenData;
  team: string;
  goLive: GoLiveMoment;
  /** The outputs of this round the approver has had on screen in the Preview. */
  viewed: readonly OutputKey[];
  /** The outputs the Preview saw the render refuse for a reason of the version's own: they can't be viewed. */
  cannotShow: readonly OutputKey[];
}) {
  const { template, version, steps, can } = data;
  const stage = useMemo(() => approvalStage(steps), [steps]);

  const [dialog, setDialog] = useState<"approve" | "request" | null>(null);
  const [local, setLocal] = useState<LocalDecision>(null);

  const approveButton = useRef<HTMLButtonElement>(null);
  const requestButton = useRef<HTMLButtonElement>(null);
  const decisionRegion = useRef<HTMLDivElement>(null);
  /** The decision went through: the opener is gone, so focus goes to the place it stood. */
  const decided = useRef(false);
  /** The button a dialog was opened from, when it isn't the rail's (the stacked layout's bar has its own pair). */
  const dialogOpener = useRef<HTMLElement | null>(null);

  function open(which: "approve" | "request", from: HTMLElement | null = null) {
    decided.current = false;
    dialogOpener.current = from;
    setDialog(which);
  }

  /** Where focus goes when a dialog closes: the line that stands where the buttons were, once decided; else the button it came from. */
  function returnFocus(rail: RefObject<HTMLButtonElement | null>) {
    if (decided.current) return decisionRegion.current;
    const from = dialogOpener.current;
    return from?.isConnected ? from : rail.current;
  }

  function onApproved({ wentLive }: Approved) {
    decided.current = true;
    setLocal({ kind: "approved", wentLive, nextStage: stage.next?.name ?? null });
    goLive.approved(wentLive);
  }

  // The decision went through: the buttons the dialog came from are replaced by a line, and focus goes
  // to the place they stood. (The dialog's own return of focus can land on a button just as it goes.)
  const row = decisionRow({
    version: { number: version.number, round: version.round, state: version.state },
    authorName: version.submittedBy.name,
    local,
    canDecideAgain: can.approve.ok,
  });
  const line = row.kind === "line" ? row.text : null;
  // A sent-back round that was resubmitted links on to where its work went, in this space.
  const { replacedBy } = data;
  const next: NextRound | null = replacedBy
    ? { label: replacedBy.label, href: reviewPath(team, template.id, replacedBy) as Route }
    : null;
  useEffect(() => {
    if (line !== null && decided.current) decisionRegion.current?.focus({ preventScroll: true });
  }, [line]);

  const access = decisionAccess(can.approve, can.requestChanges);

  return {
    access,
    /** Approve alone is blocked, with this sentence: an output not viewed yet, or one that can't be shown. */
    approveBlocked: approveWaitsOn(access, version, viewed, cannotShow),
    row,
    next,
    /** The viewer made the decision on this screen. */
    decidedHere: local !== null,
    open,
    approveButton,
    requestButton,
    decisionRegion,
    /** What `ApproveDialog` takes beyond the version's own facts. */
    approveDialog: {
      open: dialog === "approve",
      onOpenChange: (isOpen: boolean) => !isOpen && setDialog(null),
      stage,
      // The server's data moves to Active the moment the approval lands; the header holds until the moment plays.
      outputsViewed: viewed,
      onBegin: () => goLive.begin(stage.final),
      onApproved,
      onFailed: () => goLive.failed(),
      finalFocus: () => returnFocus(approveButton),
    },
    /** What `RequestChangesDialog` takes beyond the version's own facts. */
    requestDialog: {
      open: dialog === "request",
      onOpenChange: (isOpen: boolean) => !isOpen && setDialog(null),
      onRequested: () => {
        decided.current = true;
        setLocal({ kind: "returned" });
      },
      finalFocus: () => returnFocus(requestButton),
    },
  };
}
