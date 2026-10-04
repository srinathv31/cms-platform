"use client";

// <DocumentEditor>: the live editor. Content in, onChange out; the host owns persistence,
// permissions and the lifecycle. Inside an <EditorRoot> it shares the root's variable list with the
// panel and inline fields; on its own it creates a private root from its own props.
//
// Paint order: the server (and the hydration pass) render <StaticDocument>, the same markup the
// editor produces; the live TipTap editor mounts only after hydration and swaps in with no
// visible change. Keeping useEditor out of the server render also keeps prerendering pure
// (TipTap seeds instance ids with Math.random, which Cache Components rejects at prerender).

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { MotionConfig } from "motion/react";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useStore } from "zustand";
import { focusFirstSection } from "../lib/sections";
import type { JSONContent, Variable } from "../model/types";
import type { DocumentEditorProps, FocusTarget } from "../types";
import { cx } from "../lib/cx";
import { useHydrated } from "../lib/use-hydrated";
import { editorExtensions } from "../schema";
import { createChipPopoverStore } from "../state/chip-popover";
import { BODY_FIELD_LABEL, type EditorRootRuntime } from "../state/editor-root";
import { BlockHandle } from "./block-handle";
import { ChipPopover } from "./chip-popover";
import { DOC_CLASS, SURFACE_CLASS } from "./classes";
import { EditorRoot, useOptionalEditorRoot } from "./editor-root";
import { FormatBubble } from "./format-bubble";
import { SlashMenu, createSlashMenuController } from "./slash-menu";
import { StaticDocument } from "./static-document";
import { TableMenu } from "./table-menu";
import { VariablePicker, createVariablePickerController } from "./variable-picker";
import "../styles.css";

const NO_VARIABLES: Variable[] = [];

export function DocumentEditor(props: DocumentEditorProps) {
  const root = useOptionalEditorRoot();
  if (root) return <RootedDocumentEditor {...props} root={root} />;
  // Standalone: a private root from this editor's own props.
  return (
    <EditorRoot
      variables={props.variables ?? NO_VARIABLES}
      requiredSections={props.requiredSections}
      readOnly={props.readOnly}
      onVariablesChange={props.onVariablesChange}
      requiredNote={props.requiredNote}
    >
      <DocumentEditor {...props} />
    </EditorRoot>
  );
}

function RootedDocumentEditor({
  root,
  ref,
  content,
  onChange,
  autoFocus = false,
  align = "center",
  className,
}: DocumentEditorProps & { root: EditorRootRuntime }) {
  const hydrated = useHydrated();
  const readOnly = useStore(root.config, (s) => s.readOnly);
  const variables = useStore(root.variables, (s) => s.variables);
  const fieldId = useId();
  const [initialContent] = useState(content);

  // The latest document (outlives the editor instance: see LiveEditor) and the editor itself.
  const latestRef = useRef<JSONContent | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const pendingFocusRef = useRef<FocusTarget | "restore" | null>(null);

  // Register the body with the root. In the root's first render pass this happens during render,
  // so a panel that renders after the document (on the server too) already has its usage counts.
  useState(() => {
    if (!root.isCommitted()) root.registerField({ id: fieldId, label: BODY_FIELD_LABEL, kind: "body" }, initialContent);
  });
  useLayoutEffect(() => {
    root.registerField({ id: fieldId, label: BODY_FIELD_LABEL, kind: "body" }, latestRef.current ?? initialContent);
    return () => root.unregisterField(fieldId);
  }, [root, fieldId, initialContent]);

  useImperativeHandle(
    ref,
    () => ({
      focus: (target) => {
        const editor = editorRef.current;
        if (!editor || editor.isDestroyed || !editor.isInitialized) {
          pendingFocusRef.current = target ?? "restore";
          return;
        }
        applyFocus(editor, target ?? "restore");
      },
    }),
    [],
  );

  return (
    <MotionConfig reducedMotion="user">
      <div
        className={cx("ucomp-editor", className)}
        data-read-only={readOnly ? "" : undefined}
        data-align={align === "start" ? "start" : undefined}
      >
        {hydrated ? (
          <LiveEditor
            root={root}
            fieldId={fieldId}
            initialContent={initialContent}
            readOnly={readOnly}
            onChange={onChange}
            autoFocus={autoFocus}
            latestRef={latestRef}
            editorRef={editorRef}
            pendingFocusRef={pendingFocusRef}
            variables={variables}
          />
        ) : (
          <StaticDocument content={initialContent} variables={variables} />
        )}
      </div>
    </MotionConfig>
  );
}

interface LiveEditorProps {
  root: EditorRootRuntime;
  fieldId: string;
  initialContent: JSONContent;
  readOnly: boolean;
  onChange?: (doc: JSONContent) => void;
  autoFocus: FocusTarget | false;
  latestRef: RefObject<JSONContent | null>;
  editorRef: RefObject<Editor | null>;
  pendingFocusRef: RefObject<FocusTarget | "restore" | null>;
  variables: readonly Variable[];
}

function LiveEditor({
  root,
  fieldId,
  initialContent,
  readOnly,
  onChange,
  autoFocus,
  latestRef,
  editorRef,
  pendingFocusRef,
  variables,
}: LiveEditorProps) {
  // Per-instance, created once.
  const [slash] = useState(createSlashMenuController);
  const [picker] = useState(createVariablePickerController);
  const [chip] = useState(createChipPopoverStore);
  const [extensions] = useState(() =>
    editorExtensions({
      store: root.variables,
      slashRender: slash.render,
      pickerRender: picker.render,
      binding: { fieldId, kind: "body", root, chip },
      requiredNote: () => root.config.getState().requiredNote,
    }),
  );
  const [initialFocus] = useState(autoFocus);

  // Next keeps hidden routes alive in <Activity> but runs effect cleanups, and useEditor destroys
  // the editor then; when the route shows again a new editor is created. `latestRef` hands it the
  // current document (not the initial one), and `snapshot` keeps the static fallback current.
  const [snapshot, setSnapshot] = useState<JSONContent>(initialContent);
  const created = useRef(false);

  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  // Stable per readOnly value: useEditor re-applies options whenever their identity changes.
  const editorProps = useMemo(
    () => ({
      attributes: { class: DOC_CLASS, "aria-label": "Document", "aria-readonly": String(readOnly) },
    }),
    [readOnly],
  );

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    // styles.css carries the ProseMirror essentials so the static render matches exactly.
    injectCSS: false,
    extensions,
    content: initialContent,
    editable: !readOnly,
    autofocus: initialFocus === "start" || initialFocus === "end" ? initialFocus : false,
    editorProps,
    onBeforeCreate: ({ editor: next }) => {
      if (latestRef.current) next.setOptions({ content: latestRef.current });
    },
    onCreate: ({ editor: ready }) => {
      editorRef.current = ready;
      if (!created.current && initialFocus === "first-section" && ready.isEditable) focusFirstSection(ready);
      created.current = true;
      const pending = pendingFocusRef.current;
      pendingFocusRef.current = null;
      if (pending) applyFocus(ready, pending);
    },
    onUpdate: ({ editor: updated }) => {
      // Skip normalization during mount (missing block ids, a trailing paragraph): it isn't an
      // edit, and the host would otherwise autosave a document the author never touched.
      if (!updated.isInitialized) return;
      const doc = updated.getJSON();
      latestRef.current = doc;
      onChangeRef.current?.(doc);
    },
    onDestroy: () => {
      editorRef.current = null;
      if (latestRef.current) setSnapshot(latestRef.current);
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isEditable === !readOnly) return;
    editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  if (!editor || editor.isDestroyed) return <StaticDocument content={snapshot} variables={variables} />;

  return (
    <>
      <EditorContent editor={editor} className={SURFACE_CLASS} />
      <ChipPopover editor={editor} root={root} chip={chip} />
      {readOnly ? null : (
        <>
          <BlockHandle editor={editor} slash={slash} />
          <TableMenu editor={editor} />
          <FormatBubble editor={editor} />
          <SlashMenu controller={slash} editor={editor} />
          <VariablePicker controller={picker} editor={editor} root={root} />
        </>
      )}
    </>
  );
}

function applyFocus(editor: Editor, target: FocusTarget | "restore") {
  if (target === "first-section") {
    if (editor.isEditable) focusFirstSection(editor);
    else editor.commands.focus("start");
    return;
  }
  editor.commands.focus(target === "restore" ? null : target);
}
