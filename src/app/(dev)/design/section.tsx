import { cn } from "@/lib/utils";

/**
 * One specimen section: a small tracked-caps label and a one-line note in a left rail,
 * the specimens to the right. The rail stays in view while its section scrolls.
 */
export function Section({
  id,
  label,
  note,
  children,
}: {
  id: string;
  label: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-label`}
      className="grid gap-8 border-t border-hairline py-12 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14"
    >
      <header className="lg:sticky lg:top-10 lg:self-start">
        <h2 id={`${id}-label`} className="caps-label">
          {label}
        </h2>
        {note ? <p className="mt-2 max-w-[13rem] text-[13px] leading-5 text-text-muted">{note}</p> : null}
      </header>
      <div className="flex min-w-0 flex-col gap-10">{children}</div>
    </section>
  );
}

/** A named group inside a section. */
export function Group({
  title,
  aside,
  children,
  className,
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {title ? (
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-[14px] leading-5 font-medium text-text">{title}</h3>
          {aside ? <span className="text-[13px] leading-5 text-text-muted">{aside}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Mono caption for a token or class name. */
export function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px] leading-4 text-text-subtle", className)}>{children}</span>;
}
