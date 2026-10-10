"use client";

import type { RefObject } from "react";
import type { Route } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { m } from "motion/react";
import { duration, ease } from "@/components/motion/presets";
import { StatusBadge } from "@/components/primitives/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAgo } from "@/domain/dates";
import { approvedOnRound, versionLabel } from "@/domain/rounds";
import { WorkspaceShare } from "@/components/workspace/workspace-share";
import type { Person } from "@/domain/review-types";
import type { VersionState } from "@/domain/types";
import { cn } from "@/lib/utils";
import { RV } from "./review-grid";

// The version's header, as the workspace lays it out (the name, then the status row) with the
// Template ID's place taken by a quiet way back, and a ring slot that is always there: it keeps its
// 76px while the version is in review, so the ring has somewhere to settle when it goes Active and
// nothing beside it moves.
//
//   ‹ REVIEW
//   name ......................................  ┐
//   [In review] v3 by Maya Chen · 2 hours ago      │ SHARE ring (Active only), 76px, spans the rows
//
// The version reads as its label (rounds.ts): "v3 · Round 2 by Maya Chen" once v3 was sent back, and a
// released version approved after send-backs adds "· Approved on round 3".
//
// One grid for the real header and its skeleton, so they measure the same.

const HEADER = "grid grid-cols-[minmax(0,1fr)_auto] gap-y-1.5";
/**
 * The ring's slot: 76px and a 24px gap, where the status row still has the room it needs (about 300px, a
 * grid of 32.25rem); narrower than that it isn't reserved at all, and an Active version shows no ring
 * (the status row would wrap, and the tab bar below it would move). Reserved or not, it is the same for
 * every state at the same width.
 */
const RING_SLOT = "col-start-2 row-span-2 row-start-1 ml-6 hidden size-19 shrink-0 items-center justify-center self-start @min-[32.25rem]/ws:flex";
const BACK =
  "caps-label -ml-1 inline-flex h-5 w-fit items-center gap-0.5 rounded-md pr-1 outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring";

export function ReviewHeader({
  team,
  templateId,
  templateName,
  versionNumber,
  round,
  state,
  sunsetDay,
  author,
  submittedAt,
  nowIso,
  ring,
  slotRef,
}: {
  team: string;
  templateId: string;
  templateName: string;
  versionNumber: number;
  /** The round on screen. */
  round: number;
  /** The state to show: it can lag the server's while the go-live moment plays. */
  state: VersionState;
  /** YYYY-MM-DD in the business time zone: the day a Superseded version stops rendering (its badge says "Sunset Mar 1"). */
  sunsetDay?: string | null;
  author: Person;
  submittedAt: string;
  nowIso: string;
  /** The SHARE ring belongs in the slot (the version is Active and the go-live moment is over). */
  ring: boolean;
  slotRef: RefObject<HTMLDivElement | null>;
}) {
  const shown = { number: versionNumber, round, state };
  const approvedOn = approvedOnRound(shown);
  return (
    <header className={cn(RV.header, HEADER)}>
      <div className="col-start-1 row-start-1 flex min-w-0 flex-col items-start gap-1">
        <Link href={`/${team}/review` as Route} className={BACK}>
          <ChevronLeft aria-hidden strokeWidth={1.75} className="size-3.5" />
          Review
        </Link>
        <h1 className="display-lg min-w-0 max-w-full truncate text-text" title={templateName}>
          {templateName}
        </h1>
      </div>
      <div className="col-start-1 row-start-2 flex min-h-7 items-center gap-x-3 self-end">
        <m.span
          className="shrink-0"
          key={state}
          initial={{ opacity: 0.2 }}
          animate={{ opacity: 1 }}
          transition={{ duration: duration.slow, ease: ease.outSoft }}
        >
          <StatusBadge state={state} sunsetDay={sunsetDay} now={nowIso} />
        </m.span>
        <span data-slot="byline" className="min-w-0 truncate text-[14px] leading-6 text-text-muted">
          {versionLabel(shown)} by {author.name} · {formatAgo(submittedAt, nowIso)}
          {approvedOn ? ` · ${approvedOn}` : null}
        </span>
      </div>
      <div
        ref={slotRef}
        data-slot="share"
        className={RING_SLOT}
      >
        {ring ? <WorkspaceShare templateId={templateId} templateName={templateName} activeVersion={versionNumber} /> : null}
      </div>
    </header>
  );
}

/** The header's rows with nothing in them yet. */
export function ReviewHeaderSkeleton() {
  return (
    <div aria-hidden className={cn(RV.header, HEADER)}>
      <div className="col-start-1 row-start-1 flex min-w-0 flex-col items-start gap-1">
        <Skeleton className="my-[3px] h-3.5 w-14" />
        <Skeleton className="my-[3px] h-7 w-72 max-w-full" />
      </div>
      <div className="col-start-1 row-start-2 flex min-h-7 items-center gap-3 self-end">
        <Skeleton className="h-[22px] w-20 rounded-md" />
        <Skeleton className="h-4 w-44" />
      </div>
      <div className={RING_SLOT} />
    </div>
  );
}
