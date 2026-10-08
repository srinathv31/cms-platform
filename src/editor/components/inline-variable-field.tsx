"use client";

// <InlineVariableField>: a one-line editor for text and variable chips (email subject, preheader).
// It registers with its <EditorRoot> like the document body does, under its own `label`, so the
// panel counts its chips, click-to-insert can target it, panel rows drop into it and the `{{`
// picker, chip popover, key renames and "remove chips" all reach it.
//
// One line: Enter never adds a line, and a multi-line paste joins its lines with spaces
// (extensions/single-line.ts). `{{key}}` in pasted text becomes chips, as in the document.

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useStore } from "zustand";
import { cx } from "../lib/cx";
import { captureHistory, restoreHistory, type HistoryCarry } from "../lib/history-carry";
import { useHydrated } from "../lib/use-hydrated";
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

export function InlineVariableField({ label, value, onChange, id, className }: InlineVariableFieldProps) {
  const root = useEditorRoot("InlineVariableField");
  const readOnly = useStore(root.config, (s) => s.readOnly);
  const variables = useStore(root.variables, (s) => s.variables);
  const hydrated = useHydrated();
  const fieldId = useId();
  const [initial] = useState<JSONContent>(() => value ?? EMPTY_FIELD);
  const latestRef = useRef<JSONContent | null>(null);

  useState(() => {
    if (!root.isCommitted()) root.registerField({ id: fieldId, label, kind: "inline" }, initial);
  });
  useLayoutEffect(() => {
    root.registerField({ id: fieldId, label, kind: "inline" }, latestRef.current ?? initial);
    return () => root.unregisterField(fieldId);
  }, [root, fieldId, label, initial]);

  return (
    <div id={id} className={cx(BOX, FOCUS_WITHIN_RING, className)} data-read-only={readOnly ? "" : undefined}>
      {hydrated ? (
        <LiveField label={label} fieldId={fieldId} initial={initial} latestRef={latestRef} readOnly={readOnly} onChange={onChange} />
      ) : (
        <StaticField label={label} value={initial} variables={variables} />
      )}
    </div>
  );
}

function LiveField({
  label,
  fieldId,
  initial,
  latestRef,
  readOnly,
  onChange,
}: {
  label: string;
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
    inlineFieldExtensions({
      store: root.variables,
      pickerRender: picker.render,
      binding: { fieldId, kind: "inline", root, chip },
    }),
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
        "aria-multiline": "false",
        "aria-readonly": String(readOnly),
      },
    }),
    [label, readOnly],
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
    return <StaticField label={label} value={snapshot} variables={variables} />;
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
function StaticField({ label, value, variables }: { label: string; value: JSONContent; variables: readonly Variable[] }) {
  const byKey = new Map(variables.map((v) => [v.key, v]));
  const inline = value.content?.[0]?.content ?? [];
  return (
    <div className="ucomp-field-input" role="textbox" aria-label={label} aria-readonly="true">
      <p>
        {inline.map((node, i) => {
          if (node.type === NODE.variable) {
            const key = (node.attrs?.key as string | undefined) ?? null;
            return <VariableChipView key={i} variableKey={key} variable={key ? byKey.get(key) : undefined} />;
          }
          return node.type === "text" ? <span key={i}>{node.text}</span> : null;
        })}
      </p>
    </div>
  );
}
