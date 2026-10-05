import { cn } from "@/lib/utils";

/**
 * Preformatted text in Geist Mono on the sunken surface. Long lines scroll inside the block, never the
 * panel. `minLines` reserves the height of the longest of several alternatives (curl / fetch, per
 * channel), so switching between them doesn't move what's below.
 */
const LINE_REM = 1.25;
const PAD_REM = 1.5;

export function CodeBlock({
  label,
  children,
  minLines,
  maxHeightClass,
  className,
}: {
  /** Accessible name of the scrollable region. */
  label: string;
  children: string;
  minLines?: number;
  maxHeightClass?: string;
  className?: string;
}) {
  return (
    <pre
      tabIndex={0}
      role="region"
      aria-label={label}
      style={minLines ? { minHeight: `${minLines * LINE_REM + PAD_REM}rem` } : undefined}
      className={cn(
        "overflow-auto overscroll-contain rounded-lg border border-hairline bg-surface-sunken px-4 py-3 font-mono text-[12.5px] leading-5 text-text",
        maxHeightClass,
        className,
      )}
    >
      <code>{children}</code>
    </pre>
  );
}

export const lineCount = (text: string) => text.split("\n").length;
