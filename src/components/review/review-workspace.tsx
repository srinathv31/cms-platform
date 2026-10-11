"use client";

import { Activity } from "react";
import { redlineSummary } from "@/components/redline";
import { SampleSetSwitcher } from "@/components/preview/sample-sets";
import type { Person, ReviewScreenData } from "@/domain/review-types";
import { ApproveDialog } from "./approve-dialog";
import { CommentsSection } from "./comments-section";
import { DecisionBar } from "./decision-bar";
import { DecisionRail } from "./decision-rail";
import { DocumentView } from "./document-view";
import { GoLive } from "./go-live";
import { PreviewView } from "./preview-view";
import { ContractSection, NameSection, SubmitNote } from "./rail-sections";
import { RequestChangesDialog } from "./request-dialog";
import { ReviewHeader } from "./review-header";
import { RV } from "./review-grid";
import { useGoLive } from "./use-go-live";
import { usePreviewSets } from "./use-preview-sets";
import { useReviewChanges } from "./use-review-changes";
import { useReviewComments } from "./use-review-comments";
import { useReviewDecision } from "./use-review-decision";
import { useReviewView } from "./use-review-view";
import { useViewedOutputs } from "./use-viewed-outputs";
import { ChangeToggles, ViewTabs, type ReviewView } from "./view-tabs";

/**
 * The review screen, as the cells of its grid (review-grid.ts): the header, the view tabs, the
 * document or the output, and the decision rail. It puts the screen's client state together and lays it out;
 * each kind of state has a hook of its own:
 *
 * - `useReviewView`: which view, and whether the Preview has been opened (use-review-view.ts);
 * - `useViewedOutputs`: the outputs the approver has had on screen in the Preview, which Approve waits on
 *   (use-viewed-outputs.ts, decision 0037);
 * - `useReviewChanges`: the redline switches and the diffs (use-review-changes.ts);
 * - `usePreviewSets`: the sample sets, and which were looked at (use-preview-sets.ts);
 * - `useReviewComments`: the comment threads and their focus (use-review-comments.ts);
 * - `useReviewDecision`: Approve and Request changes, with their two dialogs (use-review-decision.ts);
 * - `useGoLive`: the go-live moment (use-go-live.ts).
 *
 * The server's data (`data`) is the truth and arrives anew after every action (the actions refresh the
 * page); what is kept here is what the viewer did on this screen: "You approved v3.", and the moment's
 * own clock. The screen is one round of the version (`version.round`): the decisions name it, and the
 * preview renders it.
 */

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
  const { template, version, baseline, steps, can, today } = data;

  const views = useReviewView(version);
  const { view, previewVisited, channels } = views;
  const changes = useReviewChanges(data);
  const { sets, selectedSet, setSetId, values, seen, onSeen, switcher } = usePreviewSets(version, today);
  const comments = useReviewComments({ threads: data.threads, version, showDocument: views.showDocument });
  const goLive = useGoLive(version.state);
  const outputs = useViewedOutputs(viewer.id, version.id, version.round);
  const decision = useReviewDecision({ data, team, goLive, viewed: outputs.viewed, cannotShow: outputs.failed });
  const { rename } = changes;
  const canComment = can.comment.ok;

  function pickView(next: ReviewView) {
    views.pickView(next);
    if (next === "preview") comments.dismissComposer();
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
        baseline={baseline}
        showChanges={changes.showChanges}
        onShowChanges={changes.setShowChanges}
        changesOnly={changes.changesOnly}
        onChangesOnly={changes.setChangesOnly}
        count={changes.changeCount}
        summary={changes.counts ? redlineSummary(changes.counts) : ""}
      />
    ) : null;

  return (
    <>
      <ReviewHeader
        team={team}
        templateId={template.id}
        templateName={version.name}
        versionNumber={version.number}
        round={version.round}
        state={goLive.shownState}
        sunsetDay={version.sunsetDay ?? null}
        sunsetPassed={version.sunsetPassed}
        author={version.submittedBy}
        submittedAt={version.submittedAt}
        nowIso={nowIso}
        ring={goLive.ring}
        slotRef={goLive.slotRef}
      />

      <div data-slot="tab-bar" className={RV.tabs}>
        <ViewTabs value={view} onChange={pickView} previewMounted={previewVisited} />
        <div className="ml-auto min-w-0 pt-1.5">{tools}</div>
      </div>

      <Activity mode={view === "document" ? "visible" : "hidden"}>
        <DocumentView
          versionId={version.id}
          family={template.family}
          fields={changes.fields.fields}
          footer={changes.fields.footer}
          body={version.body}
          variables={version.variables}
          baselineVariables={baseline?.variables ?? null}
          redline={changes.showChanges ? changes.redline : null}
          changesOnly={changes.showChanges && changes.changesOnly}
          editorRef={comments.editorRef}
          anchors={comments.threadsForEditor}
          activeThreadId={comments.editorActiveThreadId}
          threads={comments.threads}
          activeBlockId={comments.activeBlockId}
          onThreadClick={comments.onThreadClick}
          onActivate={comments.activate}
          onRequestComment={canComment ? comments.requestComment : undefined}
          onRequestBlockComment={canComment ? comments.requestBlockComment : undefined}
        />
      </Activity>
      {previewVisited ? (
        <Activity mode={view === "preview" ? "visible" : "hidden"}>
          <PreviewView
            templateId={template.id}
            versionNumber={version.number}
            round={version.round}
            teamName={template.teamName}
            channels={channels}
            variables={version.variables}
            channelFields={version.channelFields}
            messageRules={data.messageRules}
            senders={data.senders}
            today={today}
            values={values}
            setId={selectedSet.id}
            enabled={view === "preview"}
            onSeen={onSeen}
            viewed={outputs.viewed}
            onViewed={outputs.onViewed}
            onFailed={outputs.onFailed}
            onEditValues={() => switcher.current?.openEditor()}
          />
        </Activity>
      ) : null}

      <DecisionBar
        access={decision.access}
        approveBlocked={decision.approveBlocked}
        row={decision.row}
        decidedHere={decision.decidedHere}
        onApprove={(from) => decision.open("approve", from)}
        onRequest={(from) => decision.open("request", from)}
      />

      <DecisionRail
        steps={steps}
        nowIso={nowIso}
        access={decision.access}
        approveBlocked={decision.approveBlocked}
        row={decision.row}
        next={decision.next}
        onApprove={() => decision.open("approve")}
        onRequest={() => decision.open("request")}
        approveRef={decision.approveButton}
        requestRef={decision.requestButton}
        regionRef={decision.decisionRegion}
      >
        {version.submitNote ? <SubmitNote author={version.submittedBy} note={version.submitNote} /> : null}
        {rename ? <NameSection className={version.submitNote ? "mt-8" : undefined} change={rename} /> : null}
        <ContractSection
          className={version.submitNote || rename ? "mt-8" : undefined}
          changes={version.contractChanges}
          lines={version.contractLines}
          first={version.number === 1}
        />
        <CommentsSection comments={comments} data={data} view={view} viewer={viewer} nowIso={nowIso} />
      </DecisionRail>

      <ApproveDialog
        {...decision.approveDialog}
        templateId={template.id}
        versionNumber={version.number}
        round={version.round}
        previousNumber={data.previousNumber}
        stillRenders={data.stillRenders}
        contractChanges={version.contractChanges}
        usage={data.consumerUsage}
        sunsetCalendar={data.sunsetCalendar}
        nowIso={nowIso}
        sampleSetsSeen={seen}
      />
      <RequestChangesDialog
        {...decision.requestDialog}
        templateId={template.id}
        versionNumber={version.number}
        round={version.round}
        authorName={version.submittedBy.name}
      />

      {goLive.playing ? (
        <GoLive versionNumber={version.number} slotRef={goLive.slotRef} onFlip={goLive.flip} onDone={goLive.done} />
      ) : null}
    </>
  );
}
