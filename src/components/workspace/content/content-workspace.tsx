"use client";

import { useCallback, useEffect, useState } from "react";
import type { Channel, JSONContent, RequiredSection, SampleSet, Variable } from "@/domain/types";
import { PreviewSurface } from "@/components/preview/preview-surface";
import { useWorkspaceSession } from "../session/workspace-session";
import { WS } from "../workspace-grid";
import { ChannelSelector } from "./channels";
import { DocumentBody, EditorScope, VariablesSection } from "./editor-adapter";
import { EmailDetails } from "./email-details";
import { Rail } from "./rail";

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
  emailSubject: JSONContent | null;
  emailPreheader: JSONContent | null;
  sampleSets: SampleSet[];
  /** The demo clock's date, YYYY-MM-DD. */
  today: string;
  /** An open draft the viewer can edit. Otherwise everything is read-only and nothing autosaves. */
  editable: boolean;
}

/**
 * The Content tab: two cells of the workspace grid, the document and the rail. They sit in one
 * subtree so they share one editor root (one variable list), and they save through the workspace's
 * single autosave session. The preview lives in the rail (it widens into it), in that same root, so it
 * renders with the live variable list. The server component that renders this passes a key made of the version
 * and whether it is editable, so a different version, or the same one turning read-only (submitted),
 * is a fresh editor and a fresh session.
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
  emailSubject,
  emailPreheader,
  sampleSets,
  today,
  editable,
}: ContentWorkspaceProps) {
  const session = useWorkspaceSession();

  // Tell the workspace which draft is being edited. It starts autosave for it, and the header's name
  // field and save indicator follow. A read-only page binds nothing.
  useEffect(() => {
    session.bind(editable ? { versionId, rev } : null);
  }, [session, editable, versionId, rev]);

  const [channels, setChannels] = useState(initialChannels);

  const onBodyChange = useCallback((doc: JSONContent) => session.save({ body: doc }), [session]);
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

  return (
    <EditorScope
      variables={variables}
      baseline={baseline}
      requiredSections={requiredSections}
      readOnly={!editable}
      onVariablesChange={onVariablesChange}
    >
      <div data-slot="editor" className={WS.doc}>
        <DocumentBody content={body} onChange={editable ? onBodyChange : undefined} editorRef={session.setEditor} />
      </div>
      <Rail
        channels={
          <ChannelSelector channels={channels} allowed={allowedChannels} editable={editable} onChange={onChannels} />
        }
        emailDetails={
          <EmailDetails
            on={channels.includes("email")}
            editable={editable}
            subject={emailSubject}
            preheader={emailPreheader}
          />
        }
        preview={
          <PreviewSurface
            templateId={templateId}
            versionNumber={versionNumber}
            teamName={teamName}
            channels={channels}
            editable={editable}
            sampleSets={sampleSets}
            today={today}
          />
        }
      >
        <VariablesSection />
      </Rail>
    </EditorScope>
  );
}
