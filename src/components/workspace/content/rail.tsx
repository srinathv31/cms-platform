"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";
import { m } from "motion/react";
import { Button } from "@/components/ui/button";
import { duration, ease } from "@/components/motion/presets";
import { closePreview } from "@/components/preview/close-preview";
import { RailHeader, railHeaderViews } from "@/components/preview/rail-header";
import { cn } from "@/lib/utils";
import { useRailView } from "../session/rail-view";
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
/**
 * After the widened rail is put away from its Original view, focus goes back to the plain rail's
 * Original tab (what opened it) when that is on screen; below the breakpoint the rail goes away with
 * it and the Preview toggle, where `closePreview` put focus, keeps it.
 */
function focusOriginalTab(rail: HTMLElement | null) {
  const tab = [...(rail?.querySelectorAll<HTMLElement>('[data-slot="rail-header"] [role="tab"]') ?? [])].find(
    (el) => el.textContent?.trim().startsWith("Original") && el.getClientRects().length > 0,
  );
  tab?.focus({ preventScroll: true });
}

function escapeIsSpokenFor(event: KeyboardEvent, nameAtFocus: string | null): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(".ProseMirror")?.hasAttribute("aria-controls")) return true;
  const name = target?.closest(NAME_FIELD);
  if (name instanceof HTMLTextAreaElement && name.value.trim() !== nameAtFocus) return true;
  // Only one on screen: a route kept mounted but hidden (`<Activity>`) can still hold an open dialog, such as
  // the Library's New template, left open by the import or starter that navigated away from it.
  return [...document.querySelectorAll(OPEN_POPUP)].some((el) => el.getClientRects().length > 0);
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
 * A template with review comments gets a Comments view in the rail, beside Variables: the same header
 * row as the preview's (`RailHeader`: Comments | Variables, and Preview | Comments | Variables while
 * the preview is open), with the thread list under it. Without comments the rail is exactly what it
 * was. Like the normal rail, the thread list stays mounted while hidden, so a half-written reply
 * survives a trip to Variables. It opens on Comments while something is waiting there, until the
 * author picks a tab.
 *
 * A template that was imported gets the same header row with an Original tab (Original | Variables,
 * plus Comments when it has them). Picking Original widens the rail on the Original view, the file it
 * was imported from (Compare with original); Esc and the overlay's Close put it away, like Preview.
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
  comments,
  original = false,
  takeArrival,
  footer,
  children,
}: {
  channels: React.ReactNode;
  emailDetails?: React.ReactNode;
  preview?: React.ReactNode;
  /**
   * The template's review comments, when it has any (or a new comment is being written): `count` is
   * the number open, `preferred` says the rail should open on them, `panel` is the thread list.
   */
  comments?: { count: number; preferred: boolean; panel: React.ReactNode } | null;
  /** The template was imported: the header gets an Original tab (`preview` draws the view itself). */
  original?: boolean;
  /**
   * True once when the page is arriving from an import: the rail then starts widened on the Original
   * view, already at its width (no widening under the author).
   */
  takeArrival?: () => boolean;
  /** A quiet row at the end of the normal rail, after the sections (the Copilot prompt). */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const session = useWorkspaceSession();
  const railOpen = useRailOpen();
  const { open: previewOpen } = usePreviewState();
  const open = railOpen || previewOpen;
  // One of three views is on screen: the preview's output, the comments, or the normal rail (Channels, Email details, Variables).
  const hasComments = comments != null;
  const view = useRailView({ has: hasComments, preferred: comments?.preferred ?? false }, original);
  const showComments = view === "comments";
  const showRail = view === "variables";
  // With the preview closed, the comments and the original bring their own header row (the preview draws its own, with its tabs).
  const plainHeader = (hasComments || original) && !previewOpen;

  const aside = useRef<HTMLElement>(null);
  // What the name field said when it last got focus: an Esc there with the same text has no edit to put back.
  const nameAtFocus = useRef<string | null>(null);

  // Before the first paint: widened at once, without the width transition (nothing moves on arrival).
  useLayoutEffect(() => {
    const el = aside.current;
    // The flag is taken either way, so it doesn't wait around for a later visit.
    if (!el || !takeArrival?.()) return;
    // Below the breakpoint the rail is an overlay that is closed (display none): opening it would cover the name being
    // edited, so the author arrives at the document, with the Original tab one click away in the rail.
    if (getComputedStyle(el).display === "none") return;
    el.style.transition = "none";
    session.openOriginal();
    // Given back once the widened rail has painted. Not undone in a cleanup: a Strict Mode re-run
    // would put the transition back before the widened render had landed.
    requestAnimationFrame(() => requestAnimationFrame(() => el.style.removeProperty("transition")));
  }, [takeArrival, session]);

  // The control that had focus when the rail opened (the Preview toggle, the rail toggle): Esc gives focus back to it.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const active = document.activeElement;
      opener.current =
        active instanceof HTMLElement && active !== document.body && !aside.current?.contains(active) ? active : null;
    }
    wasOpen.current = open;
  }, [open]);

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
      // Back to what opened the rail when that is still on screen (below the breakpoint, the rail toggle
      // that opened the overlay the Original tab is in); otherwise to the Preview toggle, or to the plain
      // rail's Original tab when that is where the widened Original view came from.
      const from = opener.current;
      const backToOpener = lost && from !== null && from.isConnected && from.getClientRects().length > 0;
      if (backToOpener) from.focus({ preventScroll: true });
      closePreview(session, { restoreFocus: !backToOpener && previewOpen && lost });
      if (!backToOpener && previewOpen && lost && view === "original") {
        requestAnimationFrame(() => focusOriginalTab(aside.current));
      }
    };
    document.addEventListener("keydown", onCapture, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onCapture, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, previewOpen, session, view]);

  const close = () => closePreview(session, { restoreFocus: false });

  return (
    <aside
      ref={aside}
      aria-label={
        previewOpen
          ? view === "original"
            ? "Original"
            : "Preview"
          : hasComments
            ? "Comments and variables"
            : "Channels and variables"
      }
      data-slot="rail"
      data-open={open ? "" : undefined}
      data-preview={previewOpen ? "" : undefined}
      data-view={previewOpen ? view : undefined}
      className={WS.rail}
    >
      {/* The Original view, like the Preview view, is as tall as the rail's content area, so the file scrolls on its own. */}
      <div className={cn(WS.railInner, "group-data-[view=original]/rail:h-full")}>
        {preview}
        {plainHeader ? (
          // 8px in from the rail's 12px: the header's text starts on the same 20px edge as the rest of the rail's content.
          <div className="px-2">
            <RailHeader
              value={showComments ? "comments" : "variables"}
              views={railHeaderViews({ preview: false, comments: comments ? comments.count : null, original })}
              onChange={(next) => {
                if (next !== "original") return session.selectRailView(next);
                session.openOriginal();
                // This header goes away as the rail widens (the widened rail has its own): focus follows to its Original tab.
                requestAnimationFrame(() => requestAnimationFrame(() => focusOriginalTab(aside.current)));
              }}
              onClose={close}
            />
          </div>
        ) : null}
        {hasComments ? (
          <m.div
            hidden={!showComments}
            initial={false}
            animate={{ opacity: showComments ? 1 : 0 }}
            transition={{ duration: duration.fast, ease: ease.outSoft }}
            // The list sits on the rail's 20px content edge. Widened, it is left-aligned at a comfortable width, like the Variables view.
            className="mt-6 px-2 group-data-[preview]/rail:max-w-92 group-data-[preview]/rail:px-0"
          >
            {comments.panel}
          </m.div>
        ) : null}
        <m.div
          hidden={!showRail}
          // Switching to this view fades it in, as the Preview view does when it comes back. It
          // starts from where it is, so the first paint (and the closed rail) has no animation.
          initial={false}
          animate={{ opacity: showRail ? 1 : 0 }}
          transition={{ duration: duration.fast, ease: ease.outSoft }}
          // On the Variables view: left-aligned, 22rem of content. Its 8px inner padding (px-2 below)
          // is pulled out (-mx-2) so its text starts on the header row's edge.
          className={cn(
            "group-data-[preview]/rail:-mx-2 group-data-[preview]/rail:mt-6 group-data-[preview]/rail:max-w-92",
            plainHeader && "mt-6",
          )}
        >
          <div className="flex h-6 items-center justify-between px-2">
            <div className="caps-label">Channels</div>
            {plainHeader ? null : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                className="-mr-1.5 @min-[53rem]/ws:hidden group-data-[preview]/rail:hidden"
                onClick={close}
              >
                <X strokeWidth={1.75} />
              </Button>
            )}
          </div>
          <div className="mt-3 px-2">{channels}</div>
          {emailDetails}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-8">{footer}</div> : null}
        </m.div>
      </div>
    </aside>
  );
}
