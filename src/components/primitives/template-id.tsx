"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * A template ID (`UC-4F7K2Q`): tracked-caps "TEMPLATE ID" over the mono value, with a copy button
 * that confirms with a check mark. (Style C, chosen by Sri on Oct 4.)
 */

const CONFIRM_MS = 1600;

function useCopy(value: string, withToast: boolean) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard can be unavailable (insecure context, permissions). Fall back to a hidden textarea.
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    if (withToast) toast.success("Template ID copied");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
  }, [value, withToast]);

  return { copied, copy };
}

/** Copy glyph that crossfades into a check. Fixed size so nothing shifts. */
function CopyGlyph({ copied, className }: { copied: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-grid size-3.5 shrink-0 place-items-center", className)}>
      <Copy
        strokeWidth={1.75}
        className={cn(
          "col-start-1 row-start-1 size-3.5 transition-[opacity,transform] duration-(--dur-base) ease-(--ease-out-soft)",
          copied ? "scale-75 opacity-0" : "scale-100 opacity-100",
        )}
      />
      <Check
        strokeWidth={2}
        className={cn(
          "col-start-1 row-start-1 size-3.5 text-positive transition-[opacity,transform] duration-(--dur-base) ease-(--ease-out-soft)",
          copied ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      />
    </span>
  );
}

export function TemplateId({
  id,
  label = "Template ID",
  toast: withToast = false,
  className,
}: {
  id: string;
  label?: string;
  /** Also show a toast on copy. Off by default; the check mark is the confirmation. */
  toast?: boolean;
  className?: string;
}) {
  const { copied, copy } = useCopy(id, withToast);
  return (
    <div className={cn("inline-flex flex-col items-start gap-1", className)}>
      <span className="caps-label">{label}</span>
      <span className="inline-flex items-center gap-1">
        <span className="font-mono text-[14px] leading-6 text-text">{id}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy template ID ${id}`}
          title="Copy template ID"
          className="-my-1 inline-grid size-6 place-items-center rounded-md text-text-muted transition-colors duration-(--dur-fast) hover:bg-hover hover:text-text"
        >
          <CopyGlyph copied={copied} />
        </button>
      </span>
      <span role="status" className="sr-only">
        {copied ? "Template ID copied" : ""}
      </span>
    </div>
  );
}
