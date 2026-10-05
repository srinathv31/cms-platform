"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { unstable_rethrow, useSelectedLayoutSegment } from "next/navigation";
import { Eye, PanelRight, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { startDraft } from "@/server/actions/templates";
import { submitVersion } from "@/server/actions/review";
import { SubmitDialog } from "@/components/submit/submit-dialog";
import { getSubmitSummary } from "@/server/queries/submit-summary";
import type { SubmitSummary } from "@/components/submit/types";
import { usePreviewState, useRailOpen, useWorkspaceSession } from "./session/workspace-session";

/**
 * "Edit" on an Active template: the one black button. It opens the template's draft (creating it
 * from the Active version if there isn't one), and the page then shows that draft, editable. The
 * action redirects, so the transition stays pending until the new page is up.
 */
export function EditButton({ templateId }: { templateId: string }) {
  const [pending, startTransition] = useTransition();

  function edit() {
    if (pending) return;
    startTransition(async () => {
      try {
        // On success the action redirects, which reaches here as an error Next handles itself.
        await startDraft({ templateId });
      } catch (error) {
        unstable_rethrow(error);
        toast.error("Couldn't open a draft. Try again.");
      }
    });
  }

  return (
    <Button size="lg" className="px-4 @max-[53rem]/ws:@max-[28rem]/bar:px-3" onClick={edit} disabled={pending}>
      {pending ? <Spinner data-icon="inline-start" aria-label="Opening draft" /> : <Pencil data-icon="inline-start" strokeWidth={1.75} />}
      Edit
    </Button>
  );
}

/** Shown at the button when the draft's latest changes could not be saved, so submitting would freeze a stale copy. */
const NOT_SAVED = "Your latest changes aren't saved yet.";
const SUBMIT_FAILED = "Couldn't open the submit dialog. Try again.";

/**
 * Puts focus on the header's status row once the page behind a submit has re-rendered as In review.
 * The Submit button unmounts with the draft, and focus would fall to the page; the row is where the
 * outcome is ("In review v2"), and its `tabIndex={-1}` lets a script land there without adding a Tab
 * stop. It waits a few frames for the new header, and does nothing if the person has already moved
 * focus somewhere else.
 */
function focusStatusRow() {
  const started = performance.now();
  const attempt = () => {
    const row = document.querySelector<HTMLElement>('[data-slot="status-row"]');
    const done = row?.querySelector('[data-status="in_review"]') != null;
    const active = document.activeElement;
    const free = active === null || active === document.body;
    if (!free) return;
    if (row && done) {
      row.focus({ preventScroll: true });
      return;
    }
    if (performance.now() - started < 3000) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

/**
 * "Submit for review" on a draft the viewer can submit: the one black button. It sends the pending
 * autosave first (the version that gets frozen must be what is on screen), then opens the submit
 * dialog (components/submit), which lists what is about to be frozen and asks for the optional note.
 * The dialog's own "Submit v{N}" does the submitting; a refusal ("Define or remove {{promo_code}}
 * before submitting.") shows inside the dialog, at that button, and the draft stays as it is. When
 * the save itself failed, there is nothing safe to show, so the reason appears in a small popover
 * right under this button instead. On success the dialog closes and the action refreshes the page in
 * place: the header reads In review, the document turns read-only, and this button goes away with
 * the draft; focus moves to the header's status row (`focusStatusRow`), so it doesn't fall to the page.
 */
export function SubmitButton({ templateId }: { templateId: string }) {
  const session = useWorkspaceSession();
  const [pending, startTransition] = useTransition();
  // The reason outlives its popover, so the text doesn't vanish while the popover fades out.
  const [reason, setReason] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<SubmitSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // When the submit went through (performance.now()). This button unmounts once the draft is In review.
  const submittedAt = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (submittedAt.current !== null && performance.now() - submittedAt.current < 10_000) focusStatusRow();
    },
    [],
  );

  function refuse(text: string) {
    setReason(text);
    setOpen(true);
  }

  function openDialog() {
    if (pending) return;
    setOpen(false);
    startTransition(async () => {
      try {
        await session.flush();
        // The host publishes the outcome of that flush on the next render: wait one task for it.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const saved = session.getStatus();
        if (saved.status === "error") {
          refuse(saved.error ?? NOT_SAVED);
          return;
        }

        // What the dialog lists is read from the saved draft, which is the live one now.
        const result = await getSubmitSummary({ templateId });
        if (!result.ok) {
          refuse(result.reason);
          return;
        }
        setSummary(result.summary);
        setDialogOpen(true);
      } catch (error) {
        unstable_rethrow(error);
        refuse(SUBMIT_FAILED);
      }
    });
  }

  return (
    <>
      <Popover
        open={open}
        // Only a dismissal (Esc, a click elsewhere) comes through here; a refusal opens it itself.
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              ref={trigger}
              size="lg"
              className="px-4 @max-[53rem]/ws:@max-[28rem]/bar:px-3"
              aria-label="Submit for review"
              onClick={openDialog}
              disabled={pending}
            />
          }
        >
          {pending ? <Spinner data-icon="inline-start" aria-label="Opening" /> : null}
          {/* In the tightest tab bar (preview open on a 1280px window) the label closes up to "Submit". The bar's steps are in workspace-grid.ts. */}
          <span>
            Submit<span className="@max-[28rem]/bar:hidden @max-[53rem]/ws:@max-[33rem]/bar:hidden"> for review</span>
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={8}
          initialFocus={false}
          className="w-auto max-w-72 rounded-xl border border-hairline bg-popover px-3 py-2.5 shadow-pop ring-0"
        >
          <p role="alert" className="text-[13px] leading-5 text-text">
            {reason}
          </p>
        </PopoverContent>
      </Popover>
      <SubmitDialog
        summary={summary}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        finalFocus={trigger}
        onSubmit={async (note) => {
          const result = await submitVersion({ templateId, note });
          if (result.ok) submittedAt.current = performance.now();
          return result;
        }}
      />
    </>
  );
}

/**
 * "Preview": an outline toggle left of the one black button, pressed while the Preview view is open (not the Original view). Only
 * on the Content tab, and for any version the viewer can see (Active and In review too). Opening it
 * widens the rail into the preview (see workspace-grid.ts); the preview sends the pending autosave
 * before its first render, so what it shows is what is saved. Esc closes it (the rail handles that),
 * and so does leaving the Content tab. However it closes, focus comes back here when it would
 * otherwise be lost (`closePreview` in preview/close-preview.ts).
 *
 * It is a `@container/bar` child: in the narrower column a preview leaves the tab bar (under about
 * 34rem, or 39rem while the rail toggle shows) the label gives way to the icon, and the button keeps
 * its name and pressed state.
 */
export function PreviewToggle({ className }: { className?: string }) {
  const segment = useSelectedLayoutSegment();
  const session = useWorkspaceSession();
  const { open: widened, view } = usePreviewState();
  // Pressed only while the Preview view itself is on screen: the widened rail on Original (or Comments) isn't "Preview".
  const open = widened && view === "preview";
  const onContent = segment === null;

  // Leaving the Content tab puts the preview away, so it isn't waiting open when the tab comes back.
  useEffect(() => {
    if (!onContent) session.closePreview();
  }, [onContent, session]);

  if (!onContent) return null;
  // Named by aria-label and, for the icon-only width, a tooltip (keyboard focus opens it too).
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="lg"
            aria-label="Preview"
            aria-pressed={open}
            data-preview-toggle=""
            onClick={() => (open ? session.closePreview() : session.openPreview())}
            className={cn(
              "px-3.5 aria-pressed:bg-selected @max-[34rem]/bar:w-9 @max-[34rem]/bar:px-0 @max-[53rem]/ws:@max-[39rem]/bar:w-9 @max-[53rem]/ws:@max-[39rem]/bar:px-0",
              className,
            )}
          />
        }
      >
        <Eye data-icon="inline-start" strokeWidth={1.75} />
        <span className="@max-[34rem]/bar:sr-only @max-[53rem]/ws:@max-[39rem]/bar:sr-only">Preview</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">Preview</TooltipContent>
    </Tooltip>
  );
}

/**
 * Opens the rail (Channels and Variables) when the canvas is too narrow to show it beside the
 * document. Only on the Content tab, and only below the rail's breakpoint.
 */
export function RailToggle({ className }: { className?: string }) {
  const segment = useSelectedLayoutSegment();
  const session = useWorkspaceSession();
  const open = useRailOpen();
  const onContent = segment === null;

  // Leaving the Content tab closes the overlay, so it isn't waiting open when the tab comes back.
  useEffect(() => {
    if (!onContent) session.setRailOpen(false);
  }, [onContent, session]);

  if (!onContent) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Channels and variables"
            aria-pressed={open}
            onClick={() => session.setRailOpen(!open)}
            className={cn("@min-[53rem]/ws:hidden", open && "bg-selected", className)}
          />
        }
      >
        <PanelRight strokeWidth={1.75} />
      </TooltipTrigger>
      <TooltipContent side="bottom">Channels and variables</TooltipContent>
    </Tooltip>
  );
}
