"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import type { Person } from "./data";

/*
 * The three section layouts, fed by one list of items so a variant is a layout decision only:
 *   a  dense table rows, inline actions, the consequence in a strip under the row
 *   b  list + detail pane, the consequence replaces the buttons in the pane
 *   c  tinted card rows (Unknown-3), the consequence at the foot of the card
 */

export type Variant = "a" | "b" | "c";

export interface Act {
  key: string;
  label: string;
  /** Said before the action is committed. Without it the action runs on click. */
  consequence?: React.ReactNode;
  confirmLabel?: string;
  /** A required note: the confirm button stays disabled until it has text. */
  note?: string;
  icon?: LucideIcon;
  run: (note?: string) => void;
}

export interface Cell {
  label: string;
  node: React.ReactNode;
}

export interface Item {
  id: string;
  person?: Person;
  title: string;
  sub?: React.ReactNode;
  cells: Cell[];
  /** One short value the list shows beside the name in the list + detail layout. */
  meta?: string;
  actions: Act[];
  /** Shown instead of actions when the row is settled ("Approved as Author"). */
  settled?: React.ReactNode;
  dim?: boolean;
}

type Open = { id: string; key: string } | null;

export function ConfirmStrip({
  act,
  className,
  onConfirm,
  onCancel,
}: {
  act: Act;
  className?: string;
  onConfirm: (note?: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const first = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const target = first.current ?? cancel.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, []);
  const blocked = act.note !== undefined && note.trim() === "";
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg bg-surface-sunken p-4", className)}>
      <p className="text-[14px] leading-relaxed text-text">{act.consequence}</p>
      {act.note !== undefined ? (
        <Input
          ref={first}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={act.note}
          aria-label={act.note}
          className="bg-surface"
        />
      ) : null}
      <div className="flex justify-end gap-2">
        <Button ref={cancel} variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={blocked} onClick={() => onConfirm(act.note !== undefined ? note.trim() : undefined)}>
          {act.confirmLabel ?? act.label}
        </Button>
      </div>
    </div>
  );
}

function ActionButtons({ item, onPick }: { item: Item; onPick: (a: Act) => void }) {
  if (item.settled) return <span className="text-right text-[13px] leading-snug text-text-muted">{item.settled}</span>;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {item.actions.map((a) => (
        <Button key={a.key} variant="outline" onClick={() => onPick(a)}>
          {a.icon ? <a.icon aria-hidden strokeWidth={1.75} data-icon="inline-start" /> : null}
          {a.label}
        </Button>
      ))}
    </div>
  );
}

function Who({ item, size = "lg", bare }: { item: Item; size?: "default" | "lg"; bare?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {item.person ? <UserAvatar initials={item.person.initials} hue={item.person.hue} size={size} /> : null}
      <div className="min-w-0">
        <div className="truncate text-[15px] font-medium text-text">{item.title}</div>
        {item.sub && !bare ? <div className="truncate text-[13px] text-text-muted">{item.sub}</div> : null}
      </div>
    </div>
  );
}

export function Items({
  variant,
  items,
  grid,
  titleLabel,
  empty,
  actionsW = "10.25rem",
}: {
  variant: Variant;
  items: Item[];
  /** Column template for the table variant, between the name and the actions. */
  grid: string;
  titleLabel: string;
  empty: string;
  /** Width of the table variant's actions column: fixed so the header lines up with every row. */
  actionsW?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const run = (item: Item, a: Act, note?: string) => {
    a.run(note);
    setOpen(null);
    void item;
  };
  const pick = (item: Item, a: Act) => {
    if (a.consequence) setOpen({ id: item.id, key: a.key });
    else a.run();
  };
  const openAct = (item: Item) => (open?.id === item.id ? item.actions.find((a) => a.key === open.key) : undefined);

  if (items.length === 0) return <p className="py-10 text-[15px] text-text-muted">{empty}</p>;

  if (variant === "a") {
    const cols = `minmax(0,1.5fr) ${grid} ${actionsW}`;
    return (
      <div role="table" aria-label={titleLabel}>
        <div role="row" className="grid items-end gap-x-4 border-b border-hairline pb-2" style={{ gridTemplateColumns: cols }}>
          <span role="columnheader" className="caps-label">{titleLabel}</span>
          {items[0]!.cells.map((c) => (
            <span role="columnheader" key={c.label} className="caps-label">{c.label}</span>
          ))}
          <span aria-hidden />
        </div>
        {items.map((item) => {
          const act = openAct(item);
          return (
            <div key={item.id} className="border-b border-hairline">
              <div
                role="row"
                className={cn("grid min-h-16 items-center gap-x-4 py-2.5", item.dim && "opacity-60")}
                style={{ gridTemplateColumns: cols }}
              >
                <div role="cell" className="min-w-0"><Who item={item} /></div>
                {item.cells.map((c) => (
                  <div role="cell" key={c.label} className="min-w-0 text-[14px] text-text">{c.node}</div>
                ))}
                <div role="cell" className="flex justify-end">
                  {act ? null : <ActionButtons item={item} onPick={(a) => pick(item, a)} />}
                </div>
              </div>
              {act ? (
                <ConfirmStrip
                  act={act}
                  className="mb-3"
                  onCancel={() => setOpen(null)}
                  onConfirm={(note) => run(item, act, note)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (variant === "c") {
    return (
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const act = openAct(item);
          return (
            <li key={item.id} className={cn("rounded-xl border border-hairline bg-surface-tinted p-4", item.dim && "opacity-70")}>
              <div className="flex items-center justify-between gap-4">
                <Who item={item} />
                {act ? null : <ActionButtons item={item} onPick={(a) => pick(item, a)} />}
              </div>
              <dl className="mt-3 flex flex-wrap gap-x-10 gap-y-3 border-t border-hairline pt-3">
                {item.cells.map((c) => (
                  <div key={c.label} className="min-w-0">
                    <dt className="caps-label">{c.label}</dt>
                    <dd className="mt-1 text-[14px] text-text">{c.node}</dd>
                  </div>
                ))}
              </dl>
              {act ? (
                <ConfirmStrip
                  act={act}
                  className="mt-4 bg-surface"
                  onCancel={() => setOpen(null)}
                  onConfirm={(note) => run(item, act, note)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  const sel = items.find((i) => i.id === picked) ?? items[0]!;
  const act = openAct(sel);
  return (
    <div className="grid grid-cols-[15rem_minmax(0,1fr)] gap-8">
      <ul className="flex flex-col gap-0.5" aria-label={titleLabel}>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-current={item.id === sel.id ? "true" : undefined}
              onClick={() => {
                setPicked(item.id);
                setOpen(null);
              }}
              className={cn(
                "flex h-14 w-full items-center rounded-lg px-3 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
                item.id === sel.id && "bg-selected hover:bg-selected",
                item.dim && "opacity-60",
              )}
            >
              <Who item={item} size="default" bare={!!item.meta} />
              {item.meta ? <span className="ml-auto shrink-0 pl-2 text-[13px] text-text-muted">{item.meta}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0 rounded-xl border border-hairline p-6" key={sel.id}>
        <div className="flex items-center gap-4">
          {sel.person ? <UserAvatar initials={sel.person.initials} hue={sel.person.hue} size="lg" className="size-12" /> : null}
          <div className="min-w-0">
            <div className="truncate text-[18px] font-medium text-text">{sel.title}</div>
            {sel.sub ? <div className="truncate text-[13px] text-text-muted">{sel.sub}</div> : null}
          </div>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
          {sel.cells.map((c) => (
            <div key={c.label}>
              <dt className="caps-label">{c.label}</dt>
              <dd className="mt-1.5 text-[14px] text-text">{c.node}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-7 border-t border-hairline pt-5">
          {act ? (
            <ConfirmStrip act={act} onCancel={() => setOpen(null)} onConfirm={(note) => run(sel, act, note)} />
          ) : (
            <ActionButtons item={sel} onPick={(a) => pick(sel, a)} />
          )}
        </div>
      </div>
    </div>
  );
}
