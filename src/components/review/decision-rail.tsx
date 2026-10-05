"use client";

import type { ReactNode, Ref } from "react";
import { Check, CornerUpLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/components/versions/format";
import type { StepView } from "@/domain/review-types";
import { cn } from "@/lib/utils";
import type { DecisionAccess } from "./decision-model";
import { RV } from "./review-grid";
import { SectionLabel } from "./rail-sections";

// The decision rail: everything the approver needs to decide, in one column. The stepper and the two
// decisions sit at the top, pinned: always in view, and never under the Demo pill (fixed at the
// window's bottom right). Under them the rail scrolls: the submit note, the contract changes, the
// comments.
//
// The pinned head is one height for everyone (151px with one stage): the decision row is always
// there, 32px, whatever stands in it: the two buttons (theirs to press, or dim when the version is
// their own), a line once it is decided, or nothing when the viewer isn't an approver. So the content
// below never moves when the persona changes, and the skeleton has the same height.

// ── Approval chain ───────────────────────────────────────────────

const STEP_ICON: Record<StepView["status"], string> = {
  done: "bg-positive-soft text-positive",
  current: "border border-brand bg-brand-soft",
  waiting: "border border-hairline-strong bg-surface",
  returned: "bg-status-changes text-status-changes-text",
};

/** The id of the line that says why Approve and Request changes are dim. */
export const BLOCKED_ID = "decision-blocked";

function StepRow({
  step,
  last,
  previous,
  now,
  blocked,
}: {
  step: StepView;
  last: boolean;
  previous?: StepView;
  now: Date;
  /** Why this viewer can't decide the stage (it is their own version): it stands where "Waiting for a decision" does. */
  blocked: string | null;
}) {
  const reason = step.status === "current" ? blocked : null;
  const sub =
    step.status === "done"
      ? step.decidedBy
        ? `${step.decidedBy.name}${step.decidedAt ? ` · ${formatRelative(step.decidedAt, now)}` : ""}`
        : "Approved"
      : step.status === "current"
        ? (reason ?? "Waiting for a decision")
        : step.status === "returned"
          ? "Changes requested"
          : `After ${previous?.name ?? "the previous stage"}`;
  return (
    <li className="relative grid grid-cols-[1.25rem_1fr] gap-x-3" data-step={step.status}>
      {!last ? <span aria-hidden className="absolute top-6 bottom-[-0.25rem] left-[9.5px] w-px bg-hairline-strong" /> : null}
      <span className={cn("mt-0.5 grid size-5 place-items-center rounded-full transition-colors", STEP_ICON[step.status])}>
        {step.status === "done" ? <Check aria-hidden strokeWidth={2.5} className="size-3" /> : null}
        {step.status === "current" ? <span className="size-2 rounded-full bg-brand" /> : null}
        {step.status === "returned" ? <CornerUpLeft aria-hidden strokeWidth={2.25} className="size-3" /> : null}
      </span>
      <div className={cn("min-w-0 pb-3.5", last && "pb-0")}>
        <div className={cn("text-[14px] leading-6", step.status === "waiting" ? "text-text-muted" : "font-medium text-text")}>
          {step.name}
        </div>
        <div id={reason ? BLOCKED_ID : undefined} title={reason ?? undefined} className="truncate text-[13px] leading-5 text-text-muted">
          {sub}
        </div>
      </div>
    </li>
  );
}

function Approval({ steps, now, blocked }: { steps: readonly StepView[]; now: Date; blocked: string | null }) {
  const at = steps.findIndex((s) => s.status === "current" || s.status === "returned");
  return (
    <section aria-label="Approval">
      <SectionLabel
        right={
          steps.length > 1 && at >= 0 ? (
            <span className="text-[12px] text-text-subtle">
              Stage {at + 1} of {steps.length}
            </span>
          ) : null
        }
      >
        Approval
      </SectionLabel>
      <ol className="mt-3">
        {steps.map((s, i) => (
          <StepRow key={s.position} step={s} last={i === steps.length - 1} previous={steps[i - 1]} now={now} blocked={blocked} />
        ))}
      </ol>
    </section>
  );
}

// ── The decision ─────────────────────────────────────────────────

/**
 * The decision row, under the stepper: 32px for everyone.
 * - Open: Approve and Request changes.
 * - Blocked (the viewer is an approver, but this is their own version): the same two, dim. The reason is
 *   the current stage's own line above them (the stepper), so the row has nothing to add.
 * - Hidden (the viewer isn't an approver on the team): the row stays, empty, so the head keeps its height.
 * - Decided, or not in review: a line (what was decided, or the version's state) stands where the buttons
 *   were. It is a status, and it takes focus when the decision was made here, since the button that
 *   opened the dialog is gone.
 */
function Decision({
  access,
  line,
  onApprove,
  onRequest,
  approveRef,
  requestRef,
  regionRef,
}: {
  access: DecisionAccess;
  /** Replaces the buttons. */
  line: string | null;
  onApprove: () => void;
  onRequest: () => void;
  approveRef: Ref<HTMLButtonElement>;
  requestRef: Ref<HTMLButtonElement>;
  /** Where focus goes when the button that opened a dialog is gone (the decision was made). */
  regionRef: Ref<HTMLDivElement>;
}) {
  const open = access.kind === "open";
  return (
    <div
      ref={regionRef}
      data-decision=""
      data-decided={line ? "" : undefined}
      role={line ? "status" : undefined}
      tabIndex={line ? -1 : undefined}
      className={cn("mt-4 flex h-8 items-center outline-none", line && "text-[14px] leading-6 text-text-muted")}
    >
      {line ? (
        line
      ) : access.kind === "hidden" ? null : (
        <div className="flex w-full gap-2">
          <Button
            ref={approveRef}
            className="flex-1"
            disabled={!open}
            aria-describedby={access.kind === "blocked" ? BLOCKED_ID : undefined}
            onClick={onApprove}
          >
            Approve
          </Button>
          <Button
            ref={requestRef}
            variant="outline"
            className="flex-1 bg-surface"
            disabled={!open}
            aria-describedby={access.kind === "blocked" ? BLOCKED_ID : undefined}
            onClick={onRequest}
          >
            Request changes
          </Button>
        </div>
      )}
    </div>
  );
}

// ── The rail ─────────────────────────────────────────────────────

export function DecisionRail({
  steps,
  nowIso,
  access,
  line,
  onApprove,
  onRequest,
  approveRef,
  requestRef,
  regionRef,
  children,
}: {
  steps: readonly StepView[];
  nowIso: string;
  access: DecisionAccess;
  line: string | null;
  onApprove: () => void;
  onRequest: () => void;
  approveRef: Ref<HTMLButtonElement>;
  requestRef: Ref<HTMLButtonElement>;
  regionRef: Ref<HTMLDivElement>;
  /** The scrolling part: the note, the contract, the comments. */
  children: ReactNode;
}) {
  return (
    <aside aria-label="Decision" data-slot="rail" className={RV.rail}>
      <div data-rail-head="" className={RV.railHead}>
        <Approval steps={steps} now={new Date(nowIso)} blocked={access.kind === "blocked" && line === null ? access.reason : null} />
        <Decision
          access={access}
          line={line}
          onApprove={onApprove}
          onRequest={onRequest}
          approveRef={approveRef}
          requestRef={requestRef}
          regionRef={regionRef}
        />
      </div>
      <div data-rail-scroll="" className={RV.railBody}>
        {children}
      </div>
    </aside>
  );
}
