"use client";

// The block menu: a click on a block's ⋮⋮ grip (components/block-handle.tsx) opens it for that block
// and a second click closes it; Alt+F10 from the caret opens it too. It holds the block's
// numbering, like Word's: for the numbered list the block is (or holds, or the caret is in:
// lib/list-numbering.ts), "Numbering" lists the ten styles with a preview of each and the list's own
// checked, plus "Default" (the style by depth), and "Start at…" swaps its row for a small number
// field (0 to 9999). On any other block both are shown disabled, with the reason.
// The menu is named "Block options" whichever way it opened (Base UI would name it after its
// trigger, and the grip's label is about dragging).
// Every choice is one undo step and an ordinary edit (the host autosaves it). Nothing here scrolls
// the page: edits are dispatched without scrolling into view, and focus goes back to the document
// through ProseMirror (lib/editor-view.ts `refocusText`), so the caret isn't reset and scrolled to.

import { Menu } from "@base-ui/react/menu";
import type { Editor } from "@tiptap/react";
import { Check, GripVertical, ListOrdered, ListStart } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cx } from "../lib/cx";
import { refocusText, viewDom } from "../lib/editor-view";
import {
  currentNumberingValue,
  defaultNumbering,
  listStart,
  numberingPreview,
  numberingTarget,
  numberingValue,
  parseListStart,
  setListNumbering,
  setListStart,
  styleFromValue,
  type NumberingTarget,
} from "../lib/list-numbering";
import { DOCUMENT_MESSAGES } from "../model/document-check";
import { NUMBERING_STYLES } from "../model/list-markers";
import { FOCUS_RING, MENU_ICON, MENU_ITEM, MENU_POPUP, MENU_REASON, MENU_SEPARATOR } from "./classes";

/** The menu's name, however it was opened. */
export const BLOCK_MENU_LABEL = "Block options";
/** Why the numbering items are disabled on a block without a numbered list. */
export const NO_NUMBERING_REASON = "Only numbered lists have numbering.";
/** Why a "Start at" entry can't be applied: the document check's own sentence (0 to 9999). */
export const START_RANGE_MESSAGE = DOCUMENT_MESSAGES.listStart;

const SUB_TRIGGER = cx(
  MENU_ITEM,
  "focus:text-text data-popup-open:bg-hover data-popup-open:text-text data-open:bg-hover data-open:text-text data-disabled:pointer-events-none data-disabled:opacity-50 [&>svg:last-child]:text-text-muted",
);
const RADIO = "gap-3 rounded-lg py-1.5 pr-8 pl-2 text-text focus:bg-hover focus:text-text";

function frameOf(editor: Editor): HTMLElement | null {
  return viewDom(editor)?.closest<HTMLElement>(".ucomp-editor") ?? null;
}

// ── The menu ─────────────────────────────────────────────────────

/**
 * The menu's portal, positioner and popup: inside the editor's wrapper, like the table menu. Named
 * by a hidden label of its own: Base UI points `aria-labelledby` at the trigger, which would read
 * the grip's "Drag to move block, or click for options".
 */
function BlockMenuPopup({ editor, blockPos, close, anchor }: { editor: Editor; blockPos: number; close: () => void; anchor?: Element | null }) {
  const frame = frameOf(editor);
  const labelId = useId();
  if (!frame) return null;
  return (
    <DropdownMenuPortal container={frame}>
      <Menu.Positioner
        anchor={anchor ?? undefined}
        side="bottom"
        align="start"
        sideOffset={6}
        collisionBoundary={frame}
        collisionPadding={8}
        className="isolate z-50 outline-none"
      >
        <Menu.Popup
          aria-labelledby={labelId}
          data-block-menu=""
          finalFocus={() => refocusText(editor)}
          className={cx(MENU_POPUP, "w-56")}
        >
          <span id={labelId} hidden>
            {BLOCK_MENU_LABEL}
          </span>
          <BlockMenuItems editor={editor} blockPos={blockPos} frame={frame} close={close} />
        </Menu.Popup>
      </Menu.Positioner>
    </DropdownMenuPortal>
  );
}

/** The items. Mounted each time the menu opens, so the list it acts on is read then (an edit closes the menu). */
function BlockMenuItems({ editor, blockPos, frame, close }: { editor: Editor; blockPos: number; frame: HTMLElement; close: () => void }) {
  const [target] = useState<NumberingTarget | null>(() => (editor.isDestroyed ? null : numberingTarget(editor.state, blockPos)));
  const reasonId = useId();
  const title = target ? (target.orderedDepth > 0 ? `Numbered list · level ${target.orderedDepth + 1}` : "Numbered list") : null;
  return (
    <>
      <Menu.Group>
        {title ? (
          <DropdownMenuLabel className="px-2 pt-1.5 pb-1">
            <span className="caps-label">{title}</span>
          </DropdownMenuLabel>
        ) : null}
        <NumberingSubmenu editor={editor} target={target} frame={frame} reasonId={reasonId} />
        <StartAt editor={editor} target={target} reasonId={reasonId} close={close} />
      </Menu.Group>
      {target ? null : (
        <p id={reasonId} className={cx(MENU_REASON, "pb-1.5")}>
          {NO_NUMBERING_REASON}
        </p>
      )}
    </>
  );
}

function NumberingSubmenu({
  editor,
  target,
  frame,
  reasonId,
}: {
  editor: Editor;
  target: NumberingTarget | null;
  frame: HTMLElement;
  reasonId: string;
}) {
  const value = target ? currentNumberingValue(target.node) : null;
  const choose = (next: unknown) => {
    if (!target || editor.isDestroyed || typeof next !== "string") return;
    setListNumbering(editor.view, target.pos, next === "default" ? null : styleFromValue(next));
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={!target} aria-describedby={target ? undefined : reasonId} className={SUB_TRIGGER}>
        <ListOrdered {...MENU_ICON} />
        Numbering
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal container={frame}>
        {/* Fits what the reader can see (the viewport and any scrolling ancestor), not the editor's
            wrapper: near the end of a long document the wrapper's top is far above the screen, and
            shifting the submenu inside it pushed the top rows out of view. */}
        <Menu.Positioner
          side="right"
          align="start"
          sideOffset={4}
          alignOffset={-5}
          collisionBoundary="clipping-ancestors"
          collisionPadding={8}
          className="isolate z-50 outline-none"
        >
          <Menu.Popup aria-label="Numbering" data-block-menu="" className={cx(MENU_POPUP, "w-48")}>
            {target ? (
              <DropdownMenuRadioGroup value={value} onValueChange={choose}>
                <DropdownMenuRadioItem value="default" closeOnClick className={RADIO}>
                  Default
                  <span className="text-text-muted tabular-nums">{numberingPreview(defaultNumbering(target.orderedDepth))}</span>
                </DropdownMenuRadioItem>
                <DropdownMenuSeparator className={MENU_SEPARATOR} />
                {NUMBERING_STYLES.map((style) => (
                  <DropdownMenuRadioItem key={numberingValue(style)} value={numberingValue(style)} closeOnClick className={cx(RADIO, "tabular-nums")}>
                    {numberingPreview(style)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

/**
 * "Start at…": the list's first number. Choosing it swaps the row for a number field, which is not
 * a menu item (Base UI moves focus off an item the pointer leaves, which would take it out of the
 * field). Esc in the field comes back to the item; focus going anywhere else cancels it.
 */
function StartAt({
  editor,
  target,
  reasonId,
  close,
}: {
  editor: Editor;
  target: NumberingTarget | null;
  reasonId: string;
  close: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const item = useRef<HTMLDivElement>(null);
  const backToItem = useRef(false);
  // Back from the field with Esc: the item again, focused (so highlighted: the arrow keys go on from it).
  useLayoutEffect(() => {
    if (editing || !backToItem.current) return;
    backToItem.current = false;
    item.current?.focus({ preventScroll: true });
  }, [editing]);

  if (editing && target) {
    return (
      <StartAtField
        editor={editor}
        target={target}
        onCancel={(refocus) => {
          backToItem.current = refocus;
          setEditing(false);
        }}
        onDone={close}
      />
    );
  }

  const start = target ? listStart(target.node) : null;
  return (
    <DropdownMenuItem
      ref={item}
      disabled={!target}
      closeOnClick={false}
      aria-describedby={target ? undefined : reasonId}
      onClick={() => {
        if (target) setEditing(true);
      }}
      className={MENU_ITEM}
    >
      <ListStart {...MENU_ICON} />
      Start at…
      {start === null ? null : <span className="ml-auto text-text-muted tabular-nums">{start}</span>}
    </DropdownMenuItem>
  );
}

function StartAtField({
  editor,
  target,
  onCancel,
  onDone,
}: {
  editor: Editor;
  target: NumberingTarget;
  /** `refocus`: go back to the "Start at…" item (Esc), rather than leave focus where it went. */
  onCancel: (refocus: boolean) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(String(listStart(target.node)));
  const [tried, setTried] = useState(false);
  const id = useId();
  const start = parseListStart(draft);
  const reason = start === null && (tried || draft.trim() !== "") ? START_RANGE_MESSAGE : null;

  const apply = () => {
    if (start === null) {
      setTried(true);
      return;
    }
    if (!editor.isDestroyed) setListStart(editor.view, target.pos, start);
    onDone();
  };

  // The field's keys are its own: the menu's arrow keys, typeahead, Enter and Esc don't reach the
  // menu. Enter applies, or says why it can't (handled here: a form's implicit submit would click the
  // disabled ✓, and Base UI cancels that click). Esc goes back to the "Start at…" item, the menu
  // still open (the field is the topmost thing).
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") return;
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel(true);
    }
  };

  // Focus leaving the field and its ✓ (to a row the pointer moved onto, or out of the menu) cancels
  // it. A window losing focus doesn't: the field is still there when the author comes back.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const to = event.relatedTarget;
    if (to instanceof Node && event.currentTarget.contains(to)) return;
    if (!event.currentTarget.ownerDocument.hasFocus()) return;
    onCancel(false);
  };

  return (
    <div role="group" aria-labelledby={`${id}-label`} onBlur={onBlur} className="flex gap-2.5 rounded-lg px-2 py-0.5 text-text">
      <ListStart {...MENU_ICON} className={cx(MENU_ICON.className, "mt-1.5 shrink-0")} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <label id={`${id}-label`} htmlFor={`${id}-field`} className="shrink-0">
            Start at
          </label>
          <Input
            id={`${id}-field`}
            autoFocus
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={reason ? true : undefined}
            aria-describedby={reason ? `${id}-reason` : undefined}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-7 w-full min-w-0 rounded-md border-transparent bg-surface-sunken px-2 text-sm tabular-nums shadow-none focus-visible:border-transparent focus-visible:ring-0"
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Set start number"
            aria-describedby={reason ? `${id}-reason` : undefined}
            disabled={start === null}
            // Disabled, not hidden, and still focusable (marked `data-disabled`), so it is announced
            // with the reason; Base UI cancels its click while disabled.
            focusableWhenDisabled
            onClick={apply}
            onKeyDown={onKeyDown}
            className={cx(
              "size-7 shrink-0 text-label hover:bg-hover hover:text-text data-disabled:cursor-default data-disabled:text-text-subtle data-disabled:opacity-50 data-disabled:hover:bg-transparent",
              FOCUS_RING,
            )}
          >
            <Check className="size-4" strokeWidth={1.75} aria-hidden />
          </Button>
        </div>
        {reason ? (
          <p id={`${id}-reason`} className="pb-1 text-xs text-danger-text">
            {reason}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Openers ──────────────────────────────────────────────────────

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
      {blockPos === null ? null : <BlockMenuPopup editor={editor} blockPos={blockPos} anchor={anchor} close={() => onOpenChange(false)} />}
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
  const frame = frameOf(editor);

  // Beside the block's first line, in the gutter (as the grip would be); follows the page as it reflows.
  useLayoutEffect(() => {
    if (!frame || editor.isDestroyed) return;
    const block = editor.view.nodeDOM(blockPos);
    if (!(block instanceof HTMLElement)) return;
    const place = () => {
      const line = block.matches("p, h1, h2, h3") ? block : block.querySelector<HTMLElement>("p, h1, h2, h3");
      const lineBox = (line ?? block).getBoundingClientRect();
      const lineHeight = line ? Number.parseFloat(getComputedStyle(line).lineHeight) || lineBox.height : lineBox.height;
      const f = frame.getBoundingClientRect();
      setStyle({ top: lineBox.top - f.top + Math.min(lineHeight, lineBox.height) / 2, left: block.getBoundingClientRect().left - f.left - 6 });
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
    <div className="absolute z-10 -translate-x-full -translate-y-1/2" style={style}>
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
            if (open || (to instanceof Element && to.closest("[data-block-menu]"))) return;
            onClose();
          }}
          className={cx(
            "flex size-6 items-center justify-center rounded-md border border-hairline bg-surface text-text-muted outline-none hover:bg-hover hover:text-text data-popup-open:bg-hover data-popup-open:text-text",
            FOCUS_RING,
          )}
        >
          <GripVertical className="size-4" strokeWidth={1.75} aria-hidden />
        </DropdownMenuTrigger>
        <BlockMenuPopup editor={editor} blockPos={blockPos} close={() => setOpen(false)} />
      </DropdownMenu>
    </div>
  );
}
