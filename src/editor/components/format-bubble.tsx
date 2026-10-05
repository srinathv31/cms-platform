"use client";

// Floating format toolbar on the official BubbleMenu (@tiptap/react/menus):
// Bold, Italic, Underline and Link (Link swaps the bar for a small inline URL field; ⌘K opens it).
// With comments on (`comments`), selected text inside one top-level block also gets Comment (⌘⌥M), an
// icon with its label after a divider (the one button that says its name: it starts a conversation);
// read-only, or on a required heading (no formatting), the bar holds Comment alone.
// Toolbar state comes from useEditorState selectors, so typing never re-renders it.

import { Tooltip } from "@base-ui/react/tooltip";
import { isNodeRangeSelection } from "@tiptap/extension-node-range";
import { NodeSelection, PluginKey, type EditorState } from "@tiptap/pm/state";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Check, Italic, Link2, MessageSquarePlus, Underline, Unlink } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { headingsIn } from "../extensions/required-sections";
import { cx } from "../lib/cx";
import { useViewDom } from "../lib/editor-view";
import { isApple } from "../lib/platform";
import type { CommentRequest } from "../types";
import { FOCUS_RING } from "./classes";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Toggle } from "@/components/ui/toggle";

const MENU_OPTIONS = { placement: "top", offset: 8, flip: true, shift: { padding: 8 } } as const;

const bubbleKey = new PluginKey("formatBubble");

const TOGGLE = cx(
  "size-8 min-w-8 rounded-md px-0 text-label hover:bg-hover hover:text-text aria-pressed:bg-selected aria-pressed:text-text",
  FOCUS_RING,
);

/** Comment: the icon and its name. Text colour, not the formatting buttons' quieter label colour: it is the action the bar is there for. */
const COMMENT = cx("h-8 gap-1.5 rounded-md px-2 text-[13px] font-medium text-text hover:bg-hover", FOCUS_RING);

const ICON = { className: "size-4", strokeWidth: 1.75, "aria-hidden": true } as const;

/** shadcn's tooltip look (ui/tooltip), on Base UI's parts so it can render inside the editor. */
const TOOLTIP =
  "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

/** The Comment action: what the selection would anchor to, and the request. */
export interface CommentActions {
  target: (state: EditorState) => CommentRequest | null;
  request: (anchor: CommentRequest) => void;
}

/** Selected text that takes formatting (editable, not a chip or block, not a required heading). */
function canFormat(editor: Editor, state: EditorState): boolean {
  const { selection, doc } = state;
  if (!editor.isEditable || selection.empty) return false;
  // Text only: a selected chip or a dragged block range has nothing to format.
  if (selection instanceof NodeSelection || isNodeRangeSelection(selection)) return false;
  // Required section headings take no formatting.
  if (headingsIn(doc, selection.from, selection.to).length) return false;
  return doc.textBetween(selection.from, selection.to, " ", "").trim().length > 0;
}

/** Read-only documents can't take focus: the reader's selection is the page's, inside the document. */
function selectionInside(dom: HTMLElement): boolean {
  const selection = dom.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return false;
  return dom.contains(selection.anchorNode) && dom.contains(selection.focusNode);
}

/** Hides the toolbar now (after a comment request: the host's composer takes over). */
export function hideFormatBubble(editor: Editor) {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(bubbleKey, "hide"));
}

/** ⌘⌥M on Apple platforms, Ctrl+Alt+M elsewhere. */
export function commentShortcut(): { labels: string[]; aria: string } {
  return isApple() ? { labels: ["⌘", "⌥", "M"], aria: "Meta+Alt+M" } : { labels: ["Ctrl", "Alt", "M"], aria: "Control+Alt+M" };
}

export function FormatBubble({ editor, comments = null }: { editor: Editor; comments?: CommentActions | null }) {
  const [linkOpen, setLinkOpen] = useState(false);
  // Stable: BubbleMenu dispatches an options update whenever this object changes.
  const options = useMemo(() => ({ ...MENU_OPTIONS, onHide: () => setLinkOpen(false) }), []);
  const menuRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef(comments);
  useLayoutEffect(() => {
    commentsRef.current = comments;
  });

  // Stable for the same reason as `options`; reads the latest comment actions from the ref.
  const shouldShow = useMemo(() => {
    const visible = ({ editor: e, state, element }: { editor: Editor; state: EditorState; element: HTMLElement }) => {
      if (e.isDestroyed || state.selection.empty) return false;
      const comment = !!commentsRef.current?.target(state);
      if (!e.isEditable) return comment && selectionInside(e.view.dom);
      if (!(e.view.hasFocus() || element.contains(document.activeElement))) return false;
      return comment || canFormat(e, state);
    };
    return visible;
  }, []);

  const hide = useMemo(() => () => hideFormatBubble(editor), [editor]);
  const commentsOn = !!comments;

  // BubbleMenu debounces its updates (so it doesn't chase a drag-selection). When the selection
  // turns into something the bar can't act on (a chip, a block), hide at once instead of letting
  // the bar hover over the chip for the debounce window.
  useEffect(() => {
    const onSelection = () => {
      if (editor.isDestroyed) return;
      const element = menuRef.current;
      if (!element?.isConnected || shouldShow({ editor, state: editor.state, element })) return;
      hide();
    };
    editor.on("selectionUpdate", onSelection);
    return () => {
      editor.off("selectionUpdate", onSelection);
    };
  }, [editor, shouldShow, hide]);

  // Read-only: the document never has focus, and ProseMirror stops following a selection that
  // leaves it, so watch the page's selection to hide the bar when it goes.
  useEffect(() => {
    if (!commentsOn) return;
    const onSelectionChange = () => {
      const element = menuRef.current;
      if (editor.isDestroyed || editor.isEditable || !element?.isConnected) return;
      if (!shouldShow({ editor, state: editor.state, element })) hide();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [editor, shouldShow, hide, commentsOn]);

  // ⌘K / Ctrl+K on selected text opens the link field.
  useViewDom(editor, (dom) => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const element = menuRef.current;
      if (!element || !canFormat(editor, editor.state) || !shouldShow({ editor, state: editor.state, element })) return;
      event.preventDefault();
      setLinkOpen(true);
    };
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  });

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      format: !e.isDestroyed && canFormat(e, e.state),
      comment: !e.isDestroyed && !!commentsRef.current?.target(e.state),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });
  const showComment = commentsOn && active.comment;

  const comment = () => {
    const actions = commentsRef.current;
    const target = editor.isDestroyed ? null : actions?.target(editor.state);
    if (!actions || !target) return;
    hide();
    actions.request(target);
  };

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
        aria-label={active.format ? "Format text" : "Comment on text"}
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
            {active.format ? (
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
            ) : null}
            {showComment ? (
              <>
                {active.format ? <span aria-hidden className="mx-1 h-5 w-px bg-hairline" /> : null}
                <CommentButton onClick={comment} />
              </>
            ) : null}
          </>
        )}
      </div>
    </BubbleMenu>
  );
}

/** Comment (icon and label), with its tooltip ("Comment ⌘⌥M") rendered inside the editor's wrapper, in the page's landmarks. */
function CommentButton({ onClick }: { onClick: () => void }) {
  const [shortcut] = useState(commentShortcut);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const frame = useRef<HTMLElement | null>(null);
  return (
    <Tooltip.Root
      onOpenChange={(open) => {
        // The toolbar is attached to the page only while it shows, so find the wrapper on open.
        if (open) frame.current = trigger.current?.closest<HTMLElement>(".ucomp-editor") ?? null;
      }}
    >
      <Tooltip.Trigger
        ref={trigger}
        render={
          <Button
            type="button"
            variant="ghost"
            aria-keyshortcuts={shortcut.aria}
            className={COMMENT}
            onClick={onClick}
          />
        }
      >
        <MessageSquarePlus {...ICON} />
        Comment
      </Tooltip.Trigger>
      <Tooltip.Portal container={frame}>
        <Tooltip.Positioner side="top" sideOffset={6} className="isolate z-50">
          <Tooltip.Popup data-slot="tooltip-content" className={TOOLTIP}>
            Comment
            <KbdGroup className="gap-0.5">
              {shortcut.labels.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
            <Tooltip.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=top]:-bottom-2.5" />
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
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
