"use client";

import { CalendarDays, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ACTORS, ACTOR, KINDS, KIND, KIND_GROUPS, PRESETS, TEAMS, TEAM, TEMPLATES, TMPL, TODAY, rangeLabel } from "./data";
import { EMPTY, activeCount, facetCounts, toggle, type Filters } from "./filters";

/* A: a filter bar. One menu per dimension; what you pick becomes a removable chip under the bar. */

interface Opt {
  value: string;
  label: string;
  count?: number;
}

function Trigger({ label, n, icon: Icon }: { label: string; n: number; icon?: typeof CalendarDays }) {
  return (
    <PopoverTrigger
      render={
        <Button variant="outline" className={cn(n > 0 && "border-hairline-strong bg-selected")}>
          {Icon ? <Icon aria-hidden strokeWidth={1.75} data-icon="inline-start" /> : null}
          {label}
          {n > 0 ? <span className="text-text-muted">· {n}</span> : null}
          <ChevronDown aria-hidden strokeWidth={1.75} data-icon="inline-end" className="text-text-muted" />
        </Button>
      }
    />
  );
}

function Row({ opt, on, onToggle }: { opt: Opt; on: boolean; onToggle: () => void }) {
  return (
    <label className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[14px] text-text hover:bg-hover">
      <Checkbox checked={on} onCheckedChange={onToggle} aria-label={opt.label} />
      <span className="flex-1 truncate">{opt.label}</span>
      {opt.count !== undefined ? <span className="text-[12px] text-text-muted tabular-nums">{opt.count}</span> : null}
    </label>
  );
}

function Multi({ label, options, selected, onToggle }: { label: string; options: Opt[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <Popover>
      <Trigger label={label} n={selected.length} />
      <PopoverContent align="start" className="max-h-80 w-64 gap-0 overflow-y-auto p-1.5">
        {options.map((o) => (
          <Row key={o.value} opt={o} on={selected.includes(o.value)} onToggle={() => onToggle(o.value)} />
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function DateFields({ f, set }: { f: Filters; set: (f: Filters) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["from", "to"] as const).map((k) => (
        <label key={k}>
          <span className="caps-label mb-1 block">{k === "from" ? "From" : "To"}</span>
          <input
            type="date"
            value={f[k] ?? ""}
            max={TODAY}
            onChange={(e) => set({ ...f, [k]: e.target.value || null })}
            className="h-8 w-full rounded-lg border border-hairline bg-surface px-2 text-[13px] text-text outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
      ))}
    </div>
  );
}

export function PresetList({ f, set }: { f: Filters; set: (f: Filters) => void }) {
  return (
    <div className="flex flex-col">
      {PRESETS.map((p) => {
        const on = f.from === p.from && f.to === p.to;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() => set({ ...f, from: on ? null : p.from, to: on ? null : p.to })}
            className="flex h-8 items-center rounded-md px-2 text-left text-[14px] text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-selected aria-pressed:font-medium"
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterBar({ f, set }: { f: Filters; set: (f: Filters) => void }) {
  const teams = facetCounts(f, "teams", (e) => e.team);
  const people = facetCounts(f, "people", (e) => e.actor);
  const kinds = facetCounts(f, "kinds", (e) => e.kind);
  const tmpls = facetCounts(f, "templates", (e) => e.template);
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...f.teams.map((v) => ({ key: `t${v}`, label: `Team: ${TEAM[v]}`, remove: () => set({ ...f, teams: toggle(f.teams, v) }) })),
    ...f.people.map((v) => ({ key: `p${v}`, label: `Person: ${ACTOR[v]!.name}`, remove: () => set({ ...f, people: toggle(f.people, v) }) })),
    ...f.kinds.map((v) => ({ key: `k${v}`, label: `Action: ${KIND[v as keyof typeof KIND].label}`, remove: () => set({ ...f, kinds: toggle(f.kinds, v) }) })),
    ...f.templates.map((v) => ({ key: `m${v}`, label: `Template: ${TMPL[v]!.name}`, remove: () => set({ ...f, templates: toggle(f.templates, v) }) })),
    ...(f.from || f.to ? [{ key: "d", label: `Date: ${rangeLabel(f.from, f.to)}`, remove: () => set({ ...f, from: null, to: null }) }] : []),
    ...(f.text.trim() ? [{ key: "x", label: `Contains: ${f.text.trim()}`, remove: () => set({ ...f, text: "" }) }] : []),
  ];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Multi label="Team" selected={f.teams} onToggle={(v) => set({ ...f, teams: toggle(f.teams, v) })} options={TEAMS.map((t) => ({ value: t.id, label: t.name, count: teams[t.id] ?? 0 }))} />
        <Multi label="Person" selected={f.people} onToggle={(v) => set({ ...f, people: toggle(f.people, v) })} options={ACTORS.map((a) => ({ value: a.id, label: a.name, count: people[a.id] ?? 0 }))} />
        <Popover>
          <Trigger label="Action" n={f.kinds.length} />
          <PopoverContent align="start" className="max-h-96 w-64 gap-0 overflow-y-auto p-1.5">
            {KIND_GROUPS.map((g) => (
              <div key={g} className="pb-1.5">
                <div className="caps-label px-2 pt-2 pb-1">{g}</div>
                {KINDS.filter((k) => k.group === g).map((k) => (
                  <Row key={k.id} opt={{ value: k.id, label: k.label, count: kinds[k.id] ?? 0 }} on={f.kinds.includes(k.id)} onToggle={() => set({ ...f, kinds: toggle(f.kinds, k.id) })} />
                ))}
              </div>
            ))}
          </PopoverContent>
        </Popover>
        <Multi label="Template" selected={f.templates} onToggle={(v) => set({ ...f, templates: toggle(f.templates, v) })} options={TEMPLATES.map((t) => ({ value: t.id, label: t.name, count: tmpls[t.id] ?? 0 }))} />
        <Popover>
          <Trigger label="Date" n={f.from || f.to ? 1 : 0} icon={CalendarDays} />
          <PopoverContent align="start" className="w-64 gap-3 p-2.5">
            <PresetList f={f} set={set} />
            <div className="border-t border-hairline pt-3">
              <DateFields f={f} set={set} />
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <span key={c.key} className="inline-flex h-7 items-center gap-1 rounded-md border border-chip-border bg-chip pr-1 pl-2.5 text-[13px] text-chip-text">
              {c.label}
              <button type="button" aria-label={`Remove ${c.label}`} onClick={c.remove} className="grid size-5 place-items-center rounded-sm text-chip-icon outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring">
                <X aria-hidden strokeWidth={1.75} className="size-3.5" />
              </button>
            </span>
          ))}
          {activeCount(f) > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => set(EMPTY)}>Clear all</Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
