"use client";

import { useRef, type MouseEvent } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestAuditExport, saveAuditFile } from "./export-audit";

/**
 * The Export link: a download anchor that follows the filters (`href`). A plain click fetches the
 * file itself and saves it, so a refusal (the viewer lost access, the team is gone) is read as the
 * refusal it is and shown in a toast, rather than saved as a file or lost in a failed download. One
 * export at a time. A modified click (a new tab, the context menu) and a page without its script
 * fall back to the anchor, which downloads the file as before.
 */
export function ExportLink({ href, label, className }: { href: string; label: string; className?: string }) {
  const sending = useRef(false);

  async function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    try {
      const file = await requestAuditExport(href);
      if (file.ok) saveAuditFile(file.blob, file.filename);
      else toast.error(file.reason);
    } finally {
      sending.current = false;
    }
  }

  return (
    <Button variant="outline" render={<a href={href} download onClick={onClick} />} nativeButton={false} className={className}>
      <Download aria-hidden strokeWidth={1.75} data-icon="inline-start" />
      {label}
    </Button>
  );
}
