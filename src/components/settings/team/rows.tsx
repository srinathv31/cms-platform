"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/domain/access-types";
import type { Person } from "@/domain/review-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { runAction } from "@/components/versions/action-dialog";

// The shared row machinery of the four Team sections (settings variant A): a dense table whose rows
// carry their actions inline, and a consequence strip under the row before anything is committed.
// The strip's black button is the only black button on screen.

// ── Running an action ────────────────────────────────────────

/** One server action at a time: the pending flag, the refusal sentence and a guarded `run`. */
export function useActionRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  function run(action: () => Promise<ActionResult>, onOk?: () => void) {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    start(async () => {
      try {
        const result = await runAction(action);
        if (result.ok) onOk?.();
        else setError(result.reason);
      } finally {
        sending.current = false;
      }
    });
  }

  return { pending, error, setError, run };
}

// ── The consequence strip ────────────────────────────────────

/**
 * The strip under a row: what will happen, optional inputs, then Cancel and the confirm. Focus goes to
 * the first input (`data-autofocus`) or, with none, to Cancel (the safe action). Esc closes the strip and
 * nothing else.
 */
export function Strip({
  consequence,
  children,
  confirmLabel,
  blocked = false,
  message,
  onConfirm,
  onCancel,
  onDone,
  className,
}: {
  consequence: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  /** The confirm can't run yet (a required note is empty, nothing to save). */
  blocked?: boolean;
  /** Said beside the buttons while it applies. */
  message?: string | null;
  onConfirm: () => Promise<ActionResult>;
  onCancel: () => void;
  /** Called once the server accepted the action. */
  onDone: () => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const { pending, error, run } = useActionRun();

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>("[data-cancel]");
    target?.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
  }, []);

  const shown = error ?? message;

  return (
    <div
      ref={root}
      data-slot="consequence-strip"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (!pending) onCancel();
      }}
      className={cn("flex flex-col gap-3 rounded-lg bg-surface-sunken p-4", className)}
    >
      <p className="text-[14px] leading-relaxed text-text">{consequence}</p>
      {children}
      <div className="flex items-center justify-end gap-2">
        {shown ? (
          <p role={error ? "alert" : undefined} className={cn("mr-auto text-[13px]", error ? "text-danger-text" : "text-text-muted")}>
            {shown}
          </p>
        ) : null}
        <Button data-cancel variant="ghost" aria-disabled={pending} onClick={() => (pending ? undefined : onCancel())}>
          Cancel
        </Button>
        <Button
          aria-disabled={blocked || pending}
          className="aria-disabled:opacity-50"
          onClick={() => {
            if (blocked || pending) return;
            run(onConfirm, onDone);
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/** The strip most actions use: a consequence, an optional required note, and the confirm. */
export function ConfirmStrip({
  spec,
  onCancel,
  onDone,
}: {
  spec: StripSpec;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const noteId = useId();
  // The note's own rule (the domain's check, passed in with it) holds the confirm until it's met.
  const noteBlocked = spec.note ? spec.note.problem(note) !== null : false;
  return (
    <Strip
      consequence={spec.consequence}
      confirmLabel={spec.confirmLabel}
      blocked={noteBlocked}
      onConfirm={() => spec.run(spec.note ? note.trim() : undefined)}
      onCancel={onCancel}
      onDone={onDone}
    >
      {spec.detail}
      {spec.note ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="text-[13px] text-text-muted">
            {spec.note.label}
          </label>
          <Input
            id={noteId}
            data-autofocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={spec.note.max}
            className="bg-surface"
          />
        </div>
      ) : null}
    </Strip>
  );
}

// ── Rows ─────────────────────────────────────────────────────

export interface StripSpec {
  consequence: ReactNode;
  confirmLabel: string;
  /** Shown in full under the consequence (what's being decided on, like a request's reason). */
  detail?: ReactNode;
  /**
   * A note typed in the strip: its label above the field, its length limit, and the domain's check,
   * which holds the confirm while it returns a reason (a denial needs a note).
   */
  note?: { label: string; max: number; problem: (note: string) => string | null };
  run: (note?: string) => Promise<ActionResult>;
}

export interface RowAct {
  key: string;
  label: string;
  /** The refusal sentence when the viewer is blocked from this action; null or absent when allowed. */
  blocked?: string | null;
  /** Said first, confirmed second. Without it (and without `custom`) `run` happens on click. */
  strip?: StripSpec;
  /** A bespoke strip, like the roles editor. */
  custom?: (api: { close: () => void }) => ReactNode;
  run?: () => Promise<ActionResult>;
}

export interface RowData {
  id: string;
  person: Person;
  /** Beside the name, muted: "You". */
  aside?: ReactNode;
  /** Under the name, muted. */
  sub: ReactNode;
  cells: ReactNode[];
  /** A row that isn't live (suspended, lapsed, removed) reads dimmed. */
  dim?: boolean;
  actions: RowAct[];
  /** Shown in place of the actions once the row is settled. */
  settled?: ReactNode;
}

function Blocked({ reason }: { reason: string }) {
  return <span className="text-right text-[13px] leading-snug text-text-muted">{reason}</span>;
}

function Actions({ row, onPick }: { row: RowData; onPick: (act: RowAct) => void }) {
  if (row.settled) return <span className="text-right text-[13px] leading-snug text-text-muted">{row.settled}</span>;
  if (row.actions.length === 0) return null;
  const reasons = row.actions.map((a) => a.blocked ?? null);
  // Everything blocked for one reason: say it once instead of two dead buttons.
  if (reasons.every((r) => r !== null && r === reasons[0])) return <Blocked reason={reasons[0]!} />;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {row.actions.map((a) => {
        const button = (
          <Button
            key={a.key}
            data-act={`${row.id}:${a.key}`}
            variant="outline"
            disabled={!!a.blocked}
            onClick={() => onPick(a)}
          >
            {a.label}
          </Button>
        );
        if (!a.blocked) return button;
        return (
          <Tooltip key={a.key}>
            <TooltipTrigger render={<span tabIndex={0} className="inline-flex rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}>
              {button}
            </TooltipTrigger>
            <TooltipContent>{a.blocked}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * A caps-label header and one dense row per item. `cols` is the grid between the name column and
 * the actions column; `actionsW` is fixed so the header lines up with every row.
 */
export function RowTable({
  label,
  tableLabel,
  columns,
  cols,
  actionsW = "10rem",
  rows,
  empty,
}: {
  label: string;
  /** The table's accessible name when it differs from the first column's header. */
  tableLabel?: string;
  /** Header labels, one per entry in each row's `cells`. */
  columns: string[];
  cols: string;
  actionsW?: string;
  rows: RowData[];
  empty?: string;
}) {
  const [open, setOpen] = useState<{ id: string; key: string } | null>(null);
  const [failure, setFailure] = useState<{ id: string; reason: string } | null>(null);
  const table = useRef<HTMLDivElement>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [, start] = useTransition();

  // After a strip closes without a change, focus returns to the button that opened it.
  useEffect(() => {
    if (open !== null || returnTo === null) return;
    table.current?.querySelector<HTMLElement>(`[data-act="${CSS.escape(returnTo)}"]`)?.focus();
  }, [open, returnTo]);

  // The name column keeps 8rem; on a narrow dialog the table scrolls sideways inside the panel instead.
  const grid = `minmax(8rem,1fr) ${cols} ${actionsW}`;
  const span = columns.length + 2;
  const close = (rowId: string, key: string, returnFocus: boolean) => {
    setReturnTo(returnFocus ? `${rowId}:${key}` : null);
    setOpen(null);
  };
  const pick = (row: RowData, act: RowAct) => {
    setFailure(null);
    setReturnTo(null);
    if (act.strip || act.custom) {
      setOpen({ id: row.id, key: act.key });
      return;
    }
    const run = act.run;
    if (!run) return;
    start(async () => {
      const result = await runAction(run);
      if (!result.ok) setFailure({ id: row.id, reason: result.reason });
    });
  };

  if (rows.length === 0) return empty ? <p className="py-6 text-[15px] text-text-muted">{empty}</p> : null;

  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <div ref={table} role="table" aria-label={tableLabel ?? label} className="min-w-min">
        <div role="row" className="grid items-end gap-x-3 border-b border-hairline pb-2" style={{ gridTemplateColumns: grid }}>
          <span role="columnheader" className="caps-label">{label}</span>
          {columns.map((c) => (
            <span role="columnheader" key={c} className="caps-label">{c}</span>
          ))}
          <span role="columnheader">
            <span className="sr-only">Actions</span>
          </span>
        </div>
        {rows.map((row) => {
          const act = open?.id === row.id ? row.actions.find((a) => a.key === open.key) : undefined;
          return (
            <div key={row.id} role="rowgroup" className="border-b border-hairline">
              <div
                role="row"
                data-person={row.person.id}
                className="grid min-h-16 items-center gap-x-3 py-2.5"
                style={{ gridTemplateColumns: grid }}
              >
                {/* A dimmed row: the avatar goes grey and the text goes muted (fading either would fail contrast). */}
                <div role="cell" className="flex min-w-0 items-center gap-3">
                  <span aria-hidden className="shrink-0">
                    <UserAvatar initials={row.person.initials} hue={row.person.hue} muted={row.dim} />
                  </span>
                  <div className="min-w-0">
                    <div className={cn("truncate text-[15px] font-medium", row.dim ? "text-text-muted" : "text-text")}>
                      {row.person.name}
                      {row.aside ? <span className="font-normal text-text-muted"> {row.aside}</span> : null}
                    </div>
                    <div className="truncate text-[13px] text-text-muted" title={typeof row.sub === "string" ? row.sub : undefined}>
                      {row.sub}
                    </div>
                  </div>
                </div>
                {row.cells.map((cell, i) => (
                  <div role="cell" key={columns[i]} className={cn("min-w-0 text-[14px]", row.dim ? "text-text-muted" : "text-text")}>
                    {cell}
                  </div>
                ))}
                <div role="cell" className="flex justify-end">
                  {act ? null : <Actions row={row} onPick={(a) => pick(row, a)} />}
                </div>
              </div>
              {failure?.id === row.id ? (
                <FullRow span={span}>
                  <p role="alert" className="pb-3 text-right text-[13px] text-danger-text">{failure.reason}</p>
                </FullRow>
              ) : null}
              {act ? (
                <FullRow span={span} className="pb-3">
                  {act.custom ? (
                    act.custom({ close: () => close(row.id, act.key, true) })
                  ) : act.strip ? (
                    <ConfirmStrip
                      spec={act.strip}
                      onCancel={() => close(row.id, act.key, true)}
                      onDone={() => close(row.id, act.key, false)}
                    />
                  ) : null}
                </FullRow>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A row's strip, inside its rowgroup: one row, one cell spanning every column (valid table structure). */
function FullRow({ span, className, children }: { span: number; className?: string; children: ReactNode }) {
  return (
    <div role="row" className={className}>
      <div role="cell" aria-colspan={span}>
        {children}
      </div>
    </div>
  );
}

/** A section's small caps heading over a second table ("Decided", "Suspended"). */
export function GroupHeading({ children }: { children: ReactNode }) {
  return <h3 className="caps-label mt-10 mb-3">{children}</h3>;
}

/** A thin determinate bar, brand fill on the selected tint. */
export function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-selected", className)} aria-hidden>
      <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}
