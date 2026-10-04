"use client";

import { useState } from "react";
import { ShareRing } from "@/components/signature/share-ring";
import { TemplateId } from "@/components/primitives/template-id";
import { StatusBadge } from "@/components/primitives/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * The SHARE signature on an Active template. Opens the integration panel for consumer teams.
 * Phase 1: the panel frame. Phase 5 fills in the contract, JSON schema and sample request.
 */
export function WorkspaceShare({
  templateId,
  templateName,
  activeVersion,
}: {
  templateId: string;
  templateName: string;
  activeVersion: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ShareRing onClick={() => setOpen(true)} label={`Share ${templateName} — integration details`} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[30rem] gap-0 border-hairline bg-canvas p-0 sm:max-w-[30rem]">
          <SheetHeader className="gap-1.5 border-b border-hairline px-7 pt-7 pb-5">
            <div className="caps-label">Integration</div>
            <SheetTitle className="display-lg text-text">{templateName}</SheetTitle>
            <SheetDescription className="sr-only">
              Template ID, active version and the variable contract for consumer teams.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-7 px-7 py-6">
            <div className="flex items-start gap-12">
              <TemplateId id={templateId} />
              <div className="flex flex-col items-start gap-1">
                <span className="caps-label">Active version</span>
                <span className="flex h-6 items-center gap-2 text-[14px]">
                  <span className="font-medium text-text">v{activeVersion}</span>
                  <StatusBadge state="active" />
                </span>
              </div>
            </div>
            {/* Phase 5 fills these in. Dashed outlines so they never read as loading. */}
            {(["Variable contract", "Sample request", "Responses"] as const).map((section) => (
              <section key={section} className="flex flex-col gap-3">
                <div className="caps-label">{section}</div>
                <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-hairline-strong text-[13px] text-text-subtle">
                  Phase 5
                </div>
              </section>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
