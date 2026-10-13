"use client";

// The Content tab's review comments: the one `useReviewThreads` state that ties the document's highlights and
// markers to the rail's thread list, and what each does for the other. A click on a highlight or a marker
// brings the thread's card into the rail (switching it to Comments); choosing a card scrolls the document to
// the quote; the comment box the editor's Comment button opens gives the caret back when it closes. A
// document's email subject and preheader sit in the rail, not in the text, and a message's fields have no
// blocks: their threads are on a field's id, and the hook knows a field from a block.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { blockTextOf, fieldTextOf } from "@/components/comments/block-text";
import type { ComposerOutcome } from "@/components/comments/thread-list";
import { openCount } from "@/components/comments/thread-state";
import {
  COMPOSER_THREAD_ID,
  useReviewThreads,
} from "@/components/comments/use-review-threads";
import { CHANNEL_FIELD_IDS, isChannelFieldId } from "@/domain/channel-fields";
import type { JSONContent, Variable } from "@/domain/types";
import type { CommentRequest, DocumentEditorHandle } from "@/editor/types";
import type { ThreadView } from "@/server/queries/threads";
import type { LiveDraft } from "../session/live-draft";
import type { WorkspaceSession } from "../session/session-store";
import type { FieldComments } from "./field-comments";

/** Before any block's position on screen: where a thread on a document's email field slots in. */
const FIELDS_FIRST = -1e9;

/**
 * `body` is the document the page opens with (`liveBody` follows it as it is typed and reverted). `message`: a
 * message has no document, so its threads are on its fields and nothing here follows a body.
 */
export function useContentComments({
  session,
  threads,
  canComment,
  body,
  message,
}: {
  session: WorkspaceSession;
  threads: ThreadView[];
  canComment: boolean;
  body: JSONContent;
  message: boolean;
}) {
  const review = useReviewThreads(threads);
  const {
    setActive,
    openComposer,
    closeComposer,
    activeThreadId,
    trackDocument,
  } = review;

  // The document as it is now: what the blocks say (a card about a whole block quotes the start of its text).
  const liveBody = useRef(body);
  /**
   * The document changed (typed, or a revert put one back): remember it, and let a thread whose block was
   * deleted move to "On removed content" now, and back if undo restores the block. A message has no body.
   */
  const bodyChanged = useCallback(
    (doc: JSONContent) => {
      liveBody.current = doc;
      if (!message) trackDocument(doc);
    },
    [message, trackDocument],
  );

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
  const onThreadClick = useCallback(
    (id: string) => id !== COMPOSER_THREAD_ID && showThread(id),
    [showThread],
  );
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

  const composerBlockId = review.composer?.blockId ?? null;
  // The composer came from the document. Cancelled, it puts the caret back there, at the end of the text it was about
  // (the selection would bring the format bubble straight back). Posted, focus goes to the new thread's card instead
  // (the list does that), so the caret stays out of it.
  const onComposerClose = useCallback(
    (outcome?: ComposerOutcome) => {
      closeComposer();
      if (outcome === "posted") return;
      // A box that came from a field in the rail isn't about the text: the list puts focus back where it began.
      if (
        !message &&
        composerBlockId !== null &&
        isChannelFieldId(composerBlockId)
      )
        return;
      editorHandle.current?.focus();
      // The editor puts its selection back a frame later (TipTap focuses on the next animation frame): collapse it after that.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const selection = window.getSelection();
          if (
            selection &&
            !selection.isCollapsed &&
            selection.anchorNode?.parentElement?.closest(".ProseMirror")
          ) {
            selection.collapseToEnd();
          }
        }),
      );
    },
    [closeComposer, composerBlockId, message],
  );

  // Where a block is on screen, to slot a new thread in among the others. A document's email fields come before
  // its blocks (`commentAnchors`), in the registry's order, wherever the rail puts them.
  const blockPosition = useCallback(
    (blockId: string) =>
      !message && isChannelFieldId(blockId)
        ? FIELDS_FIRST + CHANNEL_FIELD_IDS.indexOf(blockId)
        : (editorHandle.current?.getBlockRect(blockId)?.top ?? null),
    [message],
  );

  // The field a thread is on, for the composer's handle (a message's threads are on its fields).
  const latestThreads = useRef(review.threadsForEditor);
  useLayoutEffect(() => {
    latestThreads.current = review.threadsForEditor;
  });
  const threadField = useCallback(
    (id: string) =>
      latestThreads.current.find((t) => t.id === id)?.blockId ?? null,
    [],
  );

  // The comments on the email fields, which sit in the rail: their markers and the button that starts a thread.
  const fieldComments = useMemo<FieldComments>(
    () => ({
      threads: review.threads,
      activeThreadId,
      onActivate: showThread,
      onRequestComment: canComment
        ? (fieldId) => requestComment({ blockId: fieldId })
        : undefined,
    }),
    [review.threads, activeThreadId, showThread, canComment, requestComment],
  );

  /** What the Comment button and a marker's hover button ask for; absent when the viewer can't comment. */
  const onRequestComment = canComment ? requestComment : undefined;
  const onRequestBlockComment = canComment
    ? (blockId: string) => requestComment({ blockId })
    : undefined;

  return {
    threads: review.threads,
    threadsForEditor: review.threadsForEditor,
    activeThreadId,
    editorActiveThreadId: review.editorActiveThreadId,
    composer: review.composer,
    setActive,
    mutate: review.mutate,
    openCount: openCount(review.threads),
    hasComments: review.threads.length > 0 || review.composer !== null,
    liveBody,
    bodyChanged,
    editorHandle,
    setEditor,
    showThread,
    onThreadClick,
    onCaretThreadChange,
    onRequestComment,
    onRequestBlockComment,
    onComposerClose,
    blockPosition,
    threadField,
    fieldComments,
  };
}

export type ContentCommentsState = ReturnType<typeof useContentComments>;

/**
 * The start of a block's text, for a card about a whole block (it has no quote to show); for a card about a
 * channel field, the field as typed. Separate from `useContentComments` because it reads the values the page
 * shows, which a revert replaces and which that hook has to be built before.
 */
export function useBlockText(
  liveBody: { current: JSONContent },
  variables: Variable[],
  liveDraft: LiveDraft,
) {
  const labels = useMemo(
    () => new Map(variables.map((v) => [v.key, v.label])),
    [variables],
  );
  return useCallback(
    (blockId: string) =>
      fieldTextOf(liveDraft.getFields(), blockId, labels) ??
      blockTextOf(liveBody.current, blockId, labels),
    [labels, liveDraft, liveBody],
  );
}
