import { StatCard } from "@/components/primitives/stat-card";
import { cn } from "@/lib/utils";

// The Usage screens' building blocks: one card and its heading. The stat cards' numeral, label, lines
// and trend pill are the shared ones (`@/components/primitives/stat-card`). Server components.

/** The one card: the stat card's surface (tinted fill, hairline, no ring, 24px padding), for the charts and tables too. */
export const Panel = StatCard;

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
