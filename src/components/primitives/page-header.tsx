import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/** Serif page title, optional tracked-caps eyebrow, and a slot for the screen's ONE primary action. */
export function PageHeader({
  title,
  eyebrow,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-end justify-between gap-6 pb-6", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="caps-label mb-2">{eyebrow}</div> : null}
        <h1 className="display-xl truncate text-text">{title}</h1>
        {children}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

/** The eyebrow while the space's name streams in. */
export function EyebrowSkeleton() {
  return <Skeleton className="h-4 w-24" />;
}
