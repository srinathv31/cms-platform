"use client";

import type { RefObject } from "react";
import type { Route } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { m } from "motion/react";
import { duration, ease } from "@/components/motion/presets";
import { StatusBadge } from "@/components/primitives/status-badge";
import { formatRelative } from "@/components/versions/format";
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
// One grid for the real header and its skeleton (review-skeleton.tsx), so they measure the same.

const BACK =
  "caps-label -ml-1 inline-flex h-5 w-fit items-center gap-0.5 rounded-md pr-1 outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring";

export function ReviewHeader({
  team,
  templateId,
  templateName,
  versionNumber,
  state,
  sunsetAt,
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
  /** The state to show: it can lag the server's while the go-live moment plays. */
  state: VersionState;
  /** ISO: the day a Superseded version stops rendering (its badge says "Sunset Mar 1"). */
  sunsetAt?: string | null;
  author: Person;
  submittedAt: string;
  nowIso: string;
  /** The SHARE ring belongs in the slot (the version is Active and the go-live moment is over). */
  ring: boolean;
  slotRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <header className={cn(RV.header, RV.headerRows)}>
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
          <StatusBadge state={state} sunsetAt={sunsetAt ? new Date(sunsetAt) : null} now={nowIso} />
        </m.span>
        <span className="min-w-0 truncate text-[14px] leading-6 text-text-muted">
          v{versionNumber} by {author.name} · {formatRelative(submittedAt, new Date(nowIso))}
        </span>
      </div>
      <div
        ref={slotRef}
        data-slot="share"
        className={RV.ringSlot}
      >
        {ring ? <WorkspaceShare templateId={templateId} templateName={templateName} activeVersion={versionNumber} /> : null}
      </div>
    </header>
  );
}
