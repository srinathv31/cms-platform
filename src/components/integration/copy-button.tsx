"use client";

import { Check, Copy } from "lucide-react";
import { useCopy } from "@/components/primitives/copy";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// One copy button for the whole integration panel. The confirmation is inline: the glyph crossfades to a
// check and the word to "Copied" inside a box that is as wide as the longer word, so nothing shifts and
// no toast appears. A polite status line carries the same confirmation for screen readers.

export function CopyButton({ label, text, className }: { label: string; text: string; className?: string }) {
  const { copied, copy } = useCopy();

  const fade = "col-start-1 row-start-1 transition-opacity duration-(--dur-base) ease-(--ease-out-soft)";
  return (
    <>
      <Button
        type="button"
        variant="outline"
        aria-label={`Copy ${label}`}
        onClick={() => void copy(text)}
        className={cn("h-8 shrink-0 gap-1.5 bg-surface px-3 text-[13px]", className)}
      >
        <span aria-hidden className="inline-grid size-3.5 place-items-center">
          <Copy strokeWidth={1.75} className={cn(fade, "size-3.5", copied ? "opacity-0" : "opacity-100")} />
          <Check strokeWidth={2} className={cn(fade, "size-3.5 text-positive", copied ? "opacity-100" : "opacity-0")} />
        </span>
        <span aria-hidden className="inline-grid">
          <span className={cn(fade, copied ? "opacity-0" : "opacity-100")}>Copy</span>
          <span className={cn(fade, copied ? "opacity-100" : "opacity-0")}>Copied</span>
        </span>
      </Button>
      <span role="status" className="sr-only">
        {copied ? `${label} copied` : ""}
      </span>
    </>
  );
}
