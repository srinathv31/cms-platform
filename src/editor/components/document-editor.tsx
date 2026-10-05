"use client";

// <DocumentEditor>: the live editor. Content in, onChange out; the host owns persistence,
// permissions and the lifecycle. Inside an <EditorRoot> it shares the root's variable list with the
// panel and inline fields; on its own it creates a private root from its own props.
//
// Paint order: the server (and the hydration pass) render <StaticDocument>, the same markup the
// editor produces; the live TipTap editor mounts only after hydration and swaps in with no
// visible change. Keeping useEditor out of the server render also keeps prerendering pure
// (TipTap seeds instance ids with Math.random, which Cache Components rejects at prerender).
//
// Review comments (Phase 4): `threads` / `activeThreadId` are highlights (extensions/review-threads.ts,
// in the static paint too); `onRequestComment` adds Comment to the toolbar (read-only too) and
// ⌘⌥M; the handle places and reveals threads for the host (lib/block-rects.ts). Mechanics only: the
// host draws the threads themselves.

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
import { modKey } from "../lib/platform";
import { focusFirstSection } from "../lib/sections";
import { blockRequestAt, commentTarget, variableLeafText, type LeafText } from "../lib/threads";
import type { JSONContent, Variable } from "../model/types";
import type { DocumentEditorHandle, DocumentEditorProps, FocusTarget, ThreadAnchor } from "../types";
import { cx } from "../lib/cx";
import { useHydrated } from "../lib/use-hydrated";
import { editorExtensions } from "../schema";
import { createChipPopoverStore } from "../state/chip-popover";
import { BODY_FIELD_LABEL, type EditorRootRuntime } from "../state/editor-root";
import { ChipPopover } from "./chip-popover";
import { DOC_CLASS, SURFACE_CLASS } from "./classes";
import { createCommentBridge, type CommentBridge } from "./comment-bridge";
import { EditorRoot, useOptionalEditorRoot } from "./editor-root";
import { FormatBubble, hideFormatBubble, type CommentActions } from "./format-bubble";
import { SlashMenu, createSlashMenuController } from "./slash-menu";
import { StaticDocument } from "./static-document";
import { TableMenu } from "./table-menu";
import { VariablePicker, createVariablePickerController } from "./variable-picker";
import "../styles.css";

// The block handle is loaded on the client only. The official DragHandle pulls in Yjs, whose lib0
// probes `localStorage` when its module evaluates, and on Node 26 that probe prints an
// ExperimentalWarning during prerender. The handle only renders with the live editor (client-only),
// so the server never needs it. The browser starts the load as this module evaluates, and the live
// editor waits for it, so the handle mounts in the same commit as the editor: registering its
// plugin later would reconfigure the view and close a slash menu that is already open.
// The handle is optional chrome: if its chunk fails to load (a network blip, a redeploy under an
// open tab), the editor mounts without it, still editable, and the next editor mounted tries again.
type BlockHandleModule = typeof import("./block-handle");
let blockHandleModule: BlockHandleModule | null = null;
let blockHandleLoad: Promise<BlockHandleModule | null> | null = null;
/** The block handle's module, or null when it failed to load. Never rejects. */
function loadBlockHandle(): Promise<BlockHandleModule | null> {
  blockHandleLoad ??= import("./block-handle").then(
    (m) => (blockHandleModule = m),
    () => {
      blockHandleLoad = null;
      return null;
    },
  );
  return blockHandleLoad;
}
if (typeof window !== "undefined") void loadBlockHandle();

/** True once the block handle's load has settled, loaded or failed (never on the server). */
function useBlockHandleSettled(): boolean {
  const [settled, setSettled] = useState(blockHandleModule !== null);
  useEffect(() => {
    if (settled) return;
    let live = true;
    void loadBlockHandle().then(() => live && setSettled(true));
    return () => {
      live = false;
    };
  }, [settled]);
  return settled;
}

/** Renders the loaded BlockHandle (nothing when it failed to load); mounted once useBlockHandleSettled() is true. */
function LoadedBlockHandle(props: Parameters<BlockHandleModule["BlockHandle"]>[0]) {
  const loaded = blockHandleModule;
  return loaded ? <loaded.BlockHandle {...props} /> : null;
}

const NO_VARIABLES: Variable[] = [];
const NO_THREADS: readonly ThreadAnchor[] = [];

/** A stable key for a thread list, so a host re-rendering the same threads costs nothing. */
function threadsKey(threads: readonly ThreadAnchor[] | undefined): string {
  return (threads ?? NO_THREADS).map((t) => `${t.id}\u0001${t.blockId}\u0001${t.quote ?? ""}\u0001${t.status}`).join("\u0002");
}

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
  threads,
  activeThreadId = null,
  onThreadClick,
  onCaretThreadChange,
  onRequestComment,
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
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Review comments: the host's threads and handlers, read by the live editor through the bridge.
  const [bridge] = useState(createCommentBridge);
  useLayoutEffect(() => {
    bridge.setHandlers({ onThreadClick, onCaretThreadChange, onRequestComment });
  });
  const commentsOn = !!onRequestComment;
  // New threads go to the live editor by content (an equal list re-rendered is a no-op)…
  const threadKey = threadsKey(threads);
  useLayoutEffect(() => {
    bridge.setThreads(threads);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by content (threadKey), not identity
  }, [bridge, threadKey]);
  // …and so does a new active thread (it also replaces one that focusThread() set).
  useLayoutEffect(() => {
    bridge.setActive(activeThreadId);
  }, [bridge, activeThreadId]);
  // Block positions change with the wrapper's size (and when blocks move: see LiveEditor).
  useLayoutEffect(() => {
    bridge.attach(wrapperRef.current);
    return () => bridge.attach(null);
  }, [bridge]);

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
    (): DocumentEditorHandle => ({
      focus: (target) => {
        const editor = editorRef.current;
        if (!editor || editor.isDestroyed || !editor.isInitialized) {
          pendingFocusRef.current = target ?? "restore";
          return;
        }
        applyFocus(editor, target ?? "restore");
      },
      focusThread: bridge.focusThread,
      getBlockRect: bridge.blockRect,
      getThreadRect: bridge.threadRect,
      subscribeBlockRects: bridge.subscribeRects,
      requestComment: (blockId) => {
        if (blockId) bridge.requestComment({ blockId });
      },
    }),
    [bridge],
  );

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={wrapperRef}
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
            bridge={bridge}
            commentsOn={commentsOn}
            threads={threads}
            activeThreadId={activeThreadId}
          />
        ) : (
          <StaticDocument content={initialContent} variables={variables} threads={threads} activeThreadId={activeThreadId} />
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
  bridge: CommentBridge;
  commentsOn: boolean;
  /** For the static fallback only (the live editor reads the bridge). */
  threads: readonly ThreadAnchor[] | undefined;
  activeThreadId: string | null;
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
  bridge,
  commentsOn,
  threads,
  activeThreadId,
}: LiveEditorProps) {
  // Per-instance, created once.
  const [slash] = useState(createSlashMenuController);
  const [picker] = useState(createVariablePickerController);
  const [chip] = useState(createChipPopoverStore);
  const [leafText] = useState<LeafText>(() => variableLeafText((key) => root.variables.getState().byKey.get(key)));
  const [extensions] = useState(() =>
    editorExtensions({
      store: root.variables,
      slashRender: slash.render,
      pickerRender: picker.render,
      binding: { fieldId, kind: "body", root, chip },
      requiredNote: () => root.config.getState().requiredNote,
      reviewThreads: { initial: bridge.initial, onThreadClick: bridge.threadClick, onCaretThread: bridge.caretThread },
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

  const blockHandleSettled = useBlockHandleSettled();
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
      bridge.connect(ready);
    },
    onTransaction: ({ transaction }) => {
      if (transaction.docChanged) bridge.docChanged(transaction.before, transaction.doc);
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
      bridge.connect(null);
      if (latestRef.current) setSnapshot(latestRef.current);
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isEditable === !readOnly) return;
    editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  // The Comment action (toolbar) and ⌘⌥M, only while the host takes comment requests.
  const comments = useMemo<CommentActions | null>(
    () =>
      commentsOn
        ? { target: (state) => commentTarget(state, leafText), request: bridge.requestComment }
        : null,
    [commentsOn, leafText, bridge],
  );
  useEffect(() => {
    if (!comments) return;
    // On the page, not the document: a read-only document never has focus.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.code !== "KeyM" || !event.altKey || event.shiftKey || !modKey(event)) return;
      const live = editorRef.current;
      if (!live || live.isDestroyed) return;
      const { view, state } = live;
      if (live.isEditable ? !view.hasFocus() : !selectionTouches(view.dom)) return;
      const anchor = state.selection.empty ? blockRequestAt(state, state.selection.head) : comments.target(state);
      if (!anchor) return;
      event.preventDefault();
      hideFormatBubble(live);
      comments.request(anchor);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [comments, editorRef]);

  if (!editor || editor.isDestroyed || (!readOnly && !blockHandleSettled)) {
    return <StaticDocument content={snapshot} variables={variables} threads={threads} activeThreadId={activeThreadId} />;
  }

  return (
    <>
      <EditorContent editor={editor} className={SURFACE_CLASS} />
      <ChipPopover editor={editor} root={root} chip={chip} />
      {readOnly ? null : <LoadedBlockHandle editor={editor} slash={slash} />}
      {readOnly ? null : <TableMenu editor={editor} />}
      {/* Read-only, the toolbar holds Comment alone (when the host takes comments). */}
      {readOnly && !comments ? null : <FormatBubble editor={editor} comments={comments} />}
      {readOnly ? null : <SlashMenu controller={slash} editor={editor} />}
      {readOnly ? null : <VariablePicker controller={picker} editor={editor} root={root} />}
    </>
  );
}

/** The page's selection is inside `dom` (a click in a read-only document leaves a caret there, too). */
function selectionTouches(dom: HTMLElement): boolean {
  const selection = dom.ownerDocument.getSelection();
  return !!selection?.anchorNode && dom.contains(selection.anchorNode) && !!selection.focusNode && dom.contains(selection.focusNode);
}

function applyFocus(editor: Editor, target: FocusTarget | "restore") {
  if (target === "first-section") {
    if (editor.isEditable) focusFirstSection(editor);
    else editor.commands.focus("start");
    return;
  }
  editor.commands.focus(target === "restore" ? null : target);
}
