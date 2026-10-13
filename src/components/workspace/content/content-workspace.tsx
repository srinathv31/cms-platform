"use client";

import { useCallback, useEffect } from "react";
import { GutterMarkers } from "@/components/comments/gutter-markers";
import { ThreadList } from "@/components/comments/thread-list";
import { PreviewSurface } from "@/components/preview/preview-surface";
import { phoneSenders } from "@/components/preview/preview-sender";
import { copilotUnavailable } from "@/domain/copilot";
import type { Channel, JSONContent, Variable } from "@/domain/types";
import { cn } from "@/lib/utils";
import { CopilotPromptButton } from "../copilot/copilot-prompt";
import { takeJustImported } from "../just-imported";
import {
  useInert,
  usePreviewState,
  useWorkspaceSession,
} from "../session/workspace-session";
import { WS } from "../workspace-grid";
import { ChannelSelector } from "./channels";
import type { ContentWorkspaceProps } from "./content-props";
import {
  DocumentBody,
  EditorScope,
  HistoryBridge,
  VariablesSection,
} from "./editor-adapter";
import { EmailDetails } from "./email-details";
import { MessageComposer } from "./message-composer";
import { Rail } from "./rail";
import { useBlockText, useContentComments } from "./use-content-comments";
import { useContentRevert } from "./use-content-revert";

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
 * so Push and SMS render in the browser on every keystroke (decision 0036).
 *
 * This component lays the two cells out and puts the page's client state together; each kind of state
 * has a hook, and each concern of the props an object (content-props.ts):
 *
 * - `useContentRevert`: the values the page shows, and putting them back. Undo and redo for the header's
 *   buttons come from the editor root (`HistoryBridge`); "Revert to when you opened it" (the header's save
 *   status menu) puts this page's fields back to how they were when it mounted (use-content-revert.ts).
 * - `useContentComments`: review comments (src/components/comments). The document gets highlights and
 *   markers in its right gutter, the rail gets the thread list (a Comments view beside Variables, and in the
 *   preview's header), and one `useReviewThreads` state ties them: the active thread, and the composer the
 *   editor's Comment button opens. A document's email subject and preheader sit in the rail, not in the text:
 *   each carries its own marker and comment button (field-comments.tsx), and a message's fields have the
 *   gutter beside the composer (use-content-comments.ts).
 *
 * While the session is inert (Submit is reading or freezing the saved draft, or saving stopped for
 * good), an editable page shows read-only without remounting: the editor root (the document, the
 * email fields, the variables panel, undo and redo), the channels and the sample sets. The variables
 * panel keeps its layout, its controls disabled, and a variable form left open stays open (the root's
 * `held`). Text can still be selected and copied. It stays bound, so autosave keeps sending what was
 * typed before, and it is editable again, history and all, when the hold is let go.
 */
export function ContentWorkspace({
  version,
  draft,
  preview,
  comments,
  rail,
}: ContentWorkspaceProps) {
  const { templateId, versionId, versionNumber, round, rev, editable, family } =
    version;
  const session = useWorkspaceSession();
  const { open: previewOpen } = usePreviewState();
  const inert = useInert();
  // Editable right now: an editable draft, and nothing holding the page still.
  const editing = editable && !inert;
  const message = family === "message";

  // Arriving from an import, the rail opens widened on the Original view, with the import report at
  // its top (the name field selects the name, from its own cookie). The rail does it, before the first paint.
  const { importOriginal } = rail;
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

  // The threads come first: a revert tells them about the document it puts back (`bodyChanged`).
  const review = useContentComments({
    session,
    threads: comments.threads,
    canComment: comments.canComment,
    body: draft.body,
    message,
  });
  const { bodyChanged, threads, composer, activeThreadId } = review;
  const { shown, channels, setChannels, liveDraft } = useContentRevert({
    session,
    editable,
    draft,
    onBodyRestored: bodyChanged,
  });
  const blockText = useBlockText(review.liveBody, shown.variables, liveDraft);

  // What the editor root's parts report: each is saved through the session.
  const onBodyChange = useCallback(
    (doc: JSONContent) => {
      session.save({ body: doc });
      bodyChanged(doc);
    },
    [session, bodyChanged],
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
    [session, setChannels],
  );

  return (
    <EditorScope
      key={shown.gen}
      variables={shown.variables}
      baseline={draft.baseline}
      readOnly={!editable}
      held={editable && inert}
      onVariablesChange={onVariablesChange}
    >
      {editable ? <HistoryBridge onChange={session.setHistory} /> : null}
      <div data-slot="editor" className={cn(WS.doc, "relative")}>
        {message ? (
          // A message has no document: its channels' own fields, in the same root.
          <>
            <MessageComposer
              channels={channels}
              editable={editable}
              values={shown}
              draft={liveDraft}
              today={preview.today}
              rules={preview.messageRules}
              appName={phoneSenders(preview.senders, preview.teamName).appName}
              editorRef={review.setEditor}
              threadField={review.threadField}
            />
            {/* A message's threads are on its fields: their markers sit beside them, and a hover starts one on a field. */}
            <GutterMarkers
              editor={review.editorHandle}
              threads={threads}
              activeThreadId={activeThreadId}
              onActivate={review.showThread}
              onRequestBlockComment={review.onRequestBlockComment}
              compact={previewOpen}
              className="hidden @min-[53rem]/ws:block"
              noun="field"
              blocks='[data-slot="message-composer"] [data-id]'
            />
          </>
        ) : (
          <>
            <DocumentBody
              content={shown.body}
              onChange={editable ? onBodyChange : undefined}
              editorRef={review.setEditor}
              comments={{
                threads: review.threadsForEditor,
                activeThreadId: review.editorActiveThreadId,
                onThreadClick: review.onThreadClick,
                onCaretThreadChange: review.onCaretThreadChange,
                onRequestComment: review.onRequestComment,
              }}
            />
            <GutterMarkers
              editor={review.editorHandle}
              threads={threads}
              activeThreadId={activeThreadId}
              onActivate={review.showThread}
              onRequestBlockComment={review.onRequestBlockComment}
              compact={previewOpen}
              // Below the rail's breakpoint the rail is an overlay and the text runs to the panel's edge: no gutter.
              className="hidden @min-[53rem]/ws:block"
            />
          </>
        )}
      </div>
      <Rail
        comments={
          review.hasComments
            ? {
                count: review.openCount,
                preferred: review.openCount > 0 || composer !== null,
                panel: (
                  <ThreadList
                    threads={threads}
                    activeThreadId={activeThreadId}
                    onActivate={review.setActive}
                    canComment={comments.canComment}
                    composer={composer}
                    onComposerClose={review.onComposerClose}
                    templateId={templateId}
                    versionId={versionId}
                    viewer={comments.viewer}
                    now={comments.now}
                    blockText={blockText}
                    blockPosition={review.blockPosition}
                    onMutate={review.mutate}
                  />
                ),
              }
            : null
        }
        channels={
          <ChannelSelector
            channels={channels}
            allowed={draft.allowedChannels}
            editable={editable}
            disabled={!editing}
            onChange={onChannels}
          />
        }
        emailDetails={
          <EmailDetails
            on={channels.includes("email")}
            editable={editable}
            values={shown}
            comments={review.fieldComments}
          />
        }
        original={importOriginal !== null}
        takeArrival={takeArrival}
        footer={
          editable ? (
            <CopilotPromptButton
              templateId={templateId}
              blocked={copilotUnavailable(family)}
            />
          ) : null
        }
        reviewHref={rail.reviewHref}
        preview={
          <PreviewSurface
            templateId={templateId}
            versionNumber={versionNumber}
            round={round}
            teamName={preview.teamName}
            channels={channels}
            editable={editing}
            draft={liveDraft}
            messageRules={preview.messageRules}
            senders={preview.senders}
            today={preview.today}
            commentsCount={review.hasComments ? review.openCount : null}
            original={importOriginal}
          />
        }
      >
        <VariablesSection />
      </Rail>
    </EditorScope>
  );
}
