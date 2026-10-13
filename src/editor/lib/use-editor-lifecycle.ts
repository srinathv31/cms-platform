// What a live editor hands to the next one made for the same document.
//
// Next keeps a hidden route alive in <Activity> but runs its effect cleanups, and `useEditor` destroys
// its editor then; when the route shows again a new editor is created. Nothing the author did may
// be lost across that switch, so this hook carries three things from one instance to the next:
//
// - the document: `latestRef` holds the current one (not the initial one), and `onBeforeCreate`
//   gives it to the new editor;
// - the static fallback: `snapshot` is the document to paint while no editor exists, so the page
//   doesn't flash back to the content it started with;
// - the undo history (lib/history-carry.ts): captured as an instance is destroyed, replayed into
//   the next one, so undo still reaches back past the switch.
//
// It also tells the host about each edit (`onChange`), skipping the normalization a new editor
// does on mount.
//
// The caller passes the result's `callbacks` straight into `useEditor`, and says what else to do
// when an instance is ready or gone (`onCreate`, `onDestroy`: focus, the comment bridge).

import type { Editor, UseEditorOptions } from "@tiptap/react";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { JSONContent } from "../model/types";
import {
  captureHistory,
  restoreHistory,
  type HistoryCarry,
} from "./history-carry";

export interface EditorLifecycleOptions {
  initialContent: JSONContent;
  /** The latest document, kept current here. It outlives the editor instance. */
  latestRef: RefObject<JSONContent | null>;
  /** The live instance, set here: null while there is none (before it is ready, and after it is destroyed). */
  editorRef: RefObject<Editor | null>;
  /** Called with the document after each edit, never for the normalization during mount. */
  onChange?: (doc: JSONContent) => void;
  /**
   * An instance is ready. `first` is true only for the first one this component has had, not for one
   * made again after a switch. The undo history is restored right after this returns.
   */
  onCreate: (editor: Editor, info: { first: boolean }) => void;
  /** An instance is going away; its undo history has already been captured. */
  onDestroy: () => void;
}

export interface EditorLifecycle {
  /** The document to paint statically while there is no live editor: the latest one. */
  snapshot: JSONContent;
  /** For `useEditor`. */
  callbacks: Pick<
    UseEditorOptions,
    "onBeforeCreate" | "onCreate" | "onUpdate" | "onDestroy"
  >;
}

export function useEditorLifecycle({
  initialContent,
  latestRef,
  editorRef,
  onChange,
  onCreate,
  onDestroy,
}: EditorLifecycleOptions): EditorLifecycle {
  const [snapshot, setSnapshot] = useState<JSONContent>(initialContent);
  const created = useRef(false);
  const carry = useRef<HistoryCarry | null>(null);

  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  return {
    snapshot,
    callbacks: {
      onBeforeCreate: ({ editor: next }) => {
        if (latestRef.current) next.setOptions({ content: latestRef.current });
      },
      onCreate: ({ editor: ready }) => {
        editorRef.current = ready;
        const first = !created.current;
        created.current = true;
        onCreate(ready, { first });
        if (carry.current) restoreHistory(ready.view, carry.current);
        carry.current = null;
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
        const gone = editorRef.current;
        if (gone) carry.current = captureHistory(gone.state);
        editorRef.current = null;
        onDestroy();
        if (latestRef.current) setSnapshot(latestRef.current);
      },
    },
  };
}
