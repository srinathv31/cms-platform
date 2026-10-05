"use client";

import { useRef, type ReactNode } from "react";
import { Check } from "lucide-react";
import { StatusBadge } from "@/components/primitives/status-badge";
import { Button } from "@/components/ui/button";
import { CommentsList } from "./comments-list";
import { DocFrame } from "./doc-frame";
import { TEMPLATE_NAME } from "./fixtures";
import { useStore } from "./store";

/*
 * The approver's side, one static frame: a version read-only on the left (the rendered document with
 * the same gutter markers and the Comment bubble) and the decision panel on the right, 380px, with
 * the same thread list the author's rail uses. In the real screen the stepper, contract changes and
 * the rendered output's own controls are the review-screen mock's; they are only stand-ins here, so
 * the thread list can be seen where it will sit: under the stepper and the contract changes, above
 * the decision buttons.
 */

function Stepper() {
  return (
    <section aria-label="Approval" className="flex flex-col gap-3">
      <div className="caps-label">Approval</div>
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-brand">
          <span className="size-1.5 rounded-full bg-brand" />
        </span>
        <div className="min-w-0">
          <div className="text-[14px] leading-5 font-medium text-text">Team approver</div>
          <div className="text-[13px] leading-5 text-text-muted">Waiting on you</div>
        </div>
      </div>
    </section>
  );
}

function ContractChanges() {
  return (
    <section aria-label="Contract changes" className="flex flex-col gap-3">
      <div className="caps-label">Contract changes</div>
      <div className="flex flex-col items-start gap-2">
        <span className="inline-flex h-[22px] items-center rounded-md border border-warning-border bg-warning-soft px-2 text-[12px] font-medium text-warning-text">
          Breaking change
        </span>
        <p className="text-[14px] leading-[1.45] text-text">v2 adds required variable Spend requirement (Currency).</p>
      </div>
    </section>
  );
}

export function ReviewFrame({
  doc,
  resolvedOpen,
  onResolvedOpen,
}: {
  doc: ReactNode;
  resolvedOpen: boolean;
  onResolvedOpen: (open: boolean) => void;
}) {
  const store = useStore();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-workspace="" data-screen="review" className="relative flex min-h-0 flex-1">
      <div data-main="" className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pr-10 pl-(--canvas-pad-x)">
        <div className="mx-auto max-w-(--doc-width)">
          <header className="mt-2 flex flex-col gap-2 pb-6">
            <h1 className="display-lg truncate text-text" title={TEMPLATE_NAME}>
              {TEMPLATE_NAME}
            </h1>
            <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1.5">
              <StatusBadge state="in_review" />
              <span className="text-[14px] leading-6 text-text-muted">v2</span>
              <span aria-hidden className="-mx-1.5 text-text-subtle">
                ·
              </span>
              <span className="text-[14px] leading-6 text-text-muted">Submitted by Maya Chen 2h ago</span>
            </div>
          </header>
          <div className="border-b border-hairline" />
          <DocFrame doc={doc} mode="review" markers="button" gutter="0rem" />
        </div>
      </div>

      <aside aria-label="Decision" data-rail="" className="flex h-full w-[380px] shrink-0 flex-col border-l border-hairline bg-canvas">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-[17px] pb-10">
          <div className="flex flex-col gap-7">
            <Stepper />
            <ContractChanges />
            <section aria-label="Comments" className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <div className="caps-label">Comments</div>
                <span className="text-[13px] text-text-subtle tabular-nums">{store.open.length} open</span>
              </div>
              <CommentsList resolvedOpen={resolvedOpen} onResolvedOpen={onResolvedOpen} />
            </section>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-hairline px-5 py-4">
          <Button variant="outline" className="flex-1">
            Request changes
          </Button>
          <Button className="flex-1">
            <Check data-icon="inline-start" strokeWidth={1.75} />
            Approve
          </Button>
        </div>
      </aside>
    </div>
  );
}
