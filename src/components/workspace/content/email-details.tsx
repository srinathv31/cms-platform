"use client";

import { useCallback, useId } from "react";
import { InlineVariableField } from "@/editor/components/inline-variable-field";
import type { JSONContent } from "@/editor/model/types";
import { useWorkspaceSession } from "../session/workspace-session";

export interface EmailDetailsProps {
  /** Email is one of the template's channels. Off: nothing shows, and what was typed is kept. */
  on: boolean;
  /** An open draft the viewer can edit. Otherwise the fields are read-only and nothing saves. */
  editable: boolean;
  /** Where the fields start (the saved draft). */
  subject: JSONContent | null;
  preheader: JSONContent | null;
}

/**
 * The Email details group, directly under the Channels selector while Email is on: the subject and
 * the preheader, each a one-line field that takes variable chips and `{{`. They sit in the same
 * editor root as the document, so a chip here counts in the variables panel and the picker offers
 * the same list. Both save through the workspace session, like the document does.
 *
 * With Email off the group is hidden, not unmounted: the fields stay in the editor root, so their
 * chips still count (deleting a variable used only in the subject still asks first), and a variable
 * renamed or deleted meanwhile reaches them, and saves, as it does the document.
 */
export function EmailDetails({ on, editable, subject, preheader }: EmailDetailsProps) {
  const session = useWorkspaceSession();
  const headingId = useId();

  const onSubject = useCallback((doc: JSONContent) => session.save({ emailSubject: doc }), [session]);
  const onPreheader = useCallback((doc: JSONContent) => session.save({ emailPreheader: doc }), [session]);

  return (
    <section aria-labelledby={headingId} hidden={!on} className="mt-8 px-2">
      <h2 id={headingId} className="caps-label pb-2">
        Email details
      </h2>
      <div className="flex flex-col gap-3">
        <Labelled label="Subject">
          <InlineVariableField
            label="Email subject"
            value={subject}
            hidden={!on}
            onChange={editable ? onSubject : undefined}
          />
        </Labelled>
        <Labelled label="Preheader">
          <InlineVariableField
            label="Email preheader"
            value={preheader}
            hidden={!on}
            onChange={editable ? onPreheader : undefined}
          />
        </Labelled>
      </div>
    </section>
  );
}

/** A small label over its field. The field names itself to assistive tech ("Email subject"). */
function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span aria-hidden className="text-xs text-text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
