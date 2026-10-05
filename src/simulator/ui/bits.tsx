import { cn } from "@/lib/utils";

/*
 * Small pieces of Coral's console. They read the --sim-* palette from src/simulator/theme.css and never
 * carry a colour of their own. Server-safe (no hooks): interactive wrappers live in their own files.
 */

export type Tone = "ok" | "bad" | "warn" | "info" | "plain";

const PILL: Record<Tone, string> = {
  ok: "bg-(--sim-ok-bg) text-(--sim-ok)",
  bad: "bg-(--sim-bad-bg) text-(--sim-bad)",
  warn: "bg-(--sim-warn-bg) text-(--sim-warn)",
  info: "bg-(--sim-info-bg) text-(--sim-info)",
  plain: "bg-(--sim-panel2) text-(--sim-muted)",
};

export function Pill({ tone = "plain", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-(--sim-rs) px-1.5 text-[11px] leading-none font-medium whitespace-nowrap",
        PILL[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type BtnKind = "primary" | "secondary" | "ghost";

/** Class list for a 32px button; shared by <Btn> and by links that look like buttons. */
export function btnClass(kind: BtnKind = "secondary", className?: string) {
  return cn(
    "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-(--sim-rb) px-3 text-[13px] font-medium whitespace-nowrap no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
    kind === "primary" && "bg-(--sim-accent) text-(--sim-accent-text) hover:brightness-110",
    kind === "secondary" && "border border-(--sim-line) bg-(--sim-panel) text-(--sim-text) hover:bg-(--sim-panel2)",
    kind === "ghost" && "text-(--sim-muted) hover:bg-(--sim-panel2) hover:text-(--sim-text)",
    className,
  );
}

export function Btn({
  kind = "secondary",
  className,
  ...props
}: React.ComponentProps<"button"> & { kind?: BtnKind }) {
  return <button type="button" {...props} className={btnClass(kind, className)} />;
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-(family-name:--sim-mono) text-[12px]", className)}>{children}</span>;
}

export function Panel({
  title,
  right,
  children,
  className,
  label,
  id,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  label?: string;
  id?: string;
}) {
  return (
    <section id={id} aria-label={label} className={cn("rounded-md border border-(--sim-line) bg-(--sim-panel)", className)}>
      {title ? (
        <div className="flex h-11 items-center justify-between gap-3 border-b border-(--sim-line) px-4">
          <h2 className="m-0 text-[13px] font-semibold text-(--sim-text)">{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({ crumbs, title, right }: { crumbs: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex min-h-[3.75rem] items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="m-0 h-4 text-[12px] leading-4 text-(--sim-muted)">{crumbs}</p>
        <h1 className="m-0 mt-1 truncate text-[22px] leading-7 font-semibold tracking-tight text-(--sim-text)">{title}</h1>
      </div>
      {right}
    </div>
  );
}

/** A coloured notice strip: UCOMP couldn't be reached, the pinned version is revoked, and the like. */
export function Strip({ tone, children, action }: { tone: "bad" | "info" | "warn"; children: React.ReactNode; action?: React.ReactNode }) {
  const tones = {
    bad: "border-(--sim-bad)/30 bg-(--sim-bad-bg) text-(--sim-bad)",
    info: "border-(--sim-info)/25 bg-(--sim-info-bg) text-(--sim-info)",
    warn: "border-(--sim-warn)/30 bg-(--sim-warn-bg) text-(--sim-warn)",
  } as const;
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("flex min-h-12 items-center gap-3 rounded-md border px-4 py-2.5 text-[13px]", tones[tone])}>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

export const TH = "h-9 px-4 text-left text-[11px] font-semibold tracking-wider text-(--sim-muted) uppercase";
export const TD = "px-4 py-2.5 align-middle text-[13px]";

/** Wraps a table so a narrow main pane scrolls the table, never the page. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}
