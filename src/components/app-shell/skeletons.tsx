import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { NAV_ICON_STROKE, NAV_ITEMS, NAV_ROW } from "./nav";

// Fallbacks for every streamed hole in the frame. Each one has the same geometry as the
// content that replaces it, so nothing moves when the real thing arrives.

/** Team switcher row (h-12): icon tile, name, chevrons. */
export function TeamSwitcherSkeleton() {
  return (
    <div className="flex h-12 items-center gap-3 px-2" aria-hidden>
      <Skeleton className="size-8 rounded-lg" />
      <Skeleton className="h-4 w-28" />
    </div>
  );
}

function StaticRow({
  icon: Icon,
  label,
  className,
}: {
  icon: React.ComponentType<{ strokeWidth?: number; "aria-hidden"?: boolean }>;
  label: string;
  className?: string;
}) {
  return (
    <li className="relative">
      <div className={cn("flex w-full items-center", NAV_ROW, "opacity-60", className)}>
        <Icon aria-hidden strokeWidth={NAV_ICON_STROKE} />
        <span>{label}</span>
      </div>
    </li>
  );
}

/** Nav rows with their real labels (those are static), the hairline, and the Help row. */
export function SidebarBodySkeleton() {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2" aria-hidden>
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.filter((i) => i.key !== "audit").map((item) => (
            <StaticRow key={item.key} icon={item.icon} label={item.label} />
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-3 px-3 pb-4" aria-hidden>
        <div className="mx-1 h-px bg-hairline" />
        <ul className="flex flex-col gap-1">
          <StaticRow icon={HelpCircle} label="Help" />
        </ul>
      </div>
    </>
  );
}

/** Search pill, bell, avatar. */
export function TopBarSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <Skeleton className="h-9 w-[7.75rem] rounded-full" />
      <Skeleton className="size-9 rounded-full" />
      <Skeleton className="size-9 rounded-full" />
    </div>
  );
}
