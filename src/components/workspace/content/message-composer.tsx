"use client";

import { Lock, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import type { PushContent } from "@/components/device";
import { monogramOf } from "@/components/preview/phone-output";
import { findSet, listSets, resolveSetValues } from "@/components/preview/sample-sets/model";
import {
  channelFieldsFrom,
  channelFieldsOf,
  fieldLines,
  fieldName,
  type ChannelField,
  type ChannelFieldValues,
  type ChannelFieldsPatch,
} from "@/domain/channel-fields";
import { messageFieldFlags } from "@/domain/messages/flags";
import { truncationWarnings, type TruncationWarnings } from "@/domain/messages/truncation";
import type { MessageTypeRules } from "@/domain/platform-config";
import { resolveMessage } from "@/domain/render/message";
import { validateValues } from "@/domain/render/validate";
import type { Channel, JSONContent } from "@/domain/types";
import { useContractState } from "@/editor/components/editor-root";
import { InlineVariableField } from "@/editor/components/inline-variable-field";
import type { DocumentEditorHandle, TextFlagger } from "@/editor/types";
import { cn } from "@/lib/utils";
import { useLiveFields, useLiveSampleSets, type LiveDraft } from "../session/live-draft";
import { usePreviewState, useWorkspaceSession } from "../session/workspace-session";
import { usePushFit } from "./push-fit";
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
  /** Receives the composer's handle: the name field's Enter puts the caret in the first field shown. */
  editorRef: (handle: DocumentEditorHandle | null) => void;
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
export function MessageComposer({ channels, editable, values, draft, today, rules, appName, editorRef }: MessageComposerProps) {
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

  // The push as the selected set resolves it, for the phones the cuts are measured on.
  const pushContent = useMemo((): PushContent | null => {
    if (!pushOn) return null;
    const checked = validateValues(variables, sampleValues);
    if (!checked.ok) return null;
    const push = resolveMessage(
      { channel: "push", platform: "ios" },
      { fields: channelFieldsFrom(live), variables, values: checked.values, rules },
    );
    return { appName, appMark: { monogram: monogramOf(appName) }, ...push, time: "now" };
  }, [pushOn, variables, sampleValues, live, rules, appName]);
  const { fits, probe } = usePushFit(pushContent);
  const warnings: TruncationWarnings = pushContent
    ? truncationWarnings(fits, pushContent)
    : { title: null, subtitle: null, body: null };

  const meta = useMemo(
    () => (smsOn ? smsMetaSegments(smsMeta({ fields: live, variables, values: sampleValues, sampleSets: stored, today, rules })) : []),
    [smsOn, live, variables, sampleValues, stored, today, rules],
  );

  // The name field's Enter: the caret goes to the first field on screen.
  useEffect(() => {
    const handle: DocumentEditorHandle = {
      focus: () => {
        const first = [...(root.current?.querySelectorAll<HTMLElement>(".ProseMirror") ?? [])].find((el) => el.getClientRects().length > 0);
        first?.focus({ preventScroll: true });
      },
      // A message has no blocks for comments to anchor to.
      focusThread: () => {},
      getBlockRect: () => null,
      getThreadRect: () => null,
      subscribeBlockRects: () => () => {},
      requestComment: () => {},
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
      <Section heading="Push notification" hidden={!pushOn}>
        <ComposerField field={title!} value={values[title!.id]} hidden={!pushOn} editable={editable} onField={onField} warning={warnings.title} />
        <ComposerField
          field={subtitle!}
          value={values[subtitle!.id]}
          hidden={!pushOn}
          editable={editable}
          onField={onField}
          tag="iPhone only"
          warning={warnings.subtitle}
        />
        <ComposerField field={body!} value={values[body!.id]} hidden={!pushOn} editable={editable} onField={onField} warning={warnings.body} />
        {probe}
      </Section>

      <Section heading="Text message" hidden={!smsOn}>
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
 * One field: its label (and a quiet tag, "iPhone only"), the editor its shape takes, then what the
 * composer measured: a cut warning on the left, the SMS's meta line on the right.
 */
function ComposerField({
  field,
  value,
  hidden,
  editable,
  onField,
  tag,
  warning = null,
  footer,
  meta,
}: {
  field: ChannelField;
  value: JSONContent | null;
  hidden: boolean;
  editable: boolean;
  onField: (field: ChannelField, doc: JSONContent) => void;
  tag?: string;
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
    <div data-field={field.id} className="flex flex-col">
      {/* The field names itself to assistive tech ("Push subtitle"); this is its visible label. */}
      <div aria-hidden className="mb-2 flex h-5 items-center gap-2 text-[13px] leading-5 font-medium text-text-muted">
        {field.label}
        {tag ? (
          <span className="rounded-sm border border-hairline px-1.5 text-[11px] leading-4 font-normal text-text-subtle">{tag}</span>
        ) : null}
      </div>
      <InlineVariableField
        label={fieldName(field)}
        value={value}
        lines={fieldLines(field.shape)}
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

/** The content type's SMS footer, under the message in the same box: sent as written, never edited here. */
function LockedFooter({ text }: { text: string }) {
  return (
    <p data-slot="sms-footer" className="mt-0.5 flex items-start gap-1.5 text-text-muted select-none">
      <Lock role="img" aria-label="Locked" strokeWidth={1.75} className="mt-[5px] size-3.5 shrink-0 text-text-subtle" />
      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</span>
    </p>
  );
}
