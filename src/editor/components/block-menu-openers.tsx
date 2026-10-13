"use client";

// The two ways into the block menu (components/block-menu.tsx holds the menu itself): a click on the
// block handle's ⋮⋮ grip, and Alt+F10 from the caret. Each wraps the same popup in the Base UI
// `DropdownMenu` root that decides when it is open: `GripBlockMenu` and `GripTrigger` for the grip
// (components/block-handle.tsx places them), `KeyboardBlockMenu` for the keyboard.

import { Menu } from "@base-ui/react/menu";
import type { Editor } from "@tiptap/react";
import { GripVertical } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cx } from "../lib/cx";
import { editorFrame, refocusText } from "../lib/editor-view";
import { BLOCK_MENU_LABEL, BlockMenuPopup } from "./block-menu";
import { FOCUS_RING } from "./classes";

/**
 * The menu a click on the grip opens, under the grip. Wraps the handle (`children`), whose grip is a
 * `GripTrigger`: Base UI links a menu's submenus through its trigger.
 */
export function GripBlockMenu({
  editor,
  blockPos,
  open,
  onOpenChange,
  onClosed,
  anchor,
  children,
}: {
  editor: Editor;
  /** The block the menu is for; null while it's closed. */
  blockPos: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After it has closed (its exit animation done). */
  onClosed: () => void;
  anchor: Element | null;
  children: ReactNode;
}) {
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed();
      }}
    >
      {children}
      {blockPos === null ? null : (
        <BlockMenuPopup
          editor={editor}
          blockPos={blockPos}
          anchor={anchor}
          close={() => onOpenChange(false)}
        />
      )}
    </DropdownMenu>
  );
}

/**
 * The grip as the block menu's trigger. Not a <button> (Firefox won't start a drag from one), and
 * Base UI's open-on-press is off: pressing starts a drag; only a click (no drag) opens the menu, and
 * a click while it is open closes it.
 */
export function GripTrigger({
  ref,
  open,
  onOpenChange,
  className,
  children,
}: {
  ref?: (element: HTMLElement | null) => void;
  /** Whether the menu is open (not while it is closing). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Menu.Trigger
      ref={ref}
      data-slot="dropdown-menu-trigger"
      render={<div />}
      nativeButton={false}
      tabIndex={-1}
      aria-label="Drag to move block, or click for options"
      onMouseDown={(event) => event.preventBaseUIHandler()}
      onPointerDown={(event) => event.preventBaseUIHandler()}
      onClick={(event) => {
        event.preventBaseUIHandler();
        onOpenChange(!open);
      }}
      className={className}
    >
      {children}
    </Menu.Trigger>
  );
}

/**
 * The keyboard's way in (Alt+F10 from the caret): a button in the block's gutter, where the grip
 * would be, focused at once; Enter or ↓ opens the menu, Esc goes back to the text. It goes away as
 * soon as focus leaves it and its menu.
 */
export function KeyboardBlockMenu({
  editor,
  blockPos,
  onClose,
}: {
  editor: Editor;
  blockPos: number;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const frame = editorFrame(editor);

  // Beside the block's first line, in the gutter (as the grip would be); follows the page as it reflows.
  useLayoutEffect(() => {
    if (!frame || editor.isDestroyed) return;
    const block = editor.view.nodeDOM(blockPos);
    if (!(block instanceof HTMLElement)) return;
    const place = () => {
      const line = block.matches("p, h1, h2, h3")
        ? block
        : block.querySelector<HTMLElement>("p, h1, h2, h3");
      const lineBox = (line ?? block).getBoundingClientRect();
      const lineHeight = line
        ? Number.parseFloat(getComputedStyle(line).lineHeight) || lineBox.height
        : lineBox.height;
      const f = frame.getBoundingClientRect();
      setStyle({
        top: lineBox.top - f.top + Math.min(lineHeight, lineBox.height) / 2,
        left: block.getBoundingClientRect().left - f.left - 6,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [editor, blockPos, frame]);

  // Focused once, when it first appears (not again as it follows a reflow).
  const focused = useRef(false);
  useEffect(() => {
    if (!style || focused.current) return;
    focused.current = true;
    button.current?.focus({ preventScroll: true });
  }, [style]);

  if (!frame || !style) return null;

  return (
    <div
      className="absolute z-10 -translate-x-full -translate-y-1/2"
      style={style}
    >
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(next) => {
          // Closed (focus went back to the text): the button's job is done.
          if (!next) onClose();
        }}
      >
        <DropdownMenuTrigger
          ref={button}
          aria-label={BLOCK_MENU_LABEL}
          aria-keyshortcuts="Alt+F10"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || open) return;
            event.preventDefault();
            refocusText(editor);
          }}
          onBlur={(event) => {
            // Into the menu (or back from it): stay. Anywhere else: go.
            const to = event.relatedTarget;
            if (
              open ||
              (to instanceof Element && to.closest("[data-block-menu]"))
            )
              return;
            onClose();
          }}
          className={cx(
            "flex size-6 items-center justify-center rounded-md border border-hairline bg-surface text-text-muted outline-none hover:bg-hover hover:text-text data-popup-open:bg-hover data-popup-open:text-text",
            FOCUS_RING,
          )}
        >
          <GripVertical className="size-4" strokeWidth={1.75} aria-hidden />
        </DropdownMenuTrigger>
        <BlockMenuPopup
          editor={editor}
          blockPos={blockPos}
          close={() => setOpen(false)}
        />
      </DropdownMenu>
    </div>
  );
}
