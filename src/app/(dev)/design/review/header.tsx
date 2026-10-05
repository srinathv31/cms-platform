"use client";

import type { RefObject } from "react";
import { m } from "motion/react";
import { duration, ease } from "@/components/motion/presets";
import { StatusBadge } from "@/components/primitives/status-badge";
import { ShareRing } from "@/components/signature/share-ring";
import type { VersionState } from "@/domain/types";
import { MAYA, SUBMITTED_AT, TEMPLATE_NAME, VERSION, ago } from "./fixtures";

/*
 * The template header, as the workspace lays it out (the name, then the status row), minus the Template
 * ID, plus a ring slot that is always there: the slot keeps its 76px while the version is in review, so
 * the ring has somewhere to settle and nothing beside it moves when the version goes Active.
 */

export function ReviewHeader({
  status,
  ring,
  slotRef,
}: {
  status: VersionState;
  /** The ring lives in the slot (the version is Active and the moment has played). */
  ring: boolean;
  slotRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-1.5 pt-2 pb-6">
      <h1 className="display-lg col-start-1 row-start-1 min-w-0 truncate text-text" title={TEMPLATE_NAME}>
        {TEMPLATE_NAME}
      </h1>
      <div className="col-start-1 row-start-2 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1.5 self-end">
        <m.span
          key={status}
          initial={{ opacity: 0.2 }}
          animate={{ opacity: 1 }}
          transition={{ duration: duration.slow, ease: ease.outSoft }}
        >
          <StatusBadge state={status} />
        </m.span>
        <span className="text-[14px] leading-6 text-text-muted">
          v{VERSION} by {MAYA.name} · {ago(SUBMITTED_AT)}
        </span>
      </div>
      <div
        ref={slotRef}
        data-slot="share"
        className="col-start-2 row-span-2 row-start-1 ml-6 flex size-19 shrink-0 items-center justify-center self-start"
      >
        {ring ? <ShareRing size={76} label={`Share ${TEMPLATE_NAME} — integration details`} /> : null}
      </div>
    </header>
  );
}

