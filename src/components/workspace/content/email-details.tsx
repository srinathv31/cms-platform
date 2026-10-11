"use client";

import { useCallback, useId } from "react";
import {
  channelFieldsOf,
  fieldLines,
  fieldName,
  type ChannelField,
  type ChannelFieldValues,
  type ChannelFieldsPatch,
} from "@/domain/channel-fields";
import { InlineVariableField } from "@/editor/components/inline-variable-field";
import type { JSONContent } from "@/editor/model/types";
import { useWorkspaceSession } from "../session/workspace-session";
import { FieldCommentControls, type FieldComments } from "./field-comments";

export interface EmailDetailsProps {
  /** Email is one of the template's channels. Off: nothing shows, and what was typed is kept. */
  on: boolean;
  /** An open draft the viewer can edit. Otherwise the fields are read-only and nothing saves. */
  editable: boolean;
  /** Where the fields start (the saved draft), by id. Email's are the ones shown. */
  values: ChannelFieldValues;
  /** The review comments on the fields: a marker beside a field that has threads, and a button to start one. */
  comments?: FieldComments;
}

/**
 * The Email details group, directly under the Channels selector while Email is on: Email's fields from
 * the registry (src/domain/channel-fields.ts), the subject and the preheader, each a one-line field that
 * takes variable chips and `{{`. They sit in the same editor root as the document, so a chip here counts
 * in the variables panel and the picker offers the same list. Each saves through the workspace session
 * under its id ("email.subject"), like the document does.
 *
 * The subject and the preheader take review comments like a block of the document does (a thread anchors to
 * "email.subject"): the end of each label carries the marker of its open threads, and a button to start one
 * (src/components/workspace/content/field-comments.tsx).
 *
 * With Email off the group is hidden, not unmounted: the fields stay in the editor root, so their
 * chips still count (deleting a variable used only in the subject still asks first), and a variable
 * renamed or deleted meanwhile reaches them, and saves, as it does the document.
 */
export function EmailDetails({ on, editable, values, comments }: EmailDetailsProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} hidden={!on} className="mt-8 px-2">
      <h2 id={headingId} className="caps-label pb-2">
        Email details
      </h2>
      <div className="flex flex-col gap-3">
        {channelFieldsOf("email").map((field) => (
          <ChannelFieldInput
            key={field.id}
            field={field}
            value={values[field.id]}
            hidden={!on}
            editable={editable}
            comments={comments}
          />
        ))}
      </div>
    </section>
  );
}

/** One channel field: its label over the editor its shape takes, saving under the field's id. */
function ChannelFieldInput({
  field,
  value,
  hidden,
  editable,
  comments,
}: {
  field: ChannelField;
  value: JSONContent | null;
  hidden: boolean;
  editable: boolean;
  comments?: FieldComments;
}) {
  const session = useWorkspaceSession();
  const { id } = field;
  const onChange = useCallback((doc: JSONContent) => session.save({ [id]: doc } as ChannelFieldsPatch), [session, id]);

  // Every shape is one paragraph of text and chips; only `lines` (an SMS message) takes line breaks.
  return (
    <Labelled label={field.label} controls={comments ? <FieldCommentControls field={field} comments={comments} /> : null}>
      <InlineVariableField
        label={fieldName(field)}
        value={value}
        lines={fieldLines(field.shape)}
        hidden={hidden}
        onChange={editable ? onChange : undefined}
      />
    </Labelled>
  );
}

/**
 * A small label over its field, with the field's comment controls at the end of the label's line. The field
 * names itself to assistive tech ("Email subject"). The group lets the controls show while the field is hovered.
 */
function Labelled({ label, controls, children }: { label: string; controls: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="group/field flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span aria-hidden className="text-xs text-text-muted">
          {label}
        </span>
        {controls}
      </div>
      {children}
    </div>
  );
}
