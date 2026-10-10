"use client";

// <InlineVariableField>: an editor for a channel field's text and variable chips (the email subject
// and preheader, a push title or body, an SMS message). It registers with its <EditorRoot> like the
// document body does, under its own `label`, so the panel counts its chips, click-to-insert can target
// it, panel rows drop into it and the `{{` picker, chip popover, key renames and "remove chips" all
// reach it.
//
// One line by default: Enter never adds a line, and a multi-line paste joins its lines with spaces
// (extensions/single-line.ts). With `lines="lines"` it keeps line breaks as hard breaks: Enter adds
// one and a paste keeps its lines (extensions/field-lines.ts). `{{key}}` in pasted text becomes
// chips, as in the document.
//
// `hidden` keeps the field mounted and registered while it isn't shown, so its chips still count
// and a key renamed meanwhile still reaches them (and `onChange` reports it). Unmounting it instead
// would leave its chips on the old key.

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useStore } from "zustand";
import { cx } from "../lib/cx";
import { captureHistory, restoreHistory, type HistoryCarry } from "../lib/history-carry";
import { useHydrated } from "../lib/use-hydrated";
import type { FieldLines } from "../model/normalize";
import { NODE, type JSONContent, type Variable } from "../model/types";
import { inlineFieldExtensions } from "../schema";
import { createChipPopoverStore } from "../state/chip-popover";
import type { InlineVariableFieldProps } from "../types";
import { ChipPopover } from "./chip-popover";
import { FOCUS_WITHIN_RING } from "./classes";
import { useEditorRoot } from "./editor-root";
import { VariableChipView } from "./variable-chip";
import { VariablePicker, createVariablePickerController } from "./variable-picker";
import "../styles.css";

const BOX =
  "ucomp-field min-h-9 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-sm leading-6 text-text transition-colors data-read-only:bg-surface-tinted";

const EMPTY_FIELD: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

export function InlineVariableField({ label, value, lines = "line", onChange, hidden = false, id, className }: InlineVariableFieldProps) {
  const root = useEditorRoot("InlineVariableField");
  const readOnly = useStore(root.config, (s) => s.readOnly);
  const variables = useStore(root.variables, (s) => s.variables);
  const hydrated = useHydrated();
  const fieldId = useId();
  const [initial] = useState<JSONContent>(() => value ?? EMPTY_FIELD);
  const [mode] = useState<FieldLines>(lines);
  const latestRef = useRef<JSONContent | null>(null);

  useState(() => {
    if (!root.isCommitted()) root.registerField({ id: fieldId, label, kind: "inline" }, initial);
  });
  useLayoutEffect(() => {
    root.registerField({ id: fieldId, label, kind: "inline" }, latestRef.current ?? initial);
    return () => root.unregisterField(fieldId);
  }, [root, fieldId, label, initial]);
  // After every (re-)registration above, and whenever it changes: a hidden field is no target for insert, undo or redo.
  useLayoutEffect(() => {
    root.setFieldHidden(fieldId, hidden);
  }, [root, fieldId, label, initial, hidden]);

  return (
    <div id={id} hidden={hidden} className={cx(BOX, FOCUS_WITHIN_RING, className)} data-read-only={readOnly ? "" : undefined}>
      {hydrated ? (
        <LiveField
          label={label}
          lines={mode}
          fieldId={fieldId}
          initial={initial}
          latestRef={latestRef}
          readOnly={readOnly}
          onChange={onChange}
        />
      ) : (
        <StaticField label={label} lines={mode} value={initial} variables={variables} />
      )}
    </div>
  );
}

function LiveField({
  label,
  lines,
  fieldId,
  initial,
  latestRef,
  readOnly,
  onChange,
}: {
  label: string;
  lines: FieldLines;
  fieldId: string;
  initial: JSONContent;
  latestRef: RefObject<JSONContent | null>;
  readOnly: boolean;
  onChange?: (value: JSONContent) => void;
}) {
  const root = useEditorRoot("InlineVariableField");
  const variables = useStore(root.variables, (s) => s.variables);
  const [picker] = useState(createVariablePickerController);
  const [chip] = useState(createChipPopoverStore);
  const [extensions] = useState(() =>
    inlineFieldExtensions(
      {
        store: root.variables,
        pickerRender: picker.render,
        binding: { fieldId, kind: "inline", root, chip },
      },
      lines,
    ),
  );

  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  const editorProps = useMemo(
    () => ({
      attributes: {
        class: "ucomp-field-input",
        role: "textbox",
        "aria-label": label,
        "aria-multiline": String(lines === "lines"),
        "aria-readonly": String(readOnly),
      },
    }),
    [label, lines, readOnly],
  );

  // Like the document: a field destroyed while its route is hidden comes back with its latest value,
  // and its undo history.
  const [snapshot, setSnapshot] = useState<JSONContent>(initial);
  const carry = useRef<HistoryCarry | null>(null);
  const live = useRef<Editor | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    injectCSS: false,
    extensions,
    content: initial,
    editable: !readOnly,
    editorProps,
    onBeforeCreate: ({ editor: next }) => {
      if (latestRef.current) next.setOptions({ content: latestRef.current });
    },
    onCreate: ({ editor: ready }) => {
      live.current = ready;
      if (carry.current) restoreHistory(ready.view, carry.current);
      carry.current = null;
    },
    onUpdate: ({ editor: updated }) => {
      if (!updated.isInitialized) return;
      const doc = updated.getJSON();
      latestRef.current = doc;
      onChangeRef.current?.(doc);
    },
    onDestroy: () => {
      if (live.current) carry.current = captureHistory(live.current.state);
      live.current = null;
      if (latestRef.current) setSnapshot(latestRef.current);
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isEditable === !readOnly) return;
    editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  if (!editor || editor.isDestroyed) {
    return <StaticField label={label} lines={lines} value={snapshot} variables={variables} />;
  }

  return (
    <>
      <EditorContent editor={editor} />
      <ChipPopover editor={editor} root={root} chip={chip} />
      {readOnly ? null : <VariablePicker controller={picker} editor={editor} root={root} />}
    </>
  );
}

/** Same markup as the live field, for the server and the hydration pass. */
function StaticField({
  label,
  lines,
  value,
  variables,
}: {
  label: string;
  lines: FieldLines;
  value: JSONContent;
  variables: readonly Variable[];
}) {
  const byKey = new Map(variables.map((v) => [v.key, v]));
  const inline = value.content?.[0]?.content ?? [];
  return (
    <div className="ucomp-field-input" role="textbox" aria-label={label} aria-multiline={lines === "lines" ? "true" : undefined} aria-readonly="true">
      <p>
        {inline.map((node, i) => {
          if (node.type === NODE.variable) {
            const key = (node.attrs?.key as string | undefined) ?? null;
            return <VariableChipView key={i} variableKey={key} variable={key ? byKey.get(key) : undefined} />;
          }
          if (node.type === "hardBreak") return <br key={i} />;
          return node.type === "text" ? <span key={i}>{node.text}</span> : null;
        })}
      </p>
    </div>
  );
}
