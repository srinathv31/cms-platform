"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useReducedMotion } from "motion/react";
import { DOCUMENT_THREAD, type ThreadView } from "@/domain/review-types";
import type { PermissionResult, VersionState } from "@/domain/types";
import { cn } from "@/lib/utils";
import { ApproveDialog, RequestDialog } from "./dialogs";
import { DevBar } from "./dev-bar";
import { DocView, type CommentRequest } from "./doc-view";
import {
  CONTRACT_CHANGES,
  CONTRACT_LINES,
  JORDAN,
  MAYA,
  NOW_MS,
  REDLINE,
  SAMPLE_SETS,
  THREADS,
  VERSION,
  stepsFor,
} from "./fixtures";
import { GoLive } from "./go-live";
import { ReviewHeader } from "./header";
import { OutputView, SampleSets } from "./output-view";
import { DecisionPanel, type ComposerState } from "./rail";
import { ReviewShell } from "./shell";
import { ChangeToggles, ViewTabs, type TabSpec } from "./tab-bar";
import type { ActionsAt, ChannelId, DeviceId, DialogId, Outcome, PersonaId, ReviewInitial, StageCount, VariantId, ViewId } from "./types";

/*
 * The review screen, two ways. Both: the version's header, view tabs over the main pane, the decision
 * panel as the right rail (the workspace's Rail layout), the same dialogs and the same go-live moment.
 *
 *   A  Document first   Document | Preview. Show changes turns the document into the redline.
 *   B  Output first     Output | Redline | Document. Opens on the rendered PDF.
 *
 * Below 56rem of workspace width (the workspace's own breakpoint) the rail stacks under the main pane.
 */

const NARROW_BELOW = 896;
const BLOCK_ORDER = new Map(REDLINE.blocks.map((b, i) => [b.id, i] as const));

const TABS: Record<VariantId, TabSpec[]> = {
  a: [
    { id: "document", label: "Document" },
    { id: "preview", label: "Preview" },
  ],
  b: [
    { id: "preview", label: "Output" },
    { id: "redline", label: "Redline" },
    { id: "document", label: "Document" },
  ],
};

function useWidth(ref: React.RefObject<HTMLElement | null>, fallback: number) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const iso = (offsetMs: number) => new Date(NOW_MS + offsetMs).toISOString();

export function ReviewMock({ initial }: { initial: ReviewInitial }) {
  const reduce = useReducedMotion();

  // Dev controls.
  const [variant, setVariant] = useState<VariantId>(initial.variant);
  const [persona, setPersona] = useState<PersonaId>(initial.persona);
  const [stages, setStages] = useState<StageCount>(initial.stages);
  const [actions, setActions] = useState<ActionsAt>(initial.actions);

  // The screen.
  const [view, setView] = useState<ViewId>(initial.view);
  const [changesOnly, setChangesOnly] = useState(initial.changesOnly);
  const [dialog, setDialog] = useState<DialogId>(initial.dialog);
  const [channel, setChannel] = useState<ChannelId>("pdf");
  const [device, setDevice] = useState<DeviceId>("desktop");
  const [setId, setSetId] = useState(SAMPLE_SETS[0].id);

  // The decision.
  const [outcome, setOutcome] = useState<Outcome>("review");
  const [flipped, setFlipped] = useState(false);

  // Comments.
  const [threads, setThreads] = useState<ThreadView[]>(THREADS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [flashBlock, setFlashBlock] = useState<string | null>(null);
  const counter = useRef(1);
  /** What had focus when the comment box opened: it gets focus back when the box closes. */
  const opener = useRef<HTMLElement | null>(null);

  const wsRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const width = useWidth(wsRef, 1162);
  const narrow = width < NARROW_BELOW;

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  // ── Who, and what state ────────────────────────────────────────

  const me = persona === "maya" ? MAYA : JORDAN;
  const can: PermissionResult = persona === "maya" ? { ok: false, code: "submitted_version", reason: "You submitted this version." } : { ok: true };

  const live = outcome === "active" || (outcome === "live" && flipped);
  const status: VersionState = outcome === "returned" ? "changes_requested" : live ? "active" : "in_review";
  const stageDone = live ? stages : outcome === "stage-approved" ? 1 : 0;
  const steps = stepsFor(stages, stageDone, outcome === "returned");
  const decided =
    outcome === "review"
      ? null
      : outcome === "returned"
        ? `You returned v${VERSION} to ${MAYA.name}.`
        : outcome === "stage-approved"
          ? "You approved this stage. Legal reviewer is next."
          : `You approved v${VERSION}.`;
  const badge = persona === "jordan" && outcome === "review" ? 1 : 0;

  const ordered = [...threads].sort(
    (a, b) =>
      (a.blockId === DOCUMENT_THREAD ? -1 : (BLOCK_ORDER.get(a.blockId) ?? 999)) -
      (b.blockId === DOCUMENT_THREAD ? -1 : (BLOCK_ORDER.get(b.blockId) ?? 999)),
  );

  // ── Decisions ──────────────────────────────────────────────────

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setOutcome("review");
    setFlipped(false);
    setThreads(THREADS);
    setSelectedId(null);
    setComposer(null);
    setFlashBlock(null);
    setDialog("none");
  }

  function startGoLive() {
    mainRef.current?.scrollTo({ top: 0 });
    setFlipped(false);
    setOutcome(reduce ? "active" : "live");
  }

  function replay() {
    reset();
    later(startGoLive, 450);
  }

  function confirmApprove() {
    setDialog("none");
    if (stages === 2 && stageDone === 0) setOutcome("stage-approved");
    else startGoLive();
  }

  function confirmRequest(reason: string) {
    setDialog("none");
    setOutcome("returned");
    setThreads((all) => [
      {
        id: "t-reason",
        blockId: DOCUMENT_THREAD,
        quote: null,
        status: "open",
        originVersionNumber: VERSION,
        originRound: 1,
        originLabel: `v${VERSION}`,
        orphaned: false,
        comments: [{ id: "c-reason", author: JORDAN, kind: "change_request", body: reason, createdAt: iso(0) }],
      },
      ...all,
    ]);
  }

  // ── Comments ───────────────────────────────────────────────────

  function focusBlock(blockId: string) {
    if (blockId === DOCUMENT_THREAD) return;
    setFlashBlock(blockId);
    later(() => setFlashBlock(null), 1600);
    // The block may not be on screen: another view, or filtered out by Changes only.
    pendingScroll.current = blockId;
    if (view === "preview") setView("document");
    if (changesOnly && view !== "preview") setChangesOnly(false);
  }

  // Runs after every commit: scrolls once the block is on screen.
  useEffect(() => {
    const id = pendingScroll.current;
    if (!id) return;
    const el = mainRef.current?.querySelector(`[data-block-id="${id}"]`);
    if (!el) return;
    pendingScroll.current = null;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  });

  function startComment(request: CommentRequest) {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setSelectedId(null);
    setComposer(request);
  }

  function closeComposer() {
    setComposer(null);
    opener.current?.focus();
    opener.current = null;
  }

  function post(body: string) {
    if (!composer) return;
    const id = `n${counter.current++}`;
    setThreads((all) => [
      ...all,
      {
        id,
        blockId: composer.blockId,
        quote: composer.quote ?? null,
        status: "open",
        originVersionNumber: VERSION,
        originRound: 1,
        originLabel: `v${VERSION}`,
        orphaned: false,
        comments: [{ id: `${id}-1`, author: me, kind: "comment", body, createdAt: iso(60_000) }],
      },
    ]);
    setSelectedId(id);
    closeComposer();
  }

  function reply(threadId: string, body: string) {
    setThreads((all) =>
      all.map((t) =>
        t.id === threadId
          ? { ...t, comments: [...t.comments, { id: `${threadId}-${t.comments.length + 1}`, author: me, kind: "comment", body, createdAt: iso(60_000) }] }
          : t,
      ),
    );
  }

  const setStatus = (threadId: string, next: "open" | "resolved") =>
    setThreads((all) =>
      all.map((t) =>
        t.id === threadId
          ? { ...t, status: next, resolvedBy: next === "resolved" ? me : undefined, resolvedAt: next === "resolved" ? iso(60_000) : undefined }
          : t,
      ),
    );

  // ── Views ──────────────────────────────────────────────────────

  const showChanges = view === "redline";
  const tabs = TABS[variant];
  const tabValue: ViewId = variant === "a" && view === "redline" ? "document" : view;

  const pickView = (next: ViewId) => {
    setView(next);
    if (next === "preview") setComposer(null);
  };

  const tools =
    view === "preview" ? (
      <SampleSets setId={setId} onSet={setSetId} />
    ) : variant === "a" ? (
      <ChangeToggles
        showChanges={showChanges}
        onShowChanges={(on) => setView(on ? "redline" : "document")}
        changesOnly={changesOnly}
        onChangesOnly={setChangesOnly}
        withShow
      />
    ) : view === "redline" ? (
      <ChangeToggles showChanges changesOnly={changesOnly} onShowChanges={() => {}} onChangesOnly={setChangesOnly} withShow={false} />
    ) : null;

  const content =
    view === "preview" ? (
      <OutputView channel={channel} onChannel={setChannel} device={device} onDevice={setDevice} setId={setId} bleed={variant === "b"} />
    ) : (
      <div className="pt-8 pb-[max(3.5rem,40svh)]">
        <DocView
          blocks={REDLINE.blocks}
          redline={showChanges}
          changesOnly={showChanges && changesOnly}
          threads={ordered}
          selectedId={selectedId}
          composerBlock={composer?.blockId ?? null}
          flashBlock={flashBlock}
          onSelectThread={(id) => setSelectedId(id)}
          onComment={startComment}
        />
      </div>
    );

  const gutter = narrow ? "pr-6" : "pr-10";

  return (
    <div className="bg-app" style={{ "--rv-dev-h": initial.chrome ? "2.5rem" : "0rem" } as CSSProperties}>
      {initial.chrome ? (
        <DevBar
          variant={variant}
          onVariant={setVariant}
          persona={persona}
          onPersona={setPersona}
          stages={stages}
          onStages={(next) => {
            setStages(next);
            reset();
          }}
          actions={actions}
          onActions={setActions}
          view={view}
          onView={pickView}
          dialog={dialog}
          onDialog={setDialog}
          onReplay={replay}
          onReset={reset}
        />
      ) : null}
      <ReviewShell
        person={me}
        badge={badge}
        overlay={
          outcome === "live" ? (
            <GoLive slotRef={slotRef} onFlip={() => setFlipped(true)} onDone={() => setOutcome("active")} />
          ) : null
        }
      >
        <div
          ref={wsRef}
          data-workspace=""
          data-variant={variant}
          data-narrow={narrow ? "" : undefined}
          className={cn("relative flex min-h-0 flex-1", narrow && "flex-col overflow-y-auto overscroll-contain")}
        >
          <main
            ref={mainRef}
            aria-label="Version under review"
            className={cn("min-w-0", narrow ? "flex-none" : "flex-1 overflow-y-auto overscroll-contain")}
          >
            <div className={cn("pl-[68px]", gutter)}>
              <div className="max-w-(--doc-width)">
                <ReviewHeader status={status} ring={outcome === "active"} slotRef={slotRef} />
              </div>
            </div>
            <div className={cn("sticky top-0 z-20 bg-canvas pl-[68px]", gutter)}>
              <div className="@container/bar flex min-h-11 max-w-(--doc-width) flex-wrap items-start justify-between gap-x-6 border-b border-hairline">
                <ViewTabs tabs={tabs} value={tabValue} onChange={pickView} group={variant} />
                <div className="ml-auto pt-1.5 @max-[29rem]/bar:pb-2">{tools}</div>
              </div>
            </div>
            <div className={cn("pl-[68px]", gutter)}>
              <div className="max-w-(--doc-width)">{content}</div>
            </div>
          </main>
          <DecisionPanel
            className={narrow ? "shrink-0 border-t border-l-0" : "w-88 shrink-0"}
            steps={steps}
            stages={stages}
            actions={actions}
            can={can}
            contractChanges={CONTRACT_CHANGES}
            contractLines={CONTRACT_LINES}
            threads={ordered}
            selectedId={selectedId}
            composer={composer}
            decided={decided}
            onSelect={(id) => {
              setSelectedId(id);
              const thread = threads.find((t) => t.id === id);
              if (thread) focusBlock(thread.blockId);
            }}
            onCancelComposer={closeComposer}
            onPost={post}
            onReply={reply}
            onResolve={(id) => setStatus(id, "resolved")}
            onReopen={(id) => setStatus(id, "open")}
            onApprove={() => setDialog("approve")}
            onRequest={() => setDialog("request")}
          />
        </div>
      </ReviewShell>

      <ApproveDialog
        open={dialog === "approve" && can.ok}
        onOpenChange={(open) => !open && setDialog("none")}
        stages={stages}
        final={stages === 1 || stageDone === 1}
        initialSunset={initial.sunset}
        onConfirm={confirmApprove}
      />
      <RequestDialog
        open={dialog === "request" && can.ok}
        onOpenChange={(open) => !open && setDialog("none")}
        onConfirm={confirmRequest}
      />
    </div>
  );
}

