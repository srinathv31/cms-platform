"use client";

import { useCallback, useId, useState } from "react";
import { InlineVariableField, type JSONContent } from "@/editor";
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
 * A field reads its `value` once, when it mounts, and Email being turned off unmounts the fields. So
 * this holds the latest values and gives them back when Email is turned on again.
 */
export function EmailDetails({ on, editable, subject: initialSubject, preheader: initialPreheader }: EmailDetailsProps) {
  const session = useWorkspaceSession();
  const headingId = useId();
  const [subject, setSubject] = useState(initialSubject);
  const [preheader, setPreheader] = useState(initialPreheader);

  const onSubject = useCallback(
    (doc: JSONContent) => {
      setSubject(doc);
      session.save({ emailSubject: doc });
    },
    [session],
  );
  const onPreheader = useCallback(
    (doc: JSONContent) => {
      setPreheader(doc);
      session.save({ emailPreheader: doc });
    },
    [session],
  );

  if (!on) return null;
  return (
    <section aria-labelledby={headingId} className="mt-8 px-2">
      <h2 id={headingId} className="caps-label pb-2">
        Email details
      </h2>
      <div className="flex flex-col gap-3">
        <Labelled label="Subject">
          <InlineVariableField label="Email subject" value={subject} onChange={editable ? onSubject : undefined} />
        </Labelled>
        <Labelled label="Preheader">
          <InlineVariableField label="Email preheader" value={preheader} onChange={editable ? onPreheader : undefined} />
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
