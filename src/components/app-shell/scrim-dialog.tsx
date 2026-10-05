"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";

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
