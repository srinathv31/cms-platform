import { Skeleton } from "@/components/ui/skeleton";

/** A section's table while it loads: the header and five rows at the real row height. */
export function SectionSkeleton() {
  return (
    <div aria-hidden>
      <div className="border-b border-hairline pb-2">
        <Skeleton className="h-3 w-16" />
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex min-h-16 items-center gap-3 border-b border-hairline py-2.5">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
      ))}
    </div>
  );
}
