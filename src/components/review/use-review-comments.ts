"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMPOSER_THREAD_ID, blockTextOf, fieldTextOf, useReviewThreads, type ComposerOutcome } from "@/components/comments";
import { channelFieldValues } from "@/domain/channel-fields";
import { commentAnchors } from "@/domain/comments";
import { DOCUMENT_THREAD, type ReviewScreenData } from "@/domain/review-types";
import type { CommentRequest, DocumentEditorHandle } from "@/editor/types";

/**
 * The review screen's comments: the threads (`useReviewThreads`), the comment box, and where focus and scroll
 * go as a thread is opened, chosen or posted. Comments belong to the review: once the version has been decided
 * it is a record, and its threads are read-only (the author answers them in the new draft); the server decides
 * it with the rest of the screen (`can.comment`), so the screen does the gating.
 *
 * `showDocument` brings the document on screen when a thread is chosen from the output.
 */
export function useReviewComments({
  threads: initial,
  version,
  showDocument,
}: {
  threads: ReviewScreenData["threads"];
  version: ReviewScreenData["version"];
  showDocument: () => void;
}) {
  const editorRef = useRef<DocumentEditorHandle>(null);
  const { threads, threadsForEditor, editorActiveThreadId, activeThreadId, setActive, composer, openComposer, closeComposer, mutate } =
    useReviewThreads(initial);
  const openThreads = threads.filter((t) => t.status === "open").length;

  // Where a thread's anchor sits (the fields, then the body's blocks: `commentAnchors`), so a new thread slots
  // into reading order at once.
  const blockPosition = useMemo(() => {
    const blocks = (version.body.content ?? []).flatMap((block) => (typeof block.attrs?.id === "string" ? [block.attrs.id] : []));
    const order = new Map(commentAnchors(blocks, version.channels).map((id, i) => [id, i] as const));
    return (blockId: string) => order.get(blockId) ?? null;
  }, [version.body, version.channels]);

  // The start of a block's text, or a field's name and text, for the card about a whole block or field (it has no quote to show).
  const labels = useMemo(() => new Map(version.variables.map((v) => [v.key, v.label])), [version.variables]);
  const fieldValues = useMemo(() => channelFieldValues(version.channelFields), [version.channelFields]);
  const blockText = useCallback(
    (blockId: string) => fieldTextOf(fieldValues, blockId, labels) ?? blockTextOf(version.body, blockId, labels),
    [version.body, fieldValues, labels],
  );

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
  /** The Preview was opened: the comment box is about the document, and the person is on the tab they pressed, so focus stays there. */
  const dismissComposer = useCallback(() => {
    opener.current = null;
    closeComposer();
  }, [closeComposer]);

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
      showDocument();
      askForFocus((n) => n + 1);
    },
    [setActive, threads, showDocument],
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

  return {
    editorRef,
    threads,
    threadsForEditor,
    editorActiveThreadId,
    activeThreadId,
    activeBlockId,
    composer,
    openThreads,
    blockPosition,
    blockText,
    menuButton,
    mutate,
    onThreadClick,
    requestComment,
    requestBlockComment,
    onComposerClose,
    dismissComposer,
    pickBlock,
    activate,
  };
}

export type ReviewCommentsState = ReturnType<typeof useReviewComments>;
