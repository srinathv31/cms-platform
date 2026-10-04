import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

const integer = new Intl.NumberFormat("en-US");

/**
 * Tracked-caps label over a big, regular-weight tabular numeral. Optional trend pill and footnote.
 * Server-safe. Tinted card on the canvas: hairline border, no shadow.
 */
export function StatCard({
  label,
  value,
  trend,
  trendTone = "positive",
  footnote,
  className,
}: {
  label: React.ReactNode;
  /** Numbers are formatted with thousands separators ("12,480"). Strings render as given. */
  value: number | string;
  /** Pill text, e.g. "12% this month". The arrow is drawn for you. */
  trend?: string;
  trendTone?: "positive" | "negative";
  footnote?: React.ReactNode;
  className?: string;
}) {
  const TrendIcon = trendTone === "positive" ? TrendingUp : TrendingDown;
  return (
    <dl
      data-slot="stat-card"
      className={cn(
        "m-0 flex min-w-0 flex-col rounded-xl border border-hairline bg-surface-tinted p-6",
        className,
      )}
    >
      <div className="flex min-h-6 items-start justify-between gap-3">
        <dt className="caps-label pt-0.5">{label}</dt>
        {trend ? (
          <dd
            className={cn(
              "m-0 inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium whitespace-nowrap",
              trendTone === "positive"
                ? "bg-positive-soft text-positive"
                : "bg-danger-soft text-danger-text",
            )}
          >
            <TrendIcon aria-hidden strokeWidth={1.75} className="size-3.5" />
            {trend}
          </dd>
        ) : null}
      </div>
      <dd className="numeral m-0 mt-4 text-text">
        {typeof value === "number" ? integer.format(value) : value}
      </dd>
      {footnote ? (
        <dd className="m-0 mt-4 border-t border-hairline pt-3 text-[13px] leading-5 text-text-muted">
          {footnote}
        </dd>
      ) : null}
    </dl>
  );
}
