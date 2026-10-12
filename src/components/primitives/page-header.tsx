import { cn } from "@/lib/utils";

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
    // On a narrow canvas the action drops under the title instead of squeezing it to an ellipsis (reflow, decision 0045).
    <header
      className={cn(
        "flex items-end justify-between gap-6 pb-6 @max-[26rem]/canvas:flex-wrap @max-[26rem]/canvas:gap-y-4",
        className,
      )}
    >
      <div className="min-w-0 @max-[26rem]/canvas:max-w-full">
        {eyebrow ? <div className="caps-label mb-2">{eyebrow}</div> : null}
        <h1 className="display-xl truncate text-text @max-[26rem]/canvas:whitespace-normal">
          {title}
        </h1>
        {children}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      ) : null}
    </header>
  );
}
