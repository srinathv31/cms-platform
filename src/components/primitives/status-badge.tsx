import { Archive, Ban, Check, Clock, CornerUpLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatShortDate } from "@/domain/render/errors";
import { STATUS_META, type StatusMeta } from "@/domain/status";
import type { VersionState } from "@/domain/types";

// The ONE way a lifecycle state is shown. Same badge, same color, same wording everywhere.

const TONE: Record<StatusMeta["tone"], string> = {
  draft: "bg-status-draft text-status-draft-text border-status-draft-border",
  review: "bg-status-review text-status-review-text border-status-review-border",
  changes: "bg-status-changes text-status-changes-text border-status-changes-border",
  active: "bg-status-active text-status-active-text border-status-active-border",
  superseded: "bg-status-superseded text-status-superseded-text border-status-superseded-border",
  revoked: "bg-status-revoked text-status-revoked-text border-status-revoked-border",
};

function StatusIcon({ icon }: { icon: StatusMeta["icon"] }) {
  switch (icon) {
    case "dot":
      return <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />;
    case "clock":
      return <Clock aria-hidden strokeWidth={2} />;
    case "corner-up-left":
      return <CornerUpLeft aria-hidden strokeWidth={2} />;
    case "check":
      return <Check aria-hidden strokeWidth={2.25} />;
    case "archive":
      return <Archive aria-hidden strokeWidth={2} />;
    case "ban":
      return <Ban aria-hidden strokeWidth={2} />;
  }
}

export function StatusBadge({
  state,
  sunsetAt,
  className,
}: {
  state: VersionState;
  /** Superseded versions show "Sunset Mar 1" when a sunset date is set. A sunset is a calendar day (midnight UTC), shown as that day in every time zone. */
  sunsetAt?: Date | null;
  className?: string;
}) {
  const meta = STATUS_META[state];
  return (
    <Badge
      variant="outline"
      data-status={state}
      className={cn("h-[22px] gap-1.5 px-2 text-[12px] font-medium", TONE[meta.tone], className)}
    >
      <StatusIcon icon={meta.icon} />
      {meta.label}
      {state === "superseded" && sunsetAt ? (
        <span className="font-normal opacity-80">· Sunset {formatShortDate(sunsetAt)}</span>
      ) : null}
    </Badge>
  );
}
