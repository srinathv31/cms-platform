"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";

/*
 * Reflow of a dialog with a title, a body and a footer of actions (decision 0045). In a window under 26rem wide
 * (about 416px: a 1280px laptop at 300% zoom and past) the dialog pads 1.25rem instead of 2rem and scrolls as a
 * whole, and its footer sticks to the bottom edge and wraps, so the actions stay in view and in reach at 320px wide
 * and 256px tall. Dialogs are portaled out of the canvas, so these key to the window (`max-[26rem]:`), not to the
 * canvas. From 26rem wide up they add nothing: the dialog is as it was.
 */
/** On the popup of a dialog whose body would scroll by itself: the popup scrolls instead, with the footer sticky. */
export const NARROW_SHELL = "max-[26rem]:overflow-y-auto max-[26rem]:overscroll-contain max-[26rem]:p-5 max-[26rem]:pb-0";
/** On the body: it grows with its content, and the popup scrolls. */
export const NARROW_BODY = "max-[26rem]:flex-none max-[26rem]:overflow-visible";
/** On the footer row: two lines when the buttons don't fit one, the refusal above them, stuck to the popup's bottom edge. */
export const NARROW_FOOTER =
  "max-[26rem]:sticky max-[26rem]:bottom-0 max-[26rem]:z-10 max-[26rem]:mt-3 max-[26rem]:flex-wrap max-[26rem]:gap-y-2 max-[26rem]:bg-surface max-[26rem]:pt-3 max-[26rem]:pb-5";
/** On the refusal in the footer: its own line, above the buttons, once it has text. */
export const NARROW_REFUSAL = "max-[26rem]:order-first max-[26rem]:basis-full max-[26rem]:not-empty:pb-1";
/** On each button of a footer that can wrap: as wide as its label, sharing the line or taking its own. */
export const NARROW_BUTTON = "max-[26rem]:flex-auto";

/**
 * A centered dialog on the flat scrim (no blur), as in the reference settings modal.
 * Compose it inside shadcn's <Dialog>; it provides the portal, the overlay and the popup.
 */
export function ScrimDialogContent({
  className,
  children,
  instant = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  /** Skip the enter animation (one dialog replacing another in place). */
  instant?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={cn("bg-scrim supports-backdrop-filter:backdrop-blur-none", instant && "data-open:animate-none!")} />
      <DialogPrimitive.Popup
        data-slot="scrim-dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-surface text-text shadow-modal outline-none",
          "duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-98 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-98",
          instant && "data-open:animate-none!",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}
