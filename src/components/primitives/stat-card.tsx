import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// A stat card: a big regular-weight numeral and its tracked-caps label on the tinted card, with what
// explains the number under a hairline. The parts compose, so a screen sets their order and spacing:
//
//   <StatCard>
//     <StatValue value="6,089" trend={<StatTrend pct={7.2} />} />
//     <StatLabel tip="Live renders only. Previews aren't counted." className="mt-3">Renders · 30 days</StatLabel>
//     <StatLines rows={[["Consumers", "1"]]} />
//   </StatCard>
//
// Values come formatted: the caller owns the number's wording. Server-safe: the tooltips are the only
// client parts, and they come with `ui/tooltip`.

/** The card: tinted fill, hairline border, 14px corners, 24px padding; no ring, no shadow. The Usage screens' `Panel` is this card. */
export function StatCard({ className, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card
      {...props}
      className={cn("min-w-0 gap-0 rounded-xl border border-hairline bg-surface-tinted p-6 ring-0", className)}
    />
  );
}

/** The numeral, with a trend (`StatTrend`) at the right of its row. */
export function StatValue({ value, trend, className }: { value: string; trend?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="numeral text-text">{value}</div>
      {trend}
    </div>
  );
}

/** The tracked-caps label. A `tip` adds an "i" whose tooltip says how the number is counted. */
export function StatLabel({ children, tip, className }: { children: React.ReactNode; tip?: string; className?: string }) {
  return (
    <div className={cn("caps-label", className)}>
      {children} {tip ? <InfoDot tip={tip} /> : null}
    </div>
  );
}

/** Plain label and value lines under a hairline. */
export function StatLines({ rows, className }: { rows: readonly (readonly [string, string])[]; className?: string }) {
  return (
    <div className={cn("mt-5 border-t border-hairline-strong pt-4", className)}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-1.5 text-[16px] text-text">
          <span>{label}</span>
          <span className="text-text-muted">{value}</span>
        </div>
      ))}
    </div>
  );
}

/** "+12.4%" against the 30 days before. Up is green, down is red; a flat 0 reads as up. */
export function StatTrend({ pct }: { pct: number }) {
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

function InfoDot({ tip }: { tip: string }) {
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
