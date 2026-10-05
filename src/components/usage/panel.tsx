import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// The Usage screens' building blocks: one card, its heading, the "i" dot and the trend pill.
// Server components all: the tooltips are the only client parts, and they come with `ui/tooltip`.

/** The one card: a shadcn Card in the house look (tinted fill, hairline, no ring, 24px padding). */
export function Panel({ children, className, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card
      {...props}
      className={cn("min-w-0 gap-0 rounded-xl border border-hairline bg-surface-tinted p-6 ring-0", className)}
    >
      {children}
    </Card>
  );
}

/** Title at left, tracked-caps aside at right ("Top templates … LAST 30 DAYS"). */
export function PanelHead({
  title,
  aside,
  size = "lg",
  className,
}: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  size?: "lg" | "md";
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-9 items-baseline justify-between gap-4", className)}>
      <h2
        className={cn(
          "m-0 font-normal tracking-tight text-text",
          size === "lg" ? "text-[28px] leading-9" : "text-[18px] leading-6",
        )}
      >
        {title}
      </h2>
      {aside ? <span className="caps-label shrink-0 text-right">{aside}</span> : null}
    </div>
  );
}

export function InfoDot({ tip }: { tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={tip}
            className="inline-grid size-4 cursor-default place-items-center rounded-full align-[-3px] text-text-subtle outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <Info aria-hidden strokeWidth={1.75} className="size-4" />
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

/** "+12.4%" against the 30 days before. Up is green, down is red; a flat 0 reads as up. */
export function TrendPill({ pct }: { pct: number }) {
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  const text = `${up ? "+" : "−"}${Math.abs(pct)}%`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`${text} compared with the 30 days before`}
            className={cn(
              "inline-flex h-6 shrink-0 cursor-default items-center gap-1 rounded-md px-2 text-[12px] font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // Ink on the soft green: the green text alone is 4.3:1; the arrow keeps the colour.
              up ? "bg-positive-soft text-text" : "bg-danger-soft text-danger-text",
            )}
          />
        }
      >
        <Icon aria-hidden strokeWidth={1.75} className={cn("size-3.5", up && "text-positive")} />
        {text}
      </TooltipTrigger>
      <TooltipContent>Compared with the 30 days before</TooltipContent>
    </Tooltip>
  );
}
