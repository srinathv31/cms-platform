"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, CornerUpLeft, TriangleAlert } from "lucide-react";
import type { ContractChange } from "@/editor/model/types";
import type { PermissionResult } from "@/domain/types";
import type { Person, StepView, ThreadView } from "@/domain/review-types";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SUBMIT_NOTE, ago, blockLabel, MAYA } from "./fixtures";
import type { ActionsAt, StageCount } from "./types";

/*
 * The decision panel: everything the approver needs to decide, in one column, with the two decisions
 * pinned under it. Rail measures: 20px side padding, 32px controls, a hairline between sections'
 * content and nothing else. The first label sits on the title's first baseline (17px of top padding).
 */

const MONO = "rounded-md bg-surface-sunken px-1 py-px font-mono text-[12.5px] text-text";

/** "adds required `annual_fee`" → the key in Geist Mono. */
function WithKeys({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className={MONO}>
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-6 items-center justify-between gap-3">
      <h2 className="caps-label">{children}</h2>
      {right}
    </div>
  );
}

// ── Approval chain ───────────────────────────────────────────────

const STEP_ICON: Record<StepView["status"], string> = {
  done: "bg-positive-soft text-positive",
  current: "border border-brand bg-brand-soft",
  waiting: "border border-hairline-strong bg-surface",
  returned: "bg-status-changes text-status-changes-text",
};

function StepRow({ step, last, previous }: { step: StepView; last: boolean; previous?: StepView }) {
  const sub =
    step.status === "done"
      ? `${step.decidedBy?.name ?? "Approved"} · ${step.decidedAt ? ago(step.decidedAt) : ""}`
      : step.status === "current"
        ? "Waiting for a decision"
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
      <div className={cn("pb-3.5", last && "pb-0")}>
        <div className={cn("text-[14px] leading-6", step.status === "waiting" ? "text-text-muted" : "font-medium text-text")}>
          {step.name}
        </div>
        <div className="text-[13px] leading-5 text-text-muted">{sub}</div>
      </div>
    </li>
  );
}

function Approval({ steps, stages }: { steps: StepView[]; stages: StageCount }) {
  const at = steps.findIndex((s) => s.status === "current" || s.status === "returned");
  return (
    <section aria-label="Approval">
      <SectionLabel right={stages > 1 ? <span className="text-[12px] text-text-subtle">Stage {Math.max(at, 0) + 1} of {stages}</span> : null}>
        Approval
      </SectionLabel>
      <ol className="mt-3">
        {steps.map((s, i) => (
          <StepRow key={s.position} step={s} last={i === steps.length - 1} previous={steps[i - 1]} />
        ))}
      </ol>
    </section>
  );
}

function Note() {
  return (
    <figure className="rounded-xl border border-hairline bg-surface-tinted px-3 py-2.5">
      <figcaption className="text-[12px] leading-4 text-text-subtle">Note from {MAYA.name}</figcaption>
      <p className="mt-1 text-[14px] leading-5 text-text">{SUBMIT_NOTE}</p>
    </figure>
  );
}

// ── The decision ─────────────────────────────────────────────────

/**
 * Approve and Request changes, under the stepper at the top of the rail: always in view, never under the
 * Demo pill (fixed at the window's bottom right). Blocked, both go dim and one line says why, under them,
 * so the buttons keep their place for every persona. Once decided, the line replaces them.
 */
function Actions({
  can,
  decided,
  onApprove,
  onRequest,
  className,
}: {
  can: PermissionResult;
  decided: string | null;
  onApprove: () => void;
  onRequest: () => void;
  className?: string;
}) {
  if (decided) {
    return (
      <p data-decided="" className={cn("flex h-8 items-center text-[14px] leading-6 text-text-muted", className)}>
        {decided}
      </p>
    );
  }
  const blocked = can.ok ? null : can.reason;
  return (
    <div data-decision="" className={className}>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={!can.ok} aria-describedby={blocked ? "decision-blocked" : undefined} onClick={onApprove}>
          Approve
        </Button>
        <Button
          variant="outline"
          className="flex-1 bg-surface"
          disabled={!can.ok}
          aria-describedby={blocked ? "decision-blocked" : undefined}
          onClick={onRequest}
        >
          Request changes
        </Button>
      </div>
      {blocked ? (
        <p id="decision-blocked" className="mt-2.5 text-[13px] leading-5 text-text-muted">
          {blocked}
        </p>
      ) : null}
    </div>
  );
}

// ── Contract changes ─────────────────────────────────────────────

function Contract({ changes, lines }: { changes: ContractChange[]; lines: string[] }) {
  const breaking = changes.some((c) => c.breaking);
  return (
    <section aria-label="Contract changes" className="mt-8">
      <SectionLabel
        right={
          breaking ? (
            <Badge
              variant="outline"
              className="h-[22px] border-danger/25 bg-danger-soft px-2 text-[12px] font-medium text-danger-text"
            >
              Breaking change
            </Badge>
          ) : null
        }
      >
        Contract changes
      </SectionLabel>
      <ul className="mt-3 flex flex-col gap-2.5">
        {lines.map((line, i) => (
          <li key={i} className="grid grid-cols-[1.25rem_1fr] gap-x-3 text-[14px] leading-6">
            <span className="grid h-6 place-items-center">
              {changes[i]?.breaking ? (
                <TriangleAlert aria-label="Breaking" strokeWidth={1.75} className="size-4 text-danger-text" />
              ) : (
                <span aria-hidden className="size-1.5 rounded-full bg-text-subtle" />
              )}
            </span>
            <span className="text-text">
              <WithKeys text={line} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Comments ─────────────────────────────────────────────────────

function Anchor({ thread }: { thread: ThreadView }) {
  const text = thread.blockId === DOCUMENT_THREAD ? "Whole version" : (thread.quote ?? blockLabel(thread.blockId));
  return (
    <div className={cn("mb-2 line-clamp-2 border-l-2 pl-2.5 text-[13px] leading-5 text-text-muted", thread.quote ? "border-warning" : "border-hairline-strong")}>
      {text}
    </div>
  );
}

function CommentRow({ author, body, at, label }: { author: Person; body: string; at: string; label?: string }) {
  return (
    <div className="flex gap-2.5 py-1.5 first:pt-0 last:pb-0">
      <UserAvatar initials={author.initials} hue={author.hue} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] leading-5 font-medium text-text">{author.name}</span>
          <span className="text-[12px] leading-5 text-text-subtle">{ago(at)}</span>
          {label ? <span className="caps-label ml-auto">{label}</span> : null}
        </div>
        <p className="text-[14px] leading-5 [overflow-wrap:anywhere] text-text">{body}</p>
      </div>
    </div>
  );
}

function ThreadCard({
  thread,
  selected,
  onSelect,
  onReply,
  onResolve,
  onReopen,
}: {
  thread: ThreadView;
  selected: boolean;
  onSelect: () => void;
  onReply: (body: string) => void;
  onResolve: () => void;
  onReopen: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  const replyButton = useRef<HTMLButtonElement>(null);
  const resolved = thread.status === "resolved";
  // The reply box closes: focus goes back to the Reply button that opened it.
  const closeReply = () => {
    setReplying(false);
    setBody("");
    requestAnimationFrame(() => replyButton.current?.focus());
  };
  return (
    <li
      data-thread-card={thread.id}
      data-status={thread.status}
      onClick={(e) => {
        // Writing a reply or pressing a button isn't picking the thread.
        if ((e.target as HTMLElement).closest("textarea, button")) return;
        onSelect();
      }}
      className={cn(
        "rounded-xl border bg-surface p-3 transition-colors",
        selected ? "border-text-subtle" : "border-hairline",
        resolved && "bg-surface-tinted",
      )}
    >
      <Anchor thread={thread} />
      <div className="flex flex-col">
        {thread.comments.map((c) => (
          <CommentRow
            key={c.id}
            author={c.author}
            body={c.body}
            at={c.createdAt}
            label={c.kind === "change_request" ? "Change request" : undefined}
          />
        ))}
      </div>
      {replying ? (
        <div className="mt-2.5">
          <Textarea
            autoFocus
            rows={2}
            aria-label="Reply"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-16 bg-surface text-[14px]"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                closeReply();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={!body.trim()}
              className="bg-surface"
              onClick={(e) => {
                e.stopPropagation();
                onReply(body.trim());
                closeReply();
              }}
            >
              Reply
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 -mb-1 flex items-center justify-between gap-2">
          {resolved ? (
            <span className="text-[12px] text-text-subtle">Resolved by {thread.resolvedBy?.name}</span>
          ) : (
            <Button
              ref={replyButton}
              variant="ghost"
              className="-ml-2.5 text-[13px] text-text-muted"
              onClick={(e) => {
                e.stopPropagation();
                setReplying(true);
              }}
            >
              Reply
            </Button>
          )}
          <Button
            variant="ghost"
            className="-mr-2.5 gap-1.5 text-[13px] text-text-muted"
            onClick={(e) => {
              e.stopPropagation();
              if (resolved) onReopen();
              else onResolve();
            }}
          >
            {resolved ? null : <Check data-icon="inline-start" strokeWidth={1.75} />}
            {resolved ? "Reopen" : "Resolve"}
          </Button>
        </div>
      )}
    </li>
  );
}

function Composer({
  thread,
  onCancel,
  onPost,
}: {
  thread: ThreadView;
  onCancel: () => void;
  onPost: (body: string) => void;
}) {
  const [body, setBody] = useState("");
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <li ref={ref} data-composer="" className="rounded-xl border border-text-subtle bg-surface p-3">
      <Anchor thread={thread} />
      <Textarea
        autoFocus
        rows={3}
        aria-label="Comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        className="min-h-20 bg-surface text-[14px]"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" disabled={!body.trim()} className="bg-surface" onClick={() => onPost(body.trim())}>
          Comment
        </Button>
      </div>
    </li>
  );
}

export interface ComposerState {
  blockId: string;
  quote?: string;
}

function Comments({
  threads,
  selectedId,
  composer,
  onSelect,
  onCancelComposer,
  onPost,
  onReply,
  onResolve,
  onReopen,
}: {
  threads: ThreadView[];
  selectedId: string | null;
  composer: ComposerState | null;
  onSelect: (id: string) => void;
  onCancelComposer: () => void;
  onPost: (body: string) => void;
  onReply: (threadId: string, body: string) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const open = threads.filter((t) => t.status === "open");
  const resolved = threads.filter((t) => t.status === "resolved");
  // Selecting a resolved thread (from the document's marker) opens the list it is in.
  const resolvedSelected = resolved.some((t) => t.id === selectedId);
  const expanded = showResolved || resolvedSelected;

  useEffect(() => {
    if (!selectedId) return;
    document.querySelector(`[data-thread-card="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, expanded]);

  const card = (t: ThreadView) => (
    <ThreadCard
      key={t.id}
      thread={t}
      selected={t.id === selectedId}
      onSelect={() => onSelect(t.id)}
      onReply={(body) => onReply(t.id, body)}
      onResolve={() => onResolve(t.id)}
      onReopen={() => onReopen(t.id)}
    />
  );

  const draft: ThreadView | null = composer
    ? {
        id: "draft",
        blockId: composer.blockId,
        quote: composer.quote ?? null,
        status: "open",
        originVersionNumber: 3,
        originRound: 1,
        originLabel: "v3",
        comments: [],
        orphaned: false,
      }
    : null;

  return (
    <section aria-label="Comments" className="mt-8">
      <SectionLabel right={open.length > 0 ? <span className="text-[12px] text-text-subtle">{open.length} open</span> : null}>
        Comments
      </SectionLabel>
      <ul className="mt-3 flex flex-col gap-2.5">
        {draft ? <Composer key={`${draft.blockId}:${draft.quote}`} thread={draft} onCancel={onCancelComposer} onPost={onPost} /> : null}
        {open.map(card)}
      </ul>
      {open.length === 0 && !draft ? <p className="text-[14px] leading-6 text-text-subtle">No open comments.</p> : null}
      {resolved.length > 0 ? (
        <div className="mt-3">
          <Button
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => setShowResolved((s) => !s)}
            className="-ml-2.5 gap-1.5 text-[13px] text-text-muted"
          >
            <ChevronDown data-icon="inline-start" strokeWidth={1.75} className={cn("transition-transform", !expanded && "-rotate-90")} />
            Resolved ({resolved.length})
          </Button>
          {expanded ? <ul className="mt-2 flex flex-col gap-2.5">{resolved.map(card)}</ul> : null}
        </div>
      ) : null}
    </section>
  );
}

// ── The panel ────────────────────────────────────────────────────

export interface RailProps {
  steps: StepView[];
  stages: StageCount;
  actions: ActionsAt;
  can: PermissionResult;
  contractChanges: ContractChange[];
  contractLines: string[];
  threads: ThreadView[];
  selectedId: string | null;
  composer: ComposerState | null;
  /** Past-tense line shown instead of the buttons once the decision is made. */
  decided: string | null;
  onSelect: (id: string) => void;
  onCancelComposer: () => void;
  onPost: (body: string) => void;
  onReply: (threadId: string, body: string) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  onApprove: () => void;
  onRequest: () => void;
  className?: string;
}

export function DecisionPanel(p: RailProps) {
  return (
    <aside
      aria-label="Decision"
      data-rail=""
      className={cn("flex min-h-0 flex-col border-l border-hairline bg-canvas", p.className)}
    >
      <div data-rail-head="" className="shrink-0 border-b border-hairline px-5 pt-[17px] pb-4">
        <Approval steps={p.steps} stages={p.stages} />
        {p.actions === "top" ? (
          <Actions className="mt-4" can={p.can} decided={p.decided} onApprove={p.onApprove} onRequest={p.onRequest} />
        ) : null}
      </div>
      <div data-rail-scroll="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-14">
        <Note />
        <Contract changes={p.contractChanges} lines={p.contractLines} />
        <Comments
          threads={p.threads}
          selectedId={p.selectedId}
          composer={p.composer}
          onSelect={p.onSelect}
          onCancelComposer={p.onCancelComposer}
          onPost={p.onPost}
          onReply={p.onReply}
          onResolve={p.onResolve}
          onReopen={p.onReopen}
        />
      </div>
      {/* The alternative: pinned under the rail, with room under the buttons for the Demo pill. */}
      {p.actions === "bottom" ? (
        <div className="shrink-0 border-t border-hairline px-5 pt-3 pb-16">
          <Actions can={p.can} decided={p.decided} onApprove={p.onApprove} onRequest={p.onRequest} />
        </div>
      ) : null}
    </aside>
  );
}
