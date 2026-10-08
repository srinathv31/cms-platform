// Safe access to an editor's view from React effects, observers, timers and handlers.
//
// TipTap's `editor.view` throws while the view isn't mounted: before mount, after destroy, and
// while Next re-shows a hidden route (<Activity>), when effects run again before the editor is
// back. Everything outside ProseMirror's own plugins reads the view through these helpers.

import type { Editor } from "@tiptap/core";
import { useEffect, useLayoutEffect, useRef } from "react";

/** The editor's DOM element, or null while its view isn't mounted. */
export function viewDom(editor: Editor): HTMLElement | null {
  return editor.isDestroyed ? null : editor.view.dom;
}

/**
 * Calls `attach(dom)` whenever the editor's view is mounted (now, or when it mounts later), and the
 * cleanup it returns when the view goes away (unmount, destroy) or the component unmounts.
 */
export function useViewDom(editor: Editor, attach: (dom: HTMLElement) => void | (() => void)) {
  const attachRef = useRef(attach);
  useLayoutEffect(() => {
    attachRef.current = attach;
  });

  useEffect(() => {
    let cleanup: (() => void) | void;
    const detach = () => {
      cleanup?.();
      cleanup = undefined;
    };
    const connect = () => {
      detach();
      const dom = viewDom(editor);
      if (dom) cleanup = attachRef.current(dom);
    };
    connect();
    editor.on("mount", connect);
    editor.on("unmount", detach);
    editor.on("destroy", detach);
    return () => {
      editor.off("mount", connect);
      editor.off("unmount", detach);
      editor.off("destroy", detach);
      detach();
    };
  }, [editor]);
}

/**
 * Puts focus back in the text without scrolling the page: a menu's `finalFocus` (it returns false,
 * so the menu doesn't move focus itself). ProseMirror's own focus writes its selection into the
 * page as it focuses. Focusing the element alone lets the browser drop the caret at the document's
 * start whenever the page's selection had left the editor (nothing clicked yet, or a press on the
 * block handle's grip), and ProseMirror then scrolls back to its own selection, wherever that is.
 */
export function refocusText(editor: Editor): false {
  queueMicrotask(() => {
    if (!editor.isDestroyed) editor.view.focus();
  });
  return false;
}
