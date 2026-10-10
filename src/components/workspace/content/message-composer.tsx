"use client";

import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { findSet, listSets, resolveSetValues } from "@/components/preview/sample-sets/model";
import { createRedlineHandle } from "@/components/redline/dom-handle";
import {
  channelFieldsHeading,
  channelFieldsOf,
  fieldCharacters,
  fieldLines,
  fieldName,
  fieldPlatformTag,
  type ChannelField,
  type ChannelFieldValues,
  type ChannelFieldsPatch,
} from "@/domain/channel-fields";
import { messageFieldFlags } from "@/domain/messages/flags";
import { truncationWarnings, type TruncationWarnings } from "@/domain/messages/truncation";
import type { MessageTypeRules } from "@/domain/platform-config";
import type { Channel, JSONContent } from "@/domain/types";
import { useContractState } from "@/editor/components/editor-root";
import { InlineVariableField } from "@/editor/components/inline-variable-field";
import type { DocumentEditorHandle, TextFlagger } from "@/editor/types";
import { cn } from "@/lib/utils";
import { useLiveFields, useLiveSampleSets, type LiveDraft } from "../session/live-draft";
import { usePreviewState, useWorkspaceSession } from "../session/workspace-session";
import { FieldLabel, LockedFooter } from "./field-chrome";
import { usePushContent, usePushFit } from "./push-fit";
import { smsMeta, smsMetaSegments } from "./sms-meta";

export interface MessageComposerProps {
  /** The channels that are on: a section shows for each, and is hidden (not unmounted) while it is off. */
  channels: readonly Channel[];
  /** An open draft the viewer can edit. Otherwise the fields are read-only and nothing saves. */
  editable: boolean;
  /** The fields as the page opened them (or a revert put them): where each editor starts. */
  values: ChannelFieldValues;
  /** The draft as typed: the composer writes each field here, and reads the sample sets. */
  draft: LiveDraft;
  /** The demo clock's day, YYYY-MM-DD: the sample values' "today". */
  today: string;
  /** The content type's SMS footer and part budget. */
  rules: MessageTypeRules;
  /** The push's app name, for the phones the cuts are measured on. */
  appName: string;
  /**
   * Receives the composer's handle: the name field's Enter puts the caret in the first field shown, and
   * the comment markers and the list find a thread's field through it.
   */
  editorRef: (handle: DocumentEditorHandle | null) => void;
  /** The field a review thread is on (its id, "push.title"), or null: what the handle places a thread by. */
  threadField: (threadId: string) => string | null;
}

/**
 * The Content tab of a message template (an Alert): a section per channel that is on, in the main
 * column where a document's editor would be. Push has its title, its subtitle (iPhone only) and its
 * body; SMS its message, with the content type's footer locked under it. Every field is an inline
 * variable field in the page's editor root, so the `{{` picker, the chips, the variables panel's counts
 * and renames work as they do in a document, and each saves through the workspace session under its id
 * ("push.title"), as the email subject does.
 *
 * What the composer measures shows only when it matters, in the field's own words:
 *   - under the SMS message, its encoding and parts with the selected sample set and with the long
 *     values, in the warning colour when the long values go over the budget (sms-meta.ts);
 *   - under a push field, where a phone's lock screen cuts it (push-fit.tsx, domain/messages/truncation.ts);
 *   - in the text, the characters an SMS can't carry and links on public shorteners, each underlined
 *     with its reason and, for a character, a one-click fix (domain/messages/flags.ts).
 * Nothing counts up or moves: the numbers change in place.
 */
export function MessageComposer({
  channels,
  editable,
  values,
  draft,
  today,
  rules,
  appName,
  editorRef,
  threadField,
}: MessageComposerProps) {
  const session = useWorkspaceSession();
  const { variables } = useContractState();
  const { setId } = usePreviewState();
  const live = useLiveFields(draft);
  const stored = useLiveSampleSets(draft);
  const root = useRef<HTMLDivElement>(null);

  // The selected sample set's values, as the preview resolves them.
  const sampleValues = useMemo(() => {
    const sets = listSets(stored, variables, today);
    const selected = findSet(sets, setId) ?? findSet(sets, "typical") ?? sets[0];
    return selected ? resolveSetValues(selected, variables, today) : {};
  }, [stored, variables, today, setId]);

  const pushOn = channels.includes("push");
  const smsOn = channels.includes("sms");

  // The push as the selected set resolves it, for the phones the cuts are measured on: from the push's
  // own fields, so an SMS keystroke doesn't redraw those phones.
  const pushContent = usePushContent({ on: pushOn, fields: live, variables, values: sampleValues, rules, appName });
  const { fits, probe } = usePushFit(pushContent);
  const warnings: TruncationWarnings = pushContent
    ? truncationWarnings(fits, pushContent)
    : { title: null, subtitle: null, body: null };

  const meta = useMemo(
    () => (smsOn ? smsMetaSegments(smsMeta({ fields: live, variables, values: sampleValues, sampleSets: stored, today, rules })) : []),
    [smsOn, live, variables, sampleValues, stored, today, rules],
  );

  // The composer's handle. The name field's Enter: the caret goes to the first field on screen. Review
  // comments on a message are on its fields (each field is a thread's block, by its id): the markers beside
  // them and the scroll to a thread's field find the field by `data-field`, as the redline finds a block.
  const latestThreadField = useRef(threadField);
  useLayoutEffect(() => {
    latestThreadField.current = threadField;
  });
  useEffect(() => {
    const handle: DocumentEditorHandle = {
      ...createRedlineHandle({
        root: () => root.current,
        anchor: (el, id) => el?.querySelector<HTMLElement>(`[data-field="${id.replace(/["\\]/g, "\\$&")}"]`) ?? null,
        blockOfThread: (id) => latestThreadField.current(id),
      }),
      focus: () => {
        const first = [...(root.current?.querySelectorAll<HTMLElement>(".ProseMirror") ?? [])].find((el) => el.getClientRects().length > 0);
        first?.focus({ preventScroll: true });
      },
    };
    editorRef(handle);
    return () => editorRef(null);
  }, [editorRef]);

  const onField = useCallback(
    (field: ChannelField, doc: JSONContent) => {
      draft.setField(field.id, doc);
      session.save({ [field.id]: doc } as ChannelFieldsPatch);
    },
    [draft, session],
  );

  const [title, subtitle, body] = channelFieldsOf("push");
  const [message] = channelFieldsOf("sms");

  return (
    <div ref={root} data-slot="message-composer" className="flex flex-col gap-12 pt-1">
      <Section heading={channelFieldsHeading("push")} hidden={!pushOn}>
        <ComposerField field={title!} value={values[title!.id]} hidden={!pushOn} editable={editable} onField={onField} warning={warnings.title} />
        <ComposerField
          field={subtitle!}
          value={values[subtitle!.id]}
          hidden={!pushOn}
          editable={editable}
          onField={onField}
          warning={warnings.subtitle}
        />
        <ComposerField field={body!} value={values[body!.id]} hidden={!pushOn} editable={editable} onField={onField} warning={warnings.body} />
        {probe}
      </Section>

      <Section heading={channelFieldsHeading("sms")} hidden={!smsOn}>
        <ComposerField
          field={message!}
          value={values[message!.id]}
          hidden={!smsOn}
          editable={editable}
          onField={onField}
          footer={rules.smsFooter ? <LockedFooter text={rules.smsFooter} /> : undefined}
          meta={
            // One line, the same height whatever it says: a measurement, so the numbers are tabular.
            <p data-slot="sms-meta" className="ml-auto min-h-5 text-right text-[13px] leading-5 tabular-nums text-text-muted">
              {meta.map((segment, i) => (
                <span key={i}>
                  {i > 0 ? <span aria-hidden> · </span> : null}
                  <span className={cn(segment.over && "text-warning-text")}>
                    {segment.over && i === meta.length - 1 ? (
                      <TriangleAlert aria-hidden strokeWidth={1.75} className="mr-1 inline size-3.5 -translate-y-px" />
                    ) : null}
                    {segment.text}
                  </span>
                  {i < meta.length - 1 ? <span className="sr-only">,</span> : null}
                </span>
              ))}
            </p>
          }
        />
      </Section>
    </div>
  );
}

/** A channel's section: its heading in the display face, like a document's section heading. */
function Section({ heading, hidden, children }: { heading: string; hidden: boolean; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} hidden={hidden} className="flex flex-col gap-6">
      <h2 id={id} className="font-display text-[1.5rem] leading-[1.35] font-normal tracking-[-0.005em] text-text">
        {heading}
      </h2>
      {children}
    </section>
  );
}

/**
 * One field: its label (and a quiet tag, "iPhone only", from the registry), the editor its shape takes,
 * then what the composer measured: a cut warning on the left, the SMS's meta line on the right.
 */
function ComposerField({
  field,
  value,
  hidden,
  editable,
  onField,
  warning = null,
  footer,
  meta,
}: {
  field: ChannelField;
  value: JSONContent | null;
  hidden: boolean;
  editable: boolean;
  onField: (field: ChannelField, doc: JSONContent) => void;
  warning?: string | null;
  footer?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  const onChange = useCallback((doc: JSONContent) => onField(field, doc), [onField, field]);
  const flags = useMemo<TextFlagger | undefined>(() => {
    if (field.channel !== "sms" && !field.refusesShorteners) return undefined;
    return (text) =>
      messageFieldFlags(field, text).map((flag) => ({
        from: flag.index,
        to: flag.index + flag.length,
        message: flag.message,
        ...(flag.replacement === undefined ? {} : { replacement: flag.replacement }),
      }));
  }, [field]);

  return (
    // `data-id`: a review thread can be on the field, as on a document's block (the gutter's hover marker finds it).
    <div data-field={field.id} data-id={field.id} className="flex flex-col">
      {/* The field names itself to assistive tech ("Push subtitle"); this is its visible label. */}
      <FieldLabel label={field.label} tag={fieldPlatformTag(field)} />
      <InlineVariableField
        label={fieldName(field)}
        value={value}
        lines={fieldLines(field.shape)}
        characters={fieldCharacters(field)}
        hidden={hidden}
        size="md"
        flags={flags}
        footer={footer}
        onChange={editable ? onChange : undefined}
      />
      {warning || meta ? (
        <div className="mt-2 flex items-start gap-4">
          {warning ? (
            <p data-slot="cut-warning" className="flex min-w-0 items-start gap-1.5 text-[13px] leading-5 text-warning-text">
              <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-3.5 shrink-0" />
              {warning}
            </p>
          ) : null}
          {meta}
        </div>
      ) : null}
    </div>
  );
}
