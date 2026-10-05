import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/** "Breaking change": a version whose variable list would break a consumer. The warning tokens, same everywhere it shows. */
export function BreakingBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-[22px] gap-1.5 border-warning-border bg-warning-soft px-2 text-[12px] font-medium text-warning-text",
        className,
      )}
    >
      <TriangleAlert aria-hidden strokeWidth={2} />
      Breaking change
    </Badge>
  );
}
