"use client";

// A flagged run's popover (InlineVariableField's `flags`): the host's sentence, and its one-click fix
// when it has one ("Replace with '", or "Remove" for a character that is taken out). One per field,
// anchored to the open flag. It never takes focus on its own, so typing and the arrow keys stay in the
// field; Tab moves into it (extensions/text-flags.ts). There, Esc or Shift+Tab goes back to the field,
// and Tab closes it and goes on to the control after the field, so Tab never circles between the two.
// The fix is one editor transaction, so undo puts the text back.
//
// Built on Base UI's Popover parts, like the chip popover: the flag lives inside contenteditable, so
// it can't be a Popover.Trigger.

import { Popover } from "@base-ui/react/popover";
import type { Editor } from "@tiptap/react";
import { TriangleAlert } from "lucide-react";
import { useCallback, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { applyFlagFix, flagsOf } from "../extensions/text-flags";
import { nextTabbable } from "../lib/tab-order";
import type { FlagPopoverStore } from "../state/flag-popover";
import { FOCUS_RING } from "./classes";

const POPUP =
  "w-max max-w-72 origin-(--transform-origin) rounded-xl border border-hairline bg-surface p-3 text-sm text-text shadow-pop outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95";

export function FlagPopover({ editor, store }: { editor: Editor; store: FlagPopoverStore }) {
  const index = useStore(store, (s) => s.index);
  if (index === null || editor.isDestroyed) return null;
  return <FlagPopoverPanel key={index} editor={editor} store={store} index={index} />;
}

/** What the fix button says: "Replace with '", "Replace with a space", "Remove". */
export function fixLabel(replacement: string): string {
  if (replacement === "") return "Remove";
  return replacement === " " ? "Replace with a space" : `Replace with ${replacement}`;
}

/** The button's face: the replacement set in mono, so ' and ’ can be told apart at a glance. */
function FixFace({ replacement }: { replacement: string }) {
  if (replacement === "" || replacement === " ") return <>{fixLabel(replacement)}</>;
  return (
    <>
      Replace with
      <span className="rounded-sm bg-surface-sunken px-1 font-mono text-[12px] leading-4 text-text">{replacement}</span>
    </>
  );
}

function FlagPopoverPanel({ editor, store, index }: { editor: Editor; store: FlagPopoverStore; index: number }) {
  const flag = flagsOf(editor.state)[index];
  const anchor = editor.view.dom.querySelector<HTMLElement>(`[data-flag="${index}"]`);
  const setPopup = useCallback((element: HTMLElement | null) => store.getState().setElement(element), [store]);

  if (!flag || !anchor) return null;
  const fix = flag.replacement !== undefined && editor.isEditable ? flag.replacement : null;

  const backToField = () => editor.view.focus();

  const onOpenChange = (open: boolean, details: { reason?: string; event?: Event }) => {
    if (open) return;
    // A press on the flag itself opens it again at once; don't flicker.
    const target = details.event?.target;
    if (target instanceof Node && anchor.contains(target)) return;
    store.getState().close();
    if (details.reason === "escape-key") backToField();
  };

  // The popover stands in the field's place in the Tab order (it is portalled to the end of the page):
  // Shift+Tab goes back to the field, and Tab closes it and goes on to the control after the field.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    if (event.shiftKey) {
      backToField();
      return;
    }
    const next = nextTabbable(editor.view.dom, event.currentTarget);
    store.getState().close();
    if (next) next.focus();
    else backToField();
  };

  const apply = () => {
    store.getState().close();
    applyFlagFix(editor.view, index);
    backToField();
  };

  return (
    <Popover.Root open onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="isolate z-50"
        >
          <Popover.Popup ref={setPopup} initialFocus={false} finalFocus={false} className={POPUP} onKeyDown={onKeyDown}>
            <div className="flex items-start gap-2">
              <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-warning" />
              <Popover.Title className="m-0 text-[13px] leading-5 font-normal text-text">{flag.message}</Popover.Title>
            </div>
            {fix !== null ? (
              <Button
                variant="outline"
                size="sm"
                // A mousedown here mustn't take focus from the field first (the field would close the popover on blur).
                onMouseDown={(event) => event.preventDefault()}
                onClick={apply}
                aria-label={fixLabel(fix)}
                className={`mt-2.5 ml-6 h-7 gap-1.5 bg-surface px-2.5 text-[13px] ${FOCUS_RING}`}
              >
                <FixFace replacement={fix} />
              </Button>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
