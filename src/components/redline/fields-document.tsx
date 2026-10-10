// A version's channel fields (an alert's push and SMS, a document's email subject and preheader), read
// only, as the message composer shows them, with their redline when there is one.
//
// Server-safe like <RedlineDocument>, and painted by the same pieces: the static renderer, the editor's
// schema, the chip component and the `redline` mark (<ins>/<del>), so a field's changes read exactly as a
// paragraph's do. It renders `FieldRedline`s (domain/redline.ts `diffChannelFields`): the clean view is
// the diff against no base (every field "unchanged"), so one component draws both.
//
//   layout "sections"  a message: each channel a section under its display heading ("Push notification"),
//                      its fields in the composer's boxes (label, "iPhone only" tag, the SMS's locked footer)
//   layout "details"   a document: a caps label ("EMAIL") over each channel's fields, above the body
//   status             a field that changed gets the redline's bar in the gutter; an added one is under an
//                      <ins>, a removed one struck whole; inside a changed one, the word diff's marks
//   changesOnly        an unchanged field keeps its label and says "Unchanged" in place of its text (the
//                      active field shows in full), so a comment marker beside it keeps its place
//   data-block-id      every field's frame carries its id ("push.title"), a direct child of `.ucomp-doc`,
//                      so the redline's DOM handle (dom-handle.ts) and the comment markers find it as
//                      they find a block: a message's threads are on its fields. `activeBlockId` tints one.
//   data-fields-document  the root, with its layout; `data-redline-document` stays the body's alone.

import { Fragment, type ReactNode } from "react";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { FieldLabel, LockedFooter } from "@/components/workspace/content/field-chrome";
import { channelFieldsHeading, fieldName, fieldPlatformTag } from "@/domain/channel-fields";
import type { FieldRedline, RedlineBlock } from "@/domain/review-types";
import type { Channel } from "@/domain/types";
import { staticHardBreak } from "@/editor/components/static-document";
import { VariableChipView } from "@/editor/components/variable-chip";
import type { JSONContent, Variable } from "@/editor/model/types";
import { baseExtensions } from "@/editor/schema";
import type { DocumentAlign } from "@/editor/types";
import "@/editor/styles.css";
import { cn } from "@/lib/utils";
import { markAllDeleted } from "./blocks";
import { Gutter } from "./redline-document";
import { RedlineMark } from "./redline-mark";
import "./redline.css";

export interface FieldsDocumentProps {
  /** The fields to show, in registry order: `diffChannelFields(base, version).fields`, or with no base for the clean view. */
  fields: readonly FieldRedline[];
  /** Labels the chips: the variables of the version(s) the fields are from. */
  variables: readonly Variable[];
  /** A message's sections under display headings, or a document's details under caps labels. */
  layout: "sections" | "details";
  /** The level of the channels' headings in the page's outline (2 on the review screen, 3 in a dialog). */
  headingLevel?: 2 | 3;
  /** Show only what changed: an unchanged field reads "Unchanged" (the active one shows in full). */
  changesOnly?: boolean;
  /** The field a comment thread is being read on: tinted, and shown in full with Changes only. */
  activeBlockId?: string | null;
  /** The content type's SMS footer, locked under the message as the composer shows it. */
  smsFooter?: string | null;
  /** Match the document's `align` ("start": the text on the column's left edge). Default "center". */
  align?: DocumentAlign;
  className?: string;
}

/** What a screen reader hears after a field's name when it changed. */
const STATUS_WORD: Record<Exclude<FieldRedline["status"], "unchanged">, string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
};

/** The fields by channel, in the order they come. */
function byChannel(fields: readonly FieldRedline[]): { channel: Channel; fields: FieldRedline[] }[] {
  const groups: { channel: Channel; fields: FieldRedline[] }[] = [];
  for (const item of fields) {
    const last = groups[groups.length - 1];
    if (last && last.channel === item.field.channel) last.fields.push(item);
    else groups.push({ channel: item.field.channel, fields: [item] });
  }
  return groups;
}

/** A field's text: its blocks (normally one paragraph) with the redline's marks, a removed block struck whole. */
function FieldText({ blocks, variables }: { blocks: readonly RedlineBlock[]; variables: readonly Variable[] }) {
  // An empty field still has its line, as the composer's box does.
  if (blocks.length === 0) return <p />;
  const byKey = new Map(variables.map((v) => [v.key, v]));
  const extensions = [...baseExtensions({ variables }), RedlineMark];
  const content: JSONContent = {
    type: "doc",
    content: blocks.map((block) => (block.status === "removed" ? markAllDeleted(block.node) : block.node)),
  };
  return renderToReactElement({
    content,
    extensions,
    options: {
      nodeMapping: {
        variable: ({ node }: { node: PMNode }) => {
          const key = (node.attrs.key as string | null) ?? null;
          return <VariableChipView variableKey={key} variable={key ? byKey.get(key) : undefined} />;
        },
        hardBreak: staticHardBreak,
      },
    },
  });
}

function Field({
  item,
  variables,
  collapsed,
  active,
  footer,
}: {
  item: FieldRedline;
  variables: readonly Variable[];
  collapsed: boolean;
  active: boolean;
  footer: ReactNode;
}) {
  const { field, status } = item;
  const text = <FieldText blocks={item.doc.blocks} variables={variables} />;
  return (
    <div
      role="group"
      aria-label={status === "unchanged" ? fieldName(field) : `${fieldName(field)}, ${STATUS_WORD[status]}`}
      className="rl-item relative"
      data-kind="field"
      data-block-id={field.id}
      // What the hover comment button looks for (a removed field isn't in the version, so it takes no comment).
      data-id={status === "removed" ? undefined : field.id}
      data-active={active ? "" : undefined}
      data-redline={status}
    >
      {status === "unchanged" ? null : <Gutter status={status} />}
      <FieldLabel label={field.label} tag={fieldPlatformTag(field)} />
      {collapsed ? (
        <p data-slot="field-unchanged" className="text-[13px] leading-5 text-text-subtle">
          Unchanged
        </p>
      ) : (
        <div
          data-slot="field-text"
          className="ucomp-field-input min-h-11 rounded-lg border border-hairline bg-surface-tinted px-3 py-2.5 text-[15px] leading-6 text-text"
        >
          {status === "added" ? <ins className="block no-underline">{text}</ins> : text}
          {footer}
        </div>
      )}
    </div>
  );
}

export function FieldsDocument({
  fields,
  variables,
  layout,
  headingLevel = 2,
  changesOnly = false,
  activeBlockId = null,
  smsFooter = null,
  align = "center",
  className,
}: FieldsDocumentProps) {
  if (fields.length === 0) return null;
  return (
    <div
      className={cn("ucomp-surface ucomp-redline ucomp-fields relative", className)}
      data-static-document=""
      data-fields-document={layout}
      data-align={align === "start" ? "start" : undefined}
    >
      <div className="ucomp-doc">
        {byChannel(fields).map(({ channel, fields: own }) => (
          <Fragment key={channel}>
            <div
              role="heading"
              aria-level={headingLevel}
              className={cn(
                "rl-item",
                layout === "sections"
                  ? "font-display text-[1.5rem] leading-[1.35] font-normal tracking-[-0.005em] text-text"
                  : "caps-label",
              )}
              data-kind={layout === "sections" ? "section" : "label"}
            >
              {channelFieldsHeading(channel)}
            </div>
            {own.map((item) => (
              <Field
                key={item.field.id}
                item={item}
                variables={variables}
                collapsed={changesOnly && item.status === "unchanged" && item.field.id !== activeBlockId}
                active={item.field.id === activeBlockId}
                footer={item.field.channel === "sms" && smsFooter ? <LockedFooter text={smsFooter} /> : null}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
