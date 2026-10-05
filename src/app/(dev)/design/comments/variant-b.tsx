"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { StatusBadge } from "@/components/primitives/status-badge";
import { Button } from "@/components/ui/button";
import type { ThreadView } from "@/domain/review-types";
import { ComposeCard, ResolvedGroup, ThreadCard } from "./thread-card";
import { useStore } from "./store";

/*
 * B · Markers and popover cards. What lives outside the document's gutter: the card inside a
 * marker's popover, and the version-level strip above the first block (the change request's reason,
 * how many comments are open, and the Resolved group), since a popover has no list to hold them.
 */

/** The popover's card for one block: where you are among the open comments, then the block's threads. */
export function BlockPopover({ threads }: { threads: ThreadView[] }) {
  const store = useStore();
  const open = store.anchored;
  const first = open.findIndex((t) => t.id === threads[0].id);
  const go = (to: number) => {
    const target = open[(to + open.length) % open.length];
    // "list" so the document scrolls to the next block's marker.
    store.activate(target.id, "list");
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] text-text-muted tabular-nums">
          {first + 1} of {open.length}
        </span>
        <div className="-mr-1.5 flex items-center">
          <Button variant="ghost" size="icon" aria-label="Previous comment" onClick={() => go(first - 1)}>
            <ChevronUp strokeWidth={1.75} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next comment" onClick={() => go(first + threads.length)}>
            <ChevronDown strokeWidth={1.75} />
          </Button>
        </div>
      </div>
      <div className="flex flex-col divide-y divide-hairline">
        {threads.map((thread) => (
          <div key={thread.id} className="py-3.5 first:pt-0 last:pb-0" onPointerEnter={() => thread.id !== store.activeId && store.activate(thread.id, "doc")}>
            <ThreadCard thread={thread} flat active={thread.id === store.activeId} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ComposePopover() {
  const store = useStore();
  return store.pending ? <ComposeCard anchor={store.pending} flat /> : null;
}

/**
 * Above the document: the change request (one line of its reason until opened), how much is left to
 * do, and the resolved ones. A popover has no list to hold them, so they live here.
 */
export function VersionStrip({ resolvedOpen, onResolvedOpen }: { resolvedOpen: boolean; onResolvedOpen: (open: boolean) => void }) {
  const store = useStore();
  const [expanded, setExpanded] = useState(false);
  const open = store.anchored.length;
  const request = store.docThread;
  if (!request && open === 0 && store.resolved.length === 0) return null;
  const first = request?.comments[0];
  return (
    <section aria-label="Comments on this version" data-version-strip="" className="mt-6 flex flex-col gap-2">
      {request && first ? (
        expanded ? (
          <div className="relative">
            <ThreadCard thread={request} />
            <Button variant="ghost" size="icon" aria-label="Show less" className="absolute top-2 right-2" onClick={() => setExpanded(false)}>
              <ChevronUp strokeWidth={1.75} />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={false}
            aria-label="Change request"
            onClick={() => setExpanded(true)}
            className="block w-full rounded-xl border border-hairline bg-surface p-3.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="flex items-center gap-2">
              <StatusBadge state="changes_requested" />
              {request.originVersionNumber ? <span className="text-[13px] text-text-muted">on v{request.originVersionNumber}</span> : null}
              <span className="ml-auto text-[13px] text-text-subtle">
                {first.author.name} · {store.ago(first.createdAt)}
              </span>
              <ChevronDown aria-hidden strokeWidth={1.75} className="size-4 text-text-subtle" />
            </span>
            <span className="mt-2 line-clamp-2 block text-[14px] leading-[1.45] text-text">{first.body}</span>
          </button>
        )
      ) : null}
      <ResolvedGroup
        threads={store.resolved}
        open={resolvedOpen}
        onToggle={() => onResolvedOpen(!resolvedOpen)}
        lead={
          open > 0 ? (
            <span className="text-[13px] leading-8 text-text-muted">
              {open} open {open === 1 ? "comment" : "comments"} in the document
            </span>
          ) : undefined
        }
      />
    </section>
  );
}
