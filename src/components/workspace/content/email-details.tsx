"use client";

import { useCallback, useId } from "react";
import { assertNever } from "@/domain/assert-never";
import {
  channelFieldsOf,
  fieldName,
  type ChannelField,
  type ChannelFieldValues,
  type ChannelFieldsPatch,
} from "@/domain/channel-fields";
import { InlineVariableField } from "@/editor/components/inline-variable-field";
import type { JSONContent } from "@/editor/model/types";
import { useWorkspaceSession } from "../session/workspace-session";

export interface EmailDetailsProps {
  /** Email is one of the template's channels. Off: nothing shows, and what was typed is kept. */
  on: boolean;
  /** An open draft the viewer can edit. Otherwise the fields are read-only and nothing saves. */
  editable: boolean;
  /** Where the fields start (the saved draft), by id. Email's are the ones shown. */
  values: ChannelFieldValues;
}

/**
 * The Email details group, directly under the Channels selector while Email is on: Email's fields from
 * the registry (src/domain/channel-fields.ts), the subject and the preheader, each a one-line field that
 * takes variable chips and `{{`. They sit in the same editor root as the document, so a chip here counts
 * in the variables panel and the picker offers the same list. Each saves through the workspace session
 * under its id ("email.subject"), like the document does.
 *
 * With Email off the group is hidden, not unmounted: the fields stay in the editor root, so their
 * chips still count (deleting a variable used only in the subject still asks first), and a variable
 * renamed or deleted meanwhile reaches them, and saves, as it does the document.
 */
export function EmailDetails({ on, editable, values }: EmailDetailsProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} hidden={!on} className="mt-8 px-2">
      <h2 id={headingId} className="caps-label pb-2">
        Email details
      </h2>
      <div className="flex flex-col gap-3">
        {channelFieldsOf("email").map((field) => (
          <ChannelFieldInput key={field.id} field={field} value={values[field.id]} hidden={!on} editable={editable} />
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
}: {
  field: ChannelField;
  value: JSONContent | null;
  hidden: boolean;
  editable: boolean;
}) {
  const session = useWorkspaceSession();
  const { id } = field;
  const onChange = useCallback((doc: JSONContent) => session.save({ [id]: doc } as ChannelFieldsPatch), [session, id]);

  switch (field.shape) {
    case "line":
      return (
        <Labelled label={field.label}>
          <InlineVariableField
            label={fieldName(field)}
            value={value}
            hidden={hidden}
            onChange={editable ? onChange : undefined}
          />
        </Labelled>
      );
    default:
      return assertNever(field.shape, "field shape");
  }
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
