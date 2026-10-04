"use client";

// <DocumentEditor>: the live editor. Content in, onChange out; the host owns persistence,
// permissions and the lifecycle.
//
// Paint order: the server (and the hydration pass) render <StaticDocument>, the same markup the
// editor produces; the live TipTap editor mounts only after hydration and swaps in with no
// visible change. Keeping useEditor out of the server render also keeps prerendering pure
// (TipTap seeds instance ids with Math.random, which Cache Components rejects at prerender).

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { MotionConfig } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { JSONContent } from "../model/types";
import type { DocumentEditorProps } from "../types";
import { cx } from "../lib/cx";
import { editorExtensions } from "../schema";
import { createVariableStore } from "../state/variable-store";
import { BlockHandle } from "./block-handle";
import { DOC_CLASS, SURFACE_CLASS } from "./classes";
import { FormatBubble } from "./format-bubble";
import { SlashMenu, createSlashMenuController } from "./slash-menu";
import { StaticDocument } from "./static-document";
import "../styles.css";

const noopSubscribe = () => () => {};

/** False on the server and during hydration, true afterwards. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function DocumentEditor(props: DocumentEditorProps) {
  const hydrated = useHydrated();
  const { readOnly = false, className } = props;
  return (
    <MotionConfig reducedMotion="user">
      <div className={cx("ucomp-editor", className)} data-read-only={readOnly ? "" : undefined}>
        {hydrated ? <LiveEditor {...props} /> : <StaticDocument content={props.content} variables={props.variables} />}
      </div>
    </MotionConfig>
  );
}

function LiveEditor({ content, variables, readOnly = false, onChange, autoFocus = false }: DocumentEditorProps) {
  // Per-instance, created once. `content` and `autoFocus` are initial values: to load a different
  // document, remount with a new React key.
  const [store] = useState(() => createVariableStore(variables));
  const [slash] = useState(createSlashMenuController);
  const [extensions] = useState(() => editorExtensions({ store, slashRender: slash.render }));
  const [initialContent] = useState(content);
  const [initialFocus] = useState(autoFocus);

  // Next keeps hidden routes alive in <Activity> but runs effect cleanups, and useEditor destroys
  // the editor then; when the route shows again a new editor is created. `latest` hands it the
  // current document (not the initial one), and `snapshot` keeps the static fallback current.
  const latest = useRef<JSONContent | null>(null);
  const [snapshot, setSnapshot] = useState<JSONContent>(content);
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
      if (latest.current) next.setOptions({ content: latest.current });
    },
    onCreate: ({ editor: ready }) => {
      if (!created.current && initialFocus === "first-section" && ready.isEditable) focusFirstSection(ready);
      created.current = true;
    },
    onUpdate: ({ editor: updated }) => {
      // Skip normalization during mount (missing block ids, a trailing paragraph): it isn't an
      // edit, and the host would otherwise autosave a document the author never touched.
      if (!updated.isInitialized) return;
      const doc = updated.getJSON();
      latest.current = doc;
      onChangeRef.current?.(doc);
    },
    onDestroy: () => {
      if (latest.current) setSnapshot(latest.current);
    },
  });

  useEffect(() => {
    store.getState().setVariables(variables);
  }, [store, variables]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isEditable === !readOnly) return;
    editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  if (!editor || editor.isDestroyed) return <StaticDocument content={snapshot} variables={variables} />;

  return (
    <>
      <EditorContent editor={editor} className={SURFACE_CLASS} />
      {readOnly ? null : (
        <>
          <BlockHandle editor={editor} />
          <FormatBubble editor={editor} />
          <SlashMenu controller={slash} editor={editor} />
        </>
      )}
    </>
  );
}

/**
 * Puts the caret at the start of the first required section's body. If the section has no body
 * yet (a Blank document is just the required headings), adds an empty line under its heading.
 */
function focusFirstSection(editor: Editor) {
  const { doc } = editor.state;
  let headingEnd = -1;
  let hasBody = false;
  doc.forEach((node, offset, index) => {
    if (headingEnd >= 0 || node.type.name !== "heading" || !node.attrs.requiredKey) return;
    headingEnd = offset + node.nodeSize;
    hasBody = doc.maybeChild(index + 1)?.type.name === "paragraph";
  });

  if (headingEnd < 0) {
    editor.commands.focus("start");
    return;
  }
  const chain = editor.chain();
  if (!hasBody) {
    chain
      .command(({ tr }) => {
        tr.setMeta("addToHistory", false);
        return true;
      })
      .insertContentAt(headingEnd, { type: "paragraph" }, { updateSelection: false });
  }
  chain.focus(headingEnd + 1).run();
}
