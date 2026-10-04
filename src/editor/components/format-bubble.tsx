"use client";

// Floating format toolbar on the official BubbleMenu (@tiptap/react/menus):
// Bold, Italic, Underline and Link (Link swaps the bar for a small inline URL field; ⌘K opens it).
// Toolbar state comes from useEditorState selectors, so typing never re-renders it.

import { isNodeRangeSelection } from "@tiptap/extension-node-range";
import { NodeSelection, PluginKey, type EditorState } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Check, Italic, Link2, Underline, Unlink } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { headingsIn } from "../extensions/required-sections";
import { cx } from "../lib/cx";
import { useViewDom } from "../lib/editor-view";
import { FOCUS_RING } from "./classes";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";

const MENU_OPTIONS = { placement: "top", offset: 8, flip: true, shift: { padding: 8 } } as const;

const bubbleKey = new PluginKey("formatBubble");

const TOGGLE = cx(
  "size-8 min-w-8 rounded-md px-0 text-label hover:bg-hover hover:text-text aria-pressed:bg-selected aria-pressed:text-text",
  FOCUS_RING,
);

const ICON = { className: "size-4", strokeWidth: 1.75, "aria-hidden": true } as const;

function shouldShow({ editor, state, element }: { editor: Editor; state: EditorState; element: HTMLElement }) {
  if (editor.isDestroyed) return false;
  const { selection, doc } = state;
  if (!editor.isEditable || selection.empty) return false;
  // Text only: a selected chip or a dragged block range has nothing to format.
  if (selection instanceof NodeSelection || isNodeRangeSelection(selection)) return false;
  if (!(editor.view.hasFocus() || element.contains(document.activeElement))) return false;
  // Required section headings take no formatting.
  if (headingsIn(doc, selection.from, selection.to).length) return false;
  return doc.textBetween(selection.from, selection.to, " ", "").trim().length > 0;
}

export function FormatBubble({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  // Stable: BubbleMenu dispatches an options update whenever this object changes.
  const options = useMemo(() => ({ ...MENU_OPTIONS, onHide: () => setLinkOpen(false) }), []);
  const menuRef = useRef<HTMLDivElement>(null);

  // BubbleMenu debounces its updates (so it doesn't chase a drag-selection). When the selection
  // turns into something that can't be formatted (a chip, a block), hide at once instead of
  // letting the bar hover over the chip for the debounce window.
  useEffect(() => {
    const onSelection = () => {
      if (editor.isDestroyed) return;
      const element = menuRef.current;
      if (!element?.isConnected || shouldShow({ editor, state: editor.state, element })) return;
      editor.view.dispatch(editor.state.tr.setMeta(bubbleKey, "hide"));
    };
    editor.on("selectionUpdate", onSelection);
    return () => {
      editor.off("selectionUpdate", onSelection);
    };
  }, [editor]);

  // ⌘K / Ctrl+K on selected text opens the link field.
  useViewDom(editor, (dom) => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const element = menuRef.current;
      if (!element || !shouldShow({ editor, state: editor.state, element })) return;
      event.preventDefault();
      setLinkOpen(true);
    };
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  });

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  return (
    <BubbleMenu
      ref={menuRef}
      editor={editor}
      pluginKey={bubbleKey}
      shouldShow={shouldShow}
      updateDelay={150}
      options={options}
      className="z-40"
    >
      <div
        role="toolbar"
        aria-label="Format text"
        className="flex items-center gap-0.5 rounded-lg border border-hairline bg-surface p-1 shadow-pop"
        onMouseDown={(event) => {
          // Keep the editor's selection while clicking toolbar buttons.
          if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
        }}
      >
        {linkOpen ? (
          <LinkField
            editor={editor}
            initialHref={active.href}
            hasLink={active.link}
            onClose={() => setLinkOpen(false)}
          />
        ) : (
          <>
            <Toggle
              size="sm"
              className={TOGGLE}
              aria-label="Bold"
              pressed={active.bold}
              onPressedChange={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold {...ICON} />
            </Toggle>
            <Toggle
              size="sm"
              className={TOGGLE}
              aria-label="Italic"
              pressed={active.italic}
              onPressedChange={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic {...ICON} />
            </Toggle>
            <Toggle
              size="sm"
              className={TOGGLE}
              aria-label="Underline"
              pressed={active.underline}
              onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
            >
              <Underline {...ICON} />
            </Toggle>
            <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
            <Toggle
              size="sm"
              className={TOGGLE}
              aria-label="Link"
              pressed={active.link}
              onPressedChange={() => setLinkOpen(true)}
            >
              <Link2 {...ICON} />
            </Toggle>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}

function LinkField({
  editor,
  initialHref,
  hasLink,
  onClose,
}: {
  editor: Editor;
  initialHref: string;
  hasLink: boolean;
  onClose: () => void;
}) {
  const [href, setHref] = useState(initialHref);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const value = normalizeHref(href);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (value) chain.setLink({ href: value }).run();
    else chain.unsetLink().run();
    onClose();
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      editor.commands.focus();
    }
  };

  return (
    <form onSubmit={apply} className="flex items-center gap-1">
      <Input
        autoFocus
        type="text"
        inputMode="url"
        aria-label="Link address"
        placeholder="https://"
        value={href}
        onChange={(event) => setHref(event.target.value)}
        onKeyDown={onKeyDown}
        className="h-8 w-64 rounded-md border-transparent bg-surface-sunken px-2.5 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0"
      />
      <Button type="submit" size="icon-sm" variant="ghost" aria-label="Apply link" className={cx("size-8 text-label hover:bg-hover hover:text-text", FOCUS_RING)}>
        <Check {...ICON} />
      </Button>
      {hasLink ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Remove link"
          className={cx("size-8 text-label hover:bg-hover hover:text-text", FOCUS_RING)}
          onClick={remove}
        >
          <Unlink {...ICON} />
        </Button>
      ) : null}
    </form>
  );
}

/** Adds https:// to bare domains; keeps mailto:, tel:, anchors and relative paths. */
function normalizeHref(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("/") || value.startsWith("#")) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  return `https://${value}`;
}
