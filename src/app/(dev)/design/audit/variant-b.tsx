"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ACTORS, KINDS, KIND_GROUPS, TEAMS, TEMPLATES } from "./data";
import { DateFields, PresetList } from "./variant-a";
import { EMPTY, activeCount, facetCounts, toggle, type Filters } from "./filters";

/* B: a facet rail. Every dimension is visible at once, and each option carries the count it would give. */

function Facet({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: { value: string; label: string; count: number }[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <section>
      <h3 className="caps-label px-2 pb-1.5">{title}</h3>
      {options.map((o) => (
        <label key={o.value} className={cn("flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[14px] text-text hover:bg-hover", o.count === 0 && !selected.includes(o.value) && "text-text-muted")}>
          <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => onToggle(o.value)} aria-label={o.label} />
          <span className="flex-1 truncate">{o.label}</span>
          <span className="text-[12px] text-text-muted tabular-nums">{o.count}</span>
        </label>
      ))}
    </section>
  );
}

export function FacetRail({ f, set }: { f: Filters; set: (f: Filters) => void }) {
  const teams = facetCounts(f, "teams", (e) => e.team);
  const people = facetCounts(f, "people", (e) => e.actor);
  const kinds = facetCounts(f, "kinds", (e) => e.kind);
  const tmpls = facetCounts(f, "templates", (e) => e.template);
  return (
    <aside aria-label="Filters" className="flex min-h-0 w-60 shrink-0 flex-col">
      <div className="flex h-8 items-center justify-between pb-0.5">
        <span className="text-[15px] font-medium text-text">Filters</span>
        {activeCount(f) > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => set(EMPTY)}>Clear all</Button>
        ) : null}
      </div>
      <div className="relative mt-3">
        <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-muted" />
        <Input value={f.text} onChange={(e) => set({ ...f, text: e.target.value })} placeholder="Search details" aria-label="Search details" className="pl-8" />
      </div>
      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain pr-1 pb-10">
        <Facet title="Team" selected={f.teams} onToggle={(v) => set({ ...f, teams: toggle(f.teams, v) })} options={TEAMS.map((t) => ({ value: t.id, label: t.name, count: teams[t.id] ?? 0 }))} />
        <section>
          <h3 className="caps-label px-2 pb-1.5">Date</h3>
          <PresetList f={f} set={set} />
          <div className="mt-2 px-1">
            <DateFields f={f} set={set} />
          </div>
        </section>
        {KIND_GROUPS.map((g) => (
          <Facet key={g} title={`${g.slice(0, -1) === "Template" ? "Template" : g} actions`} selected={f.kinds} onToggle={(v) => set({ ...f, kinds: toggle(f.kinds, v) })} options={KINDS.filter((k) => k.group === g).map((k) => ({ value: k.id, label: k.label, count: kinds[k.id] ?? 0 }))} />
        ))}
        <Facet title="Person" selected={f.people} onToggle={(v) => set({ ...f, people: toggle(f.people, v) })} options={ACTORS.map((a) => ({ value: a.id, label: a.name, count: people[a.id] ?? 0 }))} />
        <Facet title="Template" selected={f.templates} onToggle={(v) => set({ ...f, templates: toggle(f.templates, v) })} options={TEMPLATES.map((t) => ({ value: t.id, label: t.name, count: tmpls[t.id] ?? 0 }))} />
      </div>
    </aside>
  );
}
