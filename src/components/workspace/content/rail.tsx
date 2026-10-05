"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { m } from "motion/react";
import { Button } from "@/components/ui/button";
import { duration, ease } from "@/components/motion/presets";
import { closePreview } from "@/components/preview/close-preview";
import { usePreviewState, useRailOpen, useWorkspaceSession } from "../session/workspace-session";
import { WS } from "../workspace-grid";

/**
 * Something above the document that takes the first Escape: a menu, a popover or a dialog. Base UI's
 * popups and the sample-set editor are `menu`, `listbox` or `dialog` for as long as they are open.
 */
const OPEN_POPUP = '[role="menu"], [role="listbox"], [role="dialog"]';

/**
 * The template name in the header (name-field.tsx). Its own Escape puts the old name back and leaves
 * the field, so an Escape there is spoken for only while the name is mid-edit; with nothing to put
 * back it is just a way out of the field, and the preview closes.
 */
const NAME_FIELD = 'textarea[aria-label="Template name"]';

/**
 * Whether an Escape is already spoken for by something that is open when it is pressed: a menu or
 * popover, or the editor's `/` menu or `{{` picker (they point the editor at their list with
 * `aria-controls` while they are open). Asked in the capture phase, before they handle the key and
 * close, because the editor closes its menu inside its own handler and React has unmounted it by
 * the time a bubbling listener runs.
 */
function escapeIsSpokenFor(event: KeyboardEvent, nameAtFocus: string | null): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(".ProseMirror")?.hasAttribute("aria-controls")) return true;
  const name = target?.closest(NAME_FIELD);
  if (name instanceof HTMLTextAreaElement && name.value.trim() !== nameAtFocus) return true;
  return document.querySelector(OPEN_POPUP) !== null;
}

/**
 * The rail: Channels above Variables, a flush strip beside the header, tabs and document with its own
 * scroll. Wide canvas: always there. Narrow: closed until the tab bar's toggle opens it over the
 * right edge; Esc or the close button puts it away.
 *
 * The preview widens it (workspace-grid.ts has the geometry), and its 20px side padding matches the
 * normal rail's. While it is open `preview` draws the header row (Preview | Variables, the sample-set
 * switcher, and below the breakpoint a Close button) and, on the Preview view, the controls row and
 * the output, and the normal rail is hidden. On the Variables view the normal rail shows, left-aligned
 * to the header's edge at a comfortable width rather than stretched across the strip. Both stay
 * mounted and one is hidden, so the editor fields and the variables panel keep their state across the
 * switch. Below the breakpoint the same thing is an overlay over the whole canvas.
 *
 * Esc closes the preview (or the narrow overlay), unless a menu, a popover, the editor's own `/` menu
 * or `{{` picker, or a name that is mid-edit took it. The Template name field closes it too, when
 * it has nothing to put back. Focus goes back to the tab bar's Preview toggle when the Esc would
 * otherwise leave it lost (it was in the rail, or on nothing); an Esc in the document leaves the
 * caret where it is.
 *
 * `emailDetails` sits directly under Channels (it renders nothing while Email is off, and brings its
 * own top margin); `children` are the sections after it (Variables); `preview` is the preview's
 * surface, which draws the header row and the Preview view while the preview is open (it comes first
 * in the rail, ahead of the normal rail).
 */
export function Rail({
  channels,
  emailDetails,
  preview,
  children,
}: {
  channels: React.ReactNode;
  emailDetails?: React.ReactNode;
  preview?: React.ReactNode;
  children: React.ReactNode;
}) {
  const session = useWorkspaceSession();
  const railOpen = useRailOpen();
  const { open: previewOpen, view } = usePreviewState();
  const open = railOpen || previewOpen;
  // The normal rail (Channels, Email details, Variables) is what shows, unless the preview view is.
  const showRail = !(previewOpen && view === "preview");

  const aside = useRef<HTMLElement>(null);
  // What the name field said when it last got focus: an Esc there with the same text has no edit to put back.
  const nameAtFocus = useRef<string | null>(null);

  useEffect(() => {
    const note = (el: Element | null) => {
      if (el instanceof HTMLTextAreaElement && el.matches(NAME_FIELD)) nameAtFocus.current = el.value.trim();
    };
    note(document.activeElement);
    const onFocusIn = (event: FocusEvent) => note(event.target instanceof Element ? event.target : null);
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  useEffect(() => {
    if (!open) return;
    let spokenFor = false;
    const onCapture = (event: KeyboardEvent) => {
      if (event.key === "Escape") spokenFor = escapeIsSpokenFor(event, nameAtFocus.current);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || spokenFor) return;
      // Outside the document and the name field, a handler that used the key says so. (ProseMirror
      // swallows every Escape, so there `defaultPrevented` means nothing; the name field always
      // prevents it, to leave the field, which is why it was asked about in the capture phase.)
      const target = event.target instanceof Element ? event.target : null;
      const inDocument = target?.closest(".ProseMirror") != null;
      const inName = target?.closest(NAME_FIELD) != null;
      if (event.defaultPrevented && !inDocument && !inName) return;
      // Focus goes back to the Preview toggle unless it is somewhere the author is working (the document).
      const active = document.activeElement;
      const lost = active === null || active === document.body || (aside.current?.contains(active) ?? false);
      closePreview(session, { restoreFocus: previewOpen && lost });
    };
    document.addEventListener("keydown", onCapture, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onCapture, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, previewOpen, session]);

  const close = () => closePreview(session, { restoreFocus: false });

  return (
    <aside
      ref={aside}
      aria-label={previewOpen ? "Preview" : "Channels and variables"}
      data-slot="rail"
      data-open={open ? "" : undefined}
      data-preview={previewOpen ? "" : undefined}
      data-view={previewOpen ? view : undefined}
      className={WS.rail}
    >
      <div className={WS.railInner}>
        {preview}
        <m.div
          hidden={!showRail}
          // Switching to this view fades it in, as the Preview view does when it comes back. It
          // starts from where it is, so the first paint (and the closed rail) has no animation.
          initial={false}
          animate={{ opacity: showRail ? 1 : 0 }}
          transition={{ duration: duration.fast, ease: ease.outSoft }}
          // On the Variables view: left-aligned, 22rem of content. Its 8px inner padding (px-2 below)
          // is pulled out (-mx-2) so its text starts on the header row's edge.
          className="group-data-[preview]/rail:-mx-2 group-data-[preview]/rail:mt-6 group-data-[preview]/rail:max-w-92"
        >
          <div className="flex h-6 items-center justify-between px-2">
            <div className="caps-label">Channels</div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              className="-mr-1.5 @min-[53rem]/ws:hidden group-data-[preview]/rail:hidden"
              onClick={close}
            >
              <X strokeWidth={1.75} />
            </Button>
          </div>
          <div className="mt-3 px-2">{channels}</div>
          {emailDetails}
          <div className="mt-8">{children}</div>
        </m.div>
      </div>
    </aside>
  );
}
