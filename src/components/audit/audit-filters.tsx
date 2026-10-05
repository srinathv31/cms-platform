"use client";

import { useOptimistic, useTransition } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AuditCategory, AuditFilters, AuditPageData } from "@/domain/access-types";
import {
  AUDIT_CATEGORIES,
  CATEGORY_LABEL,
  activeFilterCount,
  auditQuery,
  dateRangeLabel,
  filterValues,
  toggleFilterValue,
  type AuditListKey,
} from "@/domain/audit";
import { CHIP_ROW } from "./columns";

interface Opt {
  value: string;
  label: string;
  /** Muted second part of the label (a template's ID, in Geist Mono). */
  code?: string;
  count: number;
}

function Trigger({ label, n, icon: Icon }: { label: string; n: number; icon?: typeof CalendarDays }) {
  return (
    <PopoverTrigger
      render={
        <Button variant="outline" className={cn(n > 0 && "border-hairline-strong bg-selected")}>
          {Icon ? <Icon aria-hidden strokeWidth={1.75} data-icon="inline-start" /> : null}
          {label}
          {n > 0 ? <span className="text-text">· {n}</span> : null}
          <ChevronDown aria-hidden strokeWidth={1.75} data-icon="inline-end" className="text-text-muted" />
        </Button>
      }
    />
  );
}

/** An option row. Zero matches reads dimmed; on the hover fill, muted text turns full strength (contrast). */
function Row({ opt, on, onToggle }: { opt: Opt; on: boolean; onToggle: () => void }) {
  const none = opt.count === 0 && !on;
  return (
    <label
      className={cn(
        "group flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[14px] hover:bg-hover",
        none ? "text-text-muted hover:text-text" : "text-text",
      )}
    >
      <Checkbox checked={on} onCheckedChange={onToggle} aria-label={opt.label} />
      <span className="min-w-0 flex-1 truncate">
        {opt.label}
        {opt.code ? <span className="ml-2 font-mono text-[12px] text-text-muted group-hover:text-text">{opt.code}</span> : null}
      </span>
      <span className="text-[12px] text-text-muted tabular-nums group-hover:text-text">{opt.count}</span>
    </label>
  );
}

function Menu({
  label,
  selected,
  children,
  wide,
}: {
  label: string;
  selected: number;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Popover>
      <Trigger label={label} n={selected} />
      <PopoverContent
        align="start"
        aria-label={`${label} filter`}
        className={cn("max-h-80 gap-0 overflow-y-auto overscroll-contain p-1.5", wide ? "w-80" : "w-64")}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

interface Chip {
  key: string;
  label: string;
  remove: () => void;
}

/**
 * The filter bar: one menu per dimension, and what you pick becomes a removable chip under it.
 * The filters live in the URL, so every change is a navigation (shareable; back and forward work).
 * The chips and checkboxes follow the click at once and settle when the page has caught up.
 */
export function AuditFilterBar({
  basePath,
  applied,
  options,
  clearInEmpty,
}: {
  basePath: string;
  applied: AuditFilters;
  options: AuditPageData["options"];
  /** The empty result carries its own Clear all, so the bar doesn't repeat it. */
  clearInEmpty?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [f, setOptimistic] = useOptimistic(applied);

  const go = (next: AuditFilters) =>
    startTransition(() => {
      setOptimistic(next);
      router.push(`${basePath}${auditQuery(next)}` as Route, { scroll: false });
    });
  const toggle = (key: AuditListKey, value: string) => go(toggleFilterValue(f, key, value));

  const teamNames = new Map(options.teams.map((t) => [t.slug, t.name]));
  const people = new Map(options.people.map((p) => [p.id, p.name]));
  const actionLabels = new Map<string, string>([
    ...options.categories.map((c) => [c.value, c.label] as const),
    ...options.actions.map((a) => [a.value, a.label] as const),
  ]);
  const templates = new Map(options.templates.map((t) => [t.id, t.name]));

  const selTeams = filterValues(f, "team");
  const selPeople = filterValues(f, "person");
  const selActions = filterValues(f, "action");
  const selTemplates = filterValues(f, "template");
  const dated = Boolean(f.from || f.to);

  const chips: Chip[] = [
    ...selTeams.map((v) => ({ key: `team:${v}`, label: `Team: ${teamNames.get(v) ?? v}`, remove: () => toggle("team", v) })),
    ...selPeople.map((v) => ({ key: `person:${v}`, label: `Person: ${people.get(v) ?? v}`, remove: () => toggle("person", v) })),
    ...selActions.map((v) => ({
      key: `action:${v}`,
      label: `Action: ${actionLabels.get(v) ?? CATEGORY_LABEL[v as AuditCategory] ?? v}`,
      remove: () => toggle("action", v),
    })),
    ...selTemplates.map((v) => ({ key: `template:${v}`, label: `Template: ${templates.get(v) ?? v}`, remove: () => toggle("template", v) })),
    ...(dated
      ? [{ key: "date", label: `Date: ${dateRangeLabel(f.from, f.to)}`, remove: () => go({ ...f, from: undefined, to: undefined }) }]
      : []),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {options.teams.length > 0 ? (
          <Menu label="Team" selected={selTeams.length}>
            {options.teams.map((t) => (
              <Row key={t.slug} opt={{ value: t.slug, label: t.name, count: t.count }} on={selTeams.includes(t.slug)} onToggle={() => toggle("team", t.slug)} />
            ))}
          </Menu>
        ) : null}
        <Menu label="Person" selected={selPeople.length}>
          {options.people.map((p) => (
            <Row key={p.id} opt={{ value: p.id, label: p.name, count: p.count }} on={selPeople.includes(p.id)} onToggle={() => toggle("person", p.id)} />
          ))}
        </Menu>
        <Menu label="Action" selected={selActions.length}>
          {AUDIT_CATEGORIES.map((c) => {
            const group = options.actions.filter((a) => a.category === c);
            if (group.length === 0) return null;
            return (
              <div key={c} className="pb-1.5">
                <div className="caps-label px-2 pt-2 pb-1">{CATEGORY_LABEL[c]}</div>
                {group.map((a) => (
                  <Row key={a.value} opt={a} on={selActions.includes(a.value)} onToggle={() => toggle("action", a.value)} />
                ))}
              </div>
            );
          })}
        </Menu>
        <Menu label="Template" selected={selTemplates.length} wide>
          {options.templates.map((t) => (
            <Row key={t.id} opt={{ value: t.id, label: t.name, code: t.id, count: t.count }} on={selTemplates.includes(t.id)} onToggle={() => toggle("template", t.id)} />
          ))}
        </Menu>
        <Popover>
          <Trigger label="Date" n={dated ? 1 : 0} icon={CalendarDays} />
          <PopoverContent align="start" aria-label="Date filter" className="w-56 gap-0 p-1.5">
            {options.datePresets.map((p) => {
              const on = f.from === p.from && f.to === p.to;
              return (
                <button
                  key={p.days}
                  type="button"
                  aria-pressed={on}
                  onClick={() => go(on ? { ...f, from: undefined, to: undefined } : { ...f, from: p.from, to: p.to })}
                  className="flex h-8 items-center rounded-md px-2 text-left text-[14px] text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-selected aria-pressed:font-medium"
                >
                  {p.label}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      </div>
      <div className={CHIP_ROW}>
        {chips.length > 0 ? (
          <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <li
                key={c.key}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-chip-border bg-chip pr-1 pl-2.5 text-[13px] text-chip-text"
              >
                {c.label}
                <button
                  type="button"
                  aria-label={`Remove ${c.label}`}
                  onClick={c.remove}
                  className="grid size-5 place-items-center rounded-sm text-chip-icon outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X aria-hidden strokeWidth={1.75} className="size-3.5" />
                </button>
              </li>
            ))}
            {activeFilterCount(f) > 1 && !clearInEmpty ? (
              <li>
                <Button variant="ghost" size="sm" onClick={() => go({})}>
                  Clear all
                </Button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
