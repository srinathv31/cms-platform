"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { blockTextOf } from "@/components/comments/block-text";
import { GutterMarkers } from "@/components/comments/gutter-markers";
import { ThreadList, type ComposerOutcome } from "@/components/comments/thread-list";
import { openCount } from "@/components/comments/thread-state";
import { COMPOSER_THREAD_ID, useReviewThreads } from "@/components/comments/use-review-threads";
import { PreviewSurface } from "@/components/preview/preview-surface";
import { phoneSenders } from "@/components/preview/preview-sender";
import { CHANNEL_FIELD_IDS, channelFieldValues, type ChannelFieldValues, type ChannelFields } from "@/domain/channel-fields";
import type { ImportOriginalRef } from "@/domain/import-types";
import type { MessageTypeRules, TeamSenders } from "@/domain/platform-config";
import type { Person, ThreadView } from "@/domain/review-types";
import type { Channel, ChannelFamily, JSONContent, RequiredSection, SampleSet, Variable } from "@/domain/types";
import type { CommentRequest, DocumentEditorHandle } from "@/editor/types";
import { cn } from "@/lib/utils";
import { CopilotPromptButton } from "../copilot/copilot-prompt";
import { takeJustImported } from "../just-imported";
import { createLiveDraft } from "../session/live-draft";
import { useInert, usePreviewState, useWorkspaceSession } from "../session/workspace-session";
import { WS } from "../workspace-grid";
import { ChannelSelector } from "./channels";
import { DocumentBody, EditorScope, HistoryBridge, VariablesSection } from "./editor-adapter";
import { EmailDetails } from "./email-details";
import { MessageComposer } from "./message-composer";
import { Rail } from "./rail";

/** The fields this page shows, which a revert can put back: every channel field among them, by id. */
const CONTENT_FIELDS = ["body", "variables", "channels", ...CHANNEL_FIELD_IDS, "sampleSets"] as const;

/** The app's one scrolling element (AppFrame's canvas), which the document scrolls in. */
const canvasElement = () => document.querySelector<HTMLElement>('[data-slot="canvas-scroll"]');

export interface ContentWorkspaceProps {
  templateId: string;
  /** The team's name: the email preview's sender. */
  teamName: string;
  versionId: string;
  /** The shown version's number; null for an open draft (the preview renders "draft"). */
  versionNumber: number | null;
  /** Where autosave starts. */
  rev: number;
  body: JSONContent;
  variables: Variable[];
  baseline: Variable[] | null;
  requiredSections: RequiredSection[];
  channels: Channel[];
  allowedChannels: Channel[];
  /** A document (the editor) or a message (the composer): the content type's family, for the template's whole life. */
  family: ChannelFamily;
  /** Each channel's own fields, as the version stores them (src/domain/channel-fields.ts). */
  channelFields: ChannelFields;
  /** The content type's SMS footer and part budget (a message's composer and preview). */
  messageRules: MessageTypeRules;
  /** Who the team's messages come from on the phone preview. */
  senders: TeamSenders;
  sampleSets: SampleSet[];
  /** The demo clock's date, YYYY-MM-DD. */
  today: string;
  /** An open draft the viewer can edit. Otherwise everything is read-only and nothing autosaves. */
  editable: boolean;
  /** The template's review threads against the shown version (change requests, comments, resolved ones). */
  threads: ThreadView[];
  /** The viewer may comment: reply, resolve, reopen, and start a thread (the Comment button). */
  canComment: boolean;
  /** The viewer, for the comments they write before the server confirms them. */
  viewer: Person;
  /** The demo clock's now (ISO): "3h ago" is measured from it. */
  now: string;
  /** The file the template was imported from (the rail's Original tab), on every version; null when it wasn't imported. */
  importOriginal: ImportOriginalRef | null;
  /** The shown version is in review: the rail links to its review screen. */
  reviewHref?: string | null;
}

/**
 * The Content tab: two cells of the workspace grid, the document and the rail. They sit in one
 * subtree so they share one editor root (one variable list), and they save through the workspace's
 * single autosave session. The preview lives in the rail (it widens into it), in that same root, so it
 * renders with the live variable list. The server component that renders this passes a key made of the version
 * and whether it is editable, so a different version, or the same one turning read-only (submitted),
 * is a fresh editor.
 *
 * A message template (an Alert, `family` "message") has no document: the first cell is the message
 * composer instead (message-composer.tsx), its fields in the same root. The fields as typed and the
 * sample sets live in a live draft (session/live-draft.ts) the composer writes and the preview reads,
 * so Push and SMS render in the browser on every keystroke (decision 0035).
 *
 * Review comments (src/components/comments) live here too: the document gets highlights and markers
 * in its right gutter, the rail gets the thread list (a Comments view beside Variables, and in the
 * preview's header), and one `useReviewThreads` state ties them: the active thread, and the composer
 * the editor's Comment button opens. A click on a highlight or a marker brings the thread's card into
 * the rail (switching it to Comments); choosing a card scrolls the document to the quote.
 *
 * Undo and redo for the header's buttons come from the editor root (`HistoryBridge`). "Revert to when
 * you opened it" (the header's save status menu) puts this page's fields back to how they were when
 * it mounted: the session hands the values over (`restore`), and everything inside the editor root
 * remounts with them (`shown.gen` is its key), since the root and the fields read their values once.
 *
 * While the session is inert (Submit is reading or freezing the saved draft, or saving stopped for
 * good), an editable page shows read-only without remounting: the editor root (the document, the
 * email fields, the variables panel, undo and redo), the channels and the sample sets. Text can still
 * be selected and copied. It stays bound, so autosave keeps sending what was typed before, and it is
 * editable again, history and all, when the hold is let go.
 */
export function ContentWorkspace({
  templateId,
  teamName,
  versionId,
  versionNumber,
  rev,
  body,
  variables,
  baseline,
  requiredSections,
  channels: initialChannels,
  allowedChannels,
  family,
  channelFields,
  messageRules,
  senders,
  sampleSets,
  today,
  editable,
  threads,
  canComment,
  viewer,
  now,
  importOriginal,
  reviewHref = null,
}: ContentWorkspaceProps) {
  const session = useWorkspaceSession();
  const { open: previewOpen } = usePreviewState();
  const inert = useInert();
  // Editable right now: an editable draft, and nothing holding the page still.
  const editing = editable && !inert;

  // Arriving from an import, the rail opens widened on the Original view, with the import report at
  // its top (the name field selects the name, from its own cookie). The rail does it, before the first paint.
  const takeArrival = useCallback(
    () => importOriginal !== null && takeJustImported(templateId),
    [importOriginal, templateId],
  );

  // The header binds the draft it shows, on every tab. This page binds the one it edits too: after a
  // tab switch its data can be newer than the header's (the layout doesn't re-render), and what is
  // typed here must save. The same draft bound twice is one session. It never unbinds: the header
  // does, when its version can't be edited (see `bind` in session-store.ts).
  useEffect(() => {
    if (editable) session.bind({ versionId, rev });
  }, [session, editable, versionId, rev]);

  const [channels, setChannels] = useState(initialChannels);

  // What the editor root and its fields mount with: the page's values as it opened, then whatever a
  // revert (or undoing one) hands over. `gen` remounts them. Later props (a refresh) don't reset a draft being edited.
  // The channel fields are held flat, by id, as autosave saves them.
  const [opening] = useState(() => ({
    body,
    variables,
    channels: initialChannels,
    ...channelFieldValues(channelFields),
    sampleSets,
  }));
  const [shown, setShown] = useState(() => ({ gen: 0, ...opening }));

  // The draft as typed, ahead of autosave: what the phone preview and the composer's measurements read.
  // A new one when a revert remounts the fields with other values.
  const liveDraft = useMemo(
    () =>
      createLiveDraft({
        fields: Object.fromEntries(CHANNEL_FIELD_IDS.map((id) => [id, shown[id]])) as ChannelFieldValues,
        sampleSets: shown.sampleSets,
      }),
    [shown],
  );
  const message = family === "message";

  // A revert is pressed from a button, so it must not scroll the page. The old editor leaving shortens
  // the page for a moment, and the browser clamps the canvas's scroll: put it back as the new one lands.
  const keptScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    const top = keptScroll.current;
    keptScroll.current = null;
    const canvas = canvasElement();
    if (top !== null && canvas && canvas.scrollTop !== top) canvas.scrollTo({ top, behavior: "instant" });
  }, [shown.gen]);

  // ── Review comments: the state the document's highlights and markers, and the rail's list, share.
  const review = useReviewThreads(threads);
  const { setActive, openComposer, closeComposer, activeThreadId, trackDocument } = review;

  // The document as it is now: what the blocks say (a card about a whole block quotes the start of its text).
  const liveBody = useRef(body);
  const onBodyChange = useCallback(
    (doc: JSONContent) => {
      session.save({ body: doc });
      liveBody.current = doc;
      // A thread whose block was deleted moves to "On removed content" now, and back if undo restores the block.
      trackDocument(doc);
    },
    [session, trackDocument],
  );
  const onVariablesChange = useCallback(
    (next: Variable[]) => {
      if (editable) session.save({ variables: next });
    },
    [session, editable],
  );
  const onChannels = useCallback(
    (next: Channel[]) => {
      setChannels(next);
      session.save({ channels: next });
    },
    [session],
  );

  useEffect(() => {
    if (!editable) return;
    return session.addRestoreTarget({
      opening,
      restore: (fields, values) => {
        if (!CONTENT_FIELDS.some((key) => key in fields)) return;
        // A channel field's null is a value (cleared), so only a missing one falls back to the opening.
        const fieldValues = Object.fromEntries(
          CHANNEL_FIELD_IDS.map((id) => [id, values[id] === undefined ? opening[id] : values[id]]),
        ) as ChannelFieldValues;
        const next = {
          body: values.body ?? opening.body,
          variables: values.variables ?? opening.variables,
          channels: values.channels ?? opening.channels,
          ...fieldValues,
          sampleSets: values.sampleSets ?? opening.sampleSets,
        };
        liveBody.current = next.body;
        trackDocument(next.body);
        setChannels(next.channels);
        keptScroll.current = canvasElement()?.scrollTop ?? null;
        setShown((prev) => ({ gen: prev.gen + 1, ...next }));
      },
    });
  }, [session, editable, opening, trackDocument]);

  const open = openCount(review.threads);
  const hasComments = review.threads.length > 0 || review.composer !== null;

  // The document's handle: the session keeps one for the name field, the markers and the list read this one.
  const editorHandle = useRef<DocumentEditorHandle | null>(null);
  const setEditor = useCallback(
    (handle: DocumentEditorHandle | null) => {
      editorHandle.current = handle;
      session.setEditor(handle);
    },
    [session],
  );

  // A thread became active (a marker, a quote, a card, the caret): the document shows it. The handle leaves it alone when it is in view.
  useEffect(() => {
    if (activeThreadId) editorHandle.current?.focusThread(activeThreadId);
  }, [activeThreadId]);

  const showThread = useCallback(
    (id: string) => {
      setActive(id);
      session.showComments();
    },
    [setActive, session],
  );
  const onThreadClick = useCallback((id: string) => id !== COMPOSER_THREAD_ID && showThread(id), [showThread]);
  // The caret moving through quotes follows along without taking the rail away from Variables.
  const onCaretThreadChange = useCallback(
    (id: string | null) => {
      if (id !== COMPOSER_THREAD_ID) setActive(id);
    },
    [setActive],
  );
  const requestComment = useCallback(
    (anchor: CommentRequest) => {
      openComposer(anchor);
      session.showComments();
    },
    [openComposer, session],
  );
  // The composer came from the document. Cancelled, it puts the caret back there, at the end of the text it was about
  // (the selection would bring the format bubble straight back). Posted, focus goes to the new thread's card instead
  // (the list does that), so the caret stays out of it.
  const onComposerClose = useCallback(
    (outcome?: ComposerOutcome) => {
      closeComposer();
      if (outcome === "posted") return;
      editorHandle.current?.focus();
      // The editor puts its selection back a frame later (TipTap focuses on the next animation frame): collapse it after that.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed && selection.anchorNode?.parentElement?.closest(".ProseMirror")) {
            selection.collapseToEnd();
          }
        }),
      );
    },
    [closeComposer],
  );
  const blockPosition = useCallback((blockId: string) => editorHandle.current?.getBlockRect(blockId)?.top ?? null, []);
  const labels = useMemo(() => new Map(shown.variables.map((v) => [v.key, v.label])), [shown.variables]);
  const blockText = useCallback((blockId: string) => blockTextOf(liveBody.current, blockId, labels), [labels]);

  return (
    <EditorScope
      key={shown.gen}
      variables={shown.variables}
      baseline={baseline}
      requiredSections={requiredSections}
      readOnly={!editing}
      onVariablesChange={onVariablesChange}
    >
      {editable ? <HistoryBridge onChange={session.setHistory} /> : null}
      <div data-slot="editor" className={cn(WS.doc, "relative")}>
        {message ? (
          // A message has no document: its channels' own fields, in the same root.
          <MessageComposer
            channels={channels}
            editable={editable}
            values={shown}
            draft={liveDraft}
            today={today}
            rules={messageRules}
            appName={phoneSenders(senders, teamName).appName}
            editorRef={setEditor}
          />
        ) : (
          <>
            <DocumentBody
              content={shown.body}
              onChange={editable ? onBodyChange : undefined}
              editorRef={setEditor}
              comments={{
                threads: review.threadsForEditor,
                activeThreadId: review.editorActiveThreadId,
                onThreadClick,
                onCaretThreadChange,
                onRequestComment: canComment ? requestComment : undefined,
              }}
            />
            <GutterMarkers
              editor={editorHandle}
              threads={review.threads}
              activeThreadId={activeThreadId}
              onActivate={showThread}
              onRequestBlockComment={canComment ? (blockId) => requestComment({ blockId }) : undefined}
              compact={previewOpen}
              // Below the rail's breakpoint the rail is an overlay and the text runs to the panel's edge: no gutter.
              className="hidden @min-[53rem]/ws:block"
            />
          </>
        )}
      </div>
      <Rail
        comments={
          hasComments
            ? {
                count: open,
                preferred: open > 0 || review.composer !== null,
                panel: (
                  <ThreadList
                    threads={review.threads}
                    activeThreadId={activeThreadId}
                    onActivate={setActive}
                    canComment={canComment}
                    composer={review.composer}
                    onComposerClose={onComposerClose}
                    templateId={templateId}
                    versionId={versionId}
                    viewer={viewer}
                    now={now}
                    blockText={blockText}
                    blockPosition={blockPosition}
                    onMutate={review.mutate}
                  />
                ),
              }
            : null
        }
        channels={
          <ChannelSelector
            channels={channels}
            allowed={allowedChannels}
            editable={editable}
            disabled={!editing}
            onChange={onChannels}
          />
        }
        emailDetails={
          <EmailDetails on={channels.includes("email")} editable={editable} values={shown} />
        }
        original={importOriginal !== null}
        takeArrival={takeArrival}
        footer={editable ? <CopilotPromptButton templateId={templateId} /> : null}
        reviewHref={reviewHref}
        preview={
          <PreviewSurface
            templateId={templateId}
            versionNumber={versionNumber}
            teamName={teamName}
            channels={channels}
            editable={editing}
            draft={liveDraft}
            messageRules={messageRules}
            senders={senders}
            today={today}
            commentsCount={hasComments ? open : null}
            original={importOriginal}
          />
        }
      >
        <VariablesSection />
      </Rail>
    </EditorScope>
  );
}
