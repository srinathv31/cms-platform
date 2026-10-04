"use client";

import { useCallback, useEffect, useState } from "react";
import type { Channel, JSONContent, RequiredSection, Variable } from "@/domain/types";
import { useWorkspaceSession } from "../session/workspace-session";
import { WS } from "../workspace-grid";
import { ChannelSelector } from "./channels";
import { DocumentBody, EditorScope, VariablesSection } from "./editor-adapter";
import { Rail } from "./rail";

export interface ContentWorkspaceProps {
  versionId: string;
  /** Where autosave starts. */
  rev: number;
  body: JSONContent;
  variables: Variable[];
  baseline: Variable[] | null;
  requiredSections: RequiredSection[];
  channels: Channel[];
  allowedChannels: Channel[];
  /** An open draft the viewer can edit. Otherwise everything is read-only and nothing autosaves. */
  editable: boolean;
}

/**
 * The Content tab: two cells of the workspace grid, the document and the rail. They sit in one
 * subtree so they share one editor root (one variable list), and they save through the workspace's
 * single autosave session. The server component that renders this passes `key={versionId}`, so a
 * different version is a fresh editor and a fresh session.
 */
export function ContentWorkspace({
  versionId,
  rev,
  body,
  variables,
  baseline,
  requiredSections,
  channels: initialChannels,
  allowedChannels,
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
      >
        <VariablesSection />
      </Rail>
    </EditorScope>
  );
}
