"use client";

import { useEffect, useTransition } from "react";
import { unstable_rethrow, useSelectedLayoutSegment } from "next/navigation";
import { PanelRight, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { startDraft } from "@/server/actions/templates";
import { useRailOpen, useWorkspaceSession } from "./session/workspace-session";

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
      className={cn("@min-[53rem]:hidden", open && "bg-selected", className)}
    >
      <PanelRight strokeWidth={1.75} />
    </Button>
  );
}
