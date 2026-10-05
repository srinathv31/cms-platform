"use client";

import { useEffect, useState, useTransition } from "react";
import { unstable_rethrow, useSelectedLayoutSegment } from "next/navigation";
import { Eye, PanelRight, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { startDraft, submitDraft } from "@/server/actions/templates";
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
    <Button size="lg" className="px-4" onClick={edit} disabled={pending}>
      {pending ? <Spinner data-icon="inline-start" aria-label="Opening draft" /> : <Pencil data-icon="inline-start" strokeWidth={1.75} />}
      Edit
    </Button>
  );
}

/** Shown at the button when the draft's latest changes could not be saved, so submitting would freeze a stale copy. */
const NOT_SAVED = "Your latest changes aren't saved yet.";
const SUBMIT_FAILED = "Couldn't submit. Try again.";

/**
 * "Submit for review" on a draft the viewer can submit: the one black button. It sends the pending
 * autosave first (the version that gets frozen must be what is on screen), then submits. When the
 * draft can't be submitted, the reason shows in a small popover right under the button ("Define or
 * remove {{promo_code}} before submitting.") and the draft stays as it is. On success the action
 * refreshes the page in place: the header reads In review, the document turns read-only, and this
 * button goes away with the draft.
 */
export function SubmitButton({ templateId }: { templateId: string }) {
  const session = useWorkspaceSession();
  const [pending, startTransition] = useTransition();
  // The reason outlives its popover, so the text doesn't vanish while the popover fades out.
  const [reason, setReason] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function refuse(text: string) {
    setReason(text);
    setOpen(true);
  }

  function submit() {
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

        const result = await submitDraft({ templateId });
        if (!result.ok) refuse(result.reason);
      } catch (error) {
        unstable_rethrow(error);
        refuse(SUBMIT_FAILED);
      }
    });
  }

  return (
    <Popover
      open={open}
      // Only a dismissal (Esc, a click elsewhere) comes through here; a refusal opens it itself.
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <PopoverTrigger
        render={<Button size="lg" className="px-4" aria-label="Submit for review" onClick={submit} disabled={pending} />}
      >
        {pending ? <Spinner data-icon="inline-start" aria-label="Submitting" /> : null}
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
  );
}

/**
 * "Preview": an outline toggle left of the one black button, pressed while the preview is open. Only
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
  const { open } = usePreviewState();
  const onContent = segment === null;

  // Leaving the Content tab puts the preview away, so it isn't waiting open when the tab comes back.
  useEffect(() => {
    if (!onContent) session.closePreview();
  }, [onContent, session]);

  if (!onContent) return null;
  return (
    <Button
      variant="outline"
      size="lg"
      aria-label="Preview"
      aria-pressed={open}
      title="Preview"
      data-preview-toggle=""
      onClick={() => (open ? session.closePreview() : session.openPreview())}
      className={cn(
        "px-3.5 aria-pressed:bg-selected @max-[34rem]/bar:w-9 @max-[34rem]/bar:px-0 @max-[53rem]/ws:@max-[39rem]/bar:w-9 @max-[53rem]/ws:@max-[39rem]/bar:px-0",
        className,
      )}
    >
      <Eye data-icon="inline-start" strokeWidth={1.75} />
      <span className="@max-[34rem]/bar:sr-only @max-[53rem]/ws:@max-[39rem]/bar:sr-only">Preview</span>
    </Button>
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
    <Button
      variant="outline"
      size="icon-lg"
      aria-label="Channels and variables"
      aria-pressed={open}
      title="Channels and variables"
      onClick={() => session.setRailOpen(!open)}
      className={cn("@min-[53rem]/ws:hidden", open && "bg-selected", className)}
    >
      <PanelRight strokeWidth={1.75} />
    </Button>
  );
}
