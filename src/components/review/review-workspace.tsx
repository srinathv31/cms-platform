"use client";

import { Activity, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useReducedMotion } from "motion/react";
import { COMPOSER_THREAD_ID, ThreadList, blockTextOf, useReviewThreads, type ComposerOutcome } from "@/components/comments";
import { redlineSummary } from "@/components/redline";
import { SampleSetSwitcher, findSet, listSets, resolveSetValues, type SampleSetSwitcherHandle } from "@/components/preview/sample-sets";
import { diffDocuments, nameChange } from "@/domain/redline";
import { DOCUMENT_THREAD, type Person, type ReviewScreenData } from "@/domain/review-types";
import type { Channel, VersionState } from "@/domain/types";
import type { CommentRequest, DocumentEditorHandle } from "@/editor/types";
import { ApproveDialog, type Approved } from "./approve-dialog";
import { BlockCommentMenu } from "./block-comment-menu";
import { DecisionBar } from "./decision-bar";
import { approvalStage, decisionAccess, decisionLine, type LocalDecision } from "./decision-model";
import { DecisionRail } from "./decision-rail";
import { DocumentView } from "./document-view";
import { GoLive } from "./go-live";
import { PreviewView } from "./preview-view";
import { SectionLabel, ContractSection, NameSection, SubmitNote } from "./rail-sections";
import { RequestChangesDialog } from "./request-dialog";
import { ReviewHeader } from "./review-header";
import { RV } from "./review-grid";
import { ChangeToggles, ViewTabs, type ReviewView } from "./view-tabs";

/**
 * The review screen, as the cells of its grid (review-grid.ts): the header, the view tabs, the
 * document or the output, and the decision rail. It holds the screen's client state: which view,
 * the redline switches, the comment threads, which sample sets were looked at, the two decision
 * dialogs, and the go-live moment.
 *
 * The server's data (`data`) is the truth and arrives anew after every action (the actions refresh the
 * page); what is kept here is what the viewer did on this screen: "You approved v3.", and the moment's
 * own clock.
 */

/** Scrolls the canvas (the page's own scroll area, not the window) to its top. */
function scrollCanvasToTop(from: HTMLElement | null) {
  for (let node = from?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      node.scrollTo({ top: 0 });
      return;
    }
  }
}

type GoLiveStage =
  /** Nothing is going on. */
  | "idle"
  /** The final approval is on its way: the header holds its state until the moment can play. */
  | "armed"
  /** The moment is playing. */
  | "playing";

export function ReviewWorkspace({
  data,
  team,
  nowIso,
  viewer,
}: {
  data: ReviewScreenData;
  team: string;
  nowIso: string;
  /** Who is looking. */
  viewer: Person;
}) {
  const { template, version, baseline, steps, can, consumerUsage, today } = data;
  const reduceMotion = useReducedMotion();
  const stage = useMemo(() => approvalStage(steps), [steps]);

  // ── Views ───────────────────────────────────────────────────────

  const [view, setView] = useState<ReviewView>("document");
  // The output is built the first time it is looked at, then kept (its last render stays up).
  const [previewVisited, setPreviewVisited] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [changesOnly, setChangesOnly] = useState(false);

  const redline = useMemo(
    () => (baseline ? diffDocuments(baseline.body, version.body) : null),
    [baseline, version.body],
  );
  const changeCount = redline ? redline.counts.added + redline.counts.removed + redline.counts.changed + redline.counts.moved : 0;
  // The name is versioned: a rename against what customers get today is reviewed like the rest.
  const rename = nameChange(data.liveName, version.name);

  // ── Sample sets, for the Preview ────────────────────────────────

  const sets = useMemo(() => listSets(version.sampleSets, version.variables, today), [version.sampleSets, version.variables, today]);
  const [setId, setSetId] = useState("typical");
  const selectedSet = findSet(sets, setId) ?? findSet(sets, "typical") ?? sets[0];
  const values = useMemo(() => resolveSetValues(selectedSet, version.variables, today), [selectedSet, version.variables, today]);
  const [seen, setSeen] = useState<string[]>([]);
  const onSeen = useCallback((id: string) => setSeen((all) => (all.includes(id) ? all : [...all, id])), []);
  const switcher = useRef<SampleSetSwitcherHandle>(null);
  const channels: Channel[] = version.channels.length > 0 ? version.channels : ["pdf"];

  // ── Comments ────────────────────────────────────────────────────

  const editorRef = useRef<DocumentEditorHandle>(null);
  const { threads, threadsForEditor, editorActiveThreadId, activeThreadId, setActive, composer, openComposer, closeComposer, mutate } =
    useReviewThreads(data.threads);
  // Comments belong to the review: once the version has been decided it is a record, and its threads are read-only
  // (the author answers them in the new draft). The server decides it with the rest of the screen.
  const canComment = can.comment.ok;
  const openThreads = threads.filter((t) => t.status === "open").length;

  // Where a block sits in the document, so a new thread slots into document order at once.
  const blockPosition = useMemo(() => {
    const order = new Map<string, number>();
    (version.body.content ?? []).forEach((block, i) => {
      const id = block.attrs?.id;
      if (typeof id === "string") order.set(id, i);
    });
    return (blockId: string) => order.get(blockId) ?? null;
  }, [version.body]);

  // The start of a block's text, for the card about a whole block (it has no quote to show).
  const labels = useMemo(() => new Map(version.variables.map((v) => [v.key, v.label])), [version.variables]);
  const blockText = useCallback((blockId: string) => blockTextOf(version.body, blockId, labels), [version.body, labels]);

  // A click on the quote the comment box is about (its temporary highlight) isn't a thread.
  const onThreadClick = useCallback((id: string) => id !== COMPOSER_THREAD_ID && setActive(id), [setActive]);

  /** What had focus when the comment box opened: it gets focus back when the box closes. */
  const opener = useRef<HTMLElement | null>(null);
  /** A thread to scroll into view once the document is on screen. */
  const focusPending = useRef<string | null>(null);
  /** Bumped to render again when nothing else changed (the thread was already the active one): the scroll runs after a commit. */
  const [, askForFocus] = useState(0);
  const requestComment = useCallback(
    (anchor: CommentRequest) => {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      openComposer(anchor);
    },
    [openComposer],
  );
  // The box was posted or cancelled (the list says which). Posted: the list moves focus to the new thread's card, so
  // nothing here may take it back. Cancelled: focus goes back to what opened the box.
  const onComposerClose = useCallback(
    (outcome?: ComposerOutcome) => {
      closeComposer();
      const el = opener.current;
      opener.current = null;
      if (outcome === "posted") return;
      // The opener can be gone (the selection's Comment button closes with the box): the document is the next best place.
      requestAnimationFrame(() => (el?.isConnected ? el.focus() : editorRef.current?.focus()));
    },
    [closeComposer],
  );
  // Whichever shows the document answers the handle: the editor, or (Show changes on) the redline's own.
  const requestBlockComment = useCallback((blockId: string) => editorRef.current?.requestComment(blockId), []);

  // The menu in the rail: the keyboard path to a comment on a block. It brings the document to the block
  // (the redline stays on: it scrolls there too). The menu has closed by now, so the button is named as the
  // opener: cancelled, focus goes back to it; posted, to the new thread's card.
  const menuButton = useRef<HTMLButtonElement>(null);
  const pickBlock = useCallback(
    (blockId: string) => {
      opener.current = menuButton.current;
      openComposer({ blockId }, menuButton.current);
      focusPending.current = COMPOSER_THREAD_ID;
    },
    [openComposer],
  );

  // A thread chosen in the rail or on a marker: bring the document to it (it may be showing the output),
  // then scroll it into view. With Show changes on, the redline stays and scrolls to the block.
  const activate = useCallback(
    (id: string | null) => {
      setActive(id);
      if (!id) return;
      const thread = threads.find((t) => t.id === id);
      if (!thread || thread.blockId === DOCUMENT_THREAD || thread.orphaned) return;
      focusPending.current = id;
      setView("document");
      askForFocus((n) => n + 1);
    },
    [setActive, threads],
  );
  // Runs after every commit: the document is on screen by now.
  useEffect(() => {
    const id = focusPending.current;
    if (!id) return;
    focusPending.current = null;
    editorRef.current?.focusThread(id);
  });

  // The block the redline tints: where the open comment box is, else the active thread's block.
  const activeBlockId = useMemo(() => {
    if (composer) return composer.blockId;
    const thread = threads.find((t) => t.id === activeThreadId);
    return thread && thread.blockId !== DOCUMENT_THREAD && !thread.orphaned ? thread.blockId : null;
  }, [composer, threads, activeThreadId]);

  // ── Decisions and the go-live moment ────────────────────────────

  const [dialog, setDialog] = useState<"approve" | "request" | null>(null);
  const [local, setLocal] = useState<LocalDecision>(null);
  const [goLive, setGoLive] = useState<GoLiveStage>("idle");
  const [flipped, setFlipped] = useState(false);

  const approveButton = useRef<HTMLButtonElement>(null);
  const requestButton = useRef<HTMLButtonElement>(null);
  const decisionRegion = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  /** The decision went through: the opener is gone, so focus goes to the place it stood. */
  const decided = useRef(false);
  /** The button a dialog was opened from, when it isn't the rail's (the stacked layout's bar has its own pair). */
  const dialogOpener = useRef<HTMLElement | null>(null);

  function openDialog(which: "approve" | "request", from: HTMLElement | null = null) {
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
    if (!wentLive) {
      setGoLive("idle");
      return;
    }
    if (reduceMotion) {
      // The end state at once: Active, the ring in its slot.
      setGoLive("idle");
      return;
    }
    scrollCanvasToTop(slotRef.current);
    setFlipped(false);
    setGoLive("playing");
  }

  // The decision went through: the buttons the dialog came from are replaced by a line, and focus goes
  // to the place they stood. (The dialog's own return of focus can land on a button just as it goes.)
  const line = decisionLine({
    state: version.state,
    number: version.number,
    authorName: version.submittedBy.name,
    local,
    canDecideAgain: can.approve.ok,
  });
  useEffect(() => {
    if (line !== null && decided.current) decisionRegion.current?.focus({ preventScroll: true });
  }, [line]);

  // The state the header shows. The server's moves to Active the moment the approval lands, behind the
  // go-live moment's wash; the header waits for the moment's own flip.
  const access = decisionAccess(can.approve, can.requestChanges);
  const held = goLive !== "idle" && !flipped;
  const shownState: VersionState = held ? "in_review" : version.state;
  const ring = version.state === "active" && goLive === "idle";


  // ── The view tabs ───────────────────────────────────────────────

  function pickView(next: ReviewView) {
    setView(next);
    if (next === "preview") {
      setPreviewVisited(true);
      // The comment box is about the document; the person is on the tab they pressed, so focus stays there.
      opener.current = null;
      closeComposer();
    }
  }

  const tools =
    view === "preview" ? (
      <SampleSetSwitcher
        ref={switcher}
        readOnly
        sets={sets}
        variables={version.variables}
        today={today}
        selectedId={selectedSet.id}
        onSelect={setSetId}
      />
    ) : baseline ? (
      <ChangeToggles
        baselineNumber={baseline.number}
        showChanges={showChanges}
        onShowChanges={setShowChanges}
        changesOnly={changesOnly}
        onChangesOnly={setChangesOnly}
        count={changeCount}
        summary={redline ? redlineSummary(redline.counts) : ""}
      />
    ) : null;

  return (
    <>
      <ReviewHeader
        team={team}
        templateId={template.id}
        templateName={version.name}
        versionNumber={version.number}
        state={shownState}
        sunsetDay={version.sunsetDay ?? null}
        author={version.submittedBy}
        submittedAt={version.submittedAt}
        nowIso={nowIso}
        ring={ring}
        slotRef={slotRef}
      />

      <div data-slot="tab-bar" className={RV.tabs}>
        <ViewTabs value={view} onChange={pickView} previewMounted={previewVisited} />
        <div className="ml-auto min-w-0 pt-1.5">{tools}</div>
      </div>

      <Activity mode={view === "document" ? "visible" : "hidden"}>
        <DocumentView
          versionId={version.id}
          body={version.body}
          variables={version.variables}
          baselineVariables={baseline?.variables ?? null}
          redline={showChanges ? redline : null}
          changesOnly={changesOnly}
          editorRef={editorRef}
          anchors={threadsForEditor}
          activeThreadId={editorActiveThreadId}
          threads={threads}
          activeBlockId={activeBlockId}
          onThreadClick={onThreadClick}
          onActivate={activate}
          onRequestComment={canComment ? requestComment : undefined}
          onRequestBlockComment={canComment ? requestBlockComment : undefined}
        />
      </Activity>
      {previewVisited ? (
        <Activity mode={view === "preview" ? "visible" : "hidden"}>
          <PreviewView
            templateId={template.id}
            versionNumber={version.number}
            teamName={template.teamName}
            channels={channels}
            variables={version.variables}
            values={values}
            setId={selectedSet.id}
            enabled={view === "preview"}
            onSeen={onSeen}
            onEditValues={() => switcher.current?.openEditor()}
          />
        </Activity>
      ) : null}

      <DecisionBar
        access={access}
        line={line}
        decidedHere={local !== null}
        onApprove={(from) => openDialog("approve", from)}
        onRequest={(from) => openDialog("request", from)}
      />

      <DecisionRail
        steps={steps}
        nowIso={nowIso}
        access={access}
        line={line}
        onApprove={() => openDialog("approve")}
        onRequest={() => openDialog("request")}
        approveRef={approveButton}
        requestRef={requestButton}
        regionRef={decisionRegion}
      >
        {version.submitNote ? <SubmitNote author={version.submittedBy} note={version.submitNote} /> : null}
        {rename ? <NameSection className={version.submitNote ? "mt-8" : undefined} change={rename} /> : null}
        <ContractSection
          className={version.submitNote || rename ? "mt-8" : undefined}
          changes={version.contractChanges}
          lines={version.contractLines}
          first={version.number === 1}
        />
        <section aria-labelledby="review-comments" className="mt-8">
          <SectionLabel
            id="review-comments"
            right={
              <div className="flex items-center gap-3">
                {openThreads > 0 ? <span className="text-[12px] text-text-subtle">{openThreads} open</span> : null}
                {canComment && view === "document" ? (
                  <BlockCommentMenu body={version.body} variables={version.variables} onPick={pickBlock} triggerRef={menuButton} />
                ) : null}
              </div>
            }
          >
            Comments
          </SectionLabel>
          <ThreadList
            className="mt-3"
            threads={threads}
            activeThreadId={activeThreadId}
            onActivate={activate}
            canComment={canComment}
            composer={composer}
            onComposerClose={onComposerClose}
            templateId={template.id}
            versionId={version.id}
            viewer={viewer}
            now={nowIso}
            blockText={blockText}
            blockPosition={blockPosition}
            onMutate={mutate}
          />
        </section>
      </DecisionRail>

      <ApproveDialog
        open={dialog === "approve"}
        onOpenChange={(open) => !open && setDialog(null)}
        templateId={template.id}
        versionNumber={version.number}
        previousNumber={baseline?.number ?? null}
        contractChanges={version.contractChanges}
        stage={stage}
        usage={consumerUsage}
        sunsetCalendar={data.sunsetCalendar}
        nowIso={nowIso}
        sampleSetsSeen={seen}
        // The server's data moves to Active the moment the approval lands; the header holds until the moment plays.
        onBegin={() => stage.final && !reduceMotion && setGoLive("armed")}
        onApproved={onApproved}
        onFailed={() => setGoLive("idle")}
        finalFocus={() => returnFocus(approveButton)}
      />
      <RequestChangesDialog
        open={dialog === "request"}
        onOpenChange={(open) => !open && setDialog(null)}
        templateId={template.id}
        versionNumber={version.number}
        authorName={version.submittedBy.name}
        onRequested={() => {
          decided.current = true;
          setLocal({ kind: "returned" });
        }}
        finalFocus={() => returnFocus(requestButton)}
      />

      {goLive === "playing" ? (
        <GoLive
          versionNumber={version.number}
          slotRef={slotRef}
          onFlip={() => setFlipped(true)}
          onDone={() => {
            setGoLive("idle");
            setFlipped(false);
          }}
        />
      ) : null}
    </>
  );
}
