import { ACTOR, EVENTS, KIND, TEAM, TMPL, isoDay, whenLabel, type AuditEvent } from "./data";

/** One filter state for all three UIs, so switching variants keeps what you picked. */
export interface Filters {
  teams: string[];
  people: string[];
  kinds: string[];
  templates: string[];
  from: string | null;
  to: string | null;
  text: string;
}

export const EMPTY: Filters = { teams: [], people: [], kinds: [], templates: [], from: null, to: null, text: "" };

export type FilterKey = "teams" | "people" | "kinds" | "templates" | "date" | "text";

export function matches(e: AuditEvent, f: Filters, skip?: FilterKey): boolean {
  if (skip !== "teams" && f.teams.length && !f.teams.includes(e.team)) return false;
  if (skip !== "people" && f.people.length && !f.people.includes(e.actor)) return false;
  if (skip !== "kinds" && f.kinds.length && !f.kinds.includes(e.kind)) return false;
  if (skip !== "templates" && f.templates.length && !(e.template && f.templates.includes(e.template))) return false;
  if (skip !== "date") {
    const d = isoDay(e.at);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
  }
  if (skip !== "text" && f.text.trim()) {
    const hay = `${e.details} ${ACTOR[e.actor]?.name} ${e.template ? TMPL[e.template]?.name : ""}`.toLowerCase();
    if (!hay.includes(f.text.trim().toLowerCase())) return false;
  }
  return true;
}

export const applyFilters = (f: Filters) => EVENTS.filter((e) => matches(e, f));

/** Counts for a facet, with every OTHER filter applied. */
export function facetCounts(f: Filters, key: Exclude<FilterKey, "date" | "text">, pick: (e: AuditEvent) => string | null) {
  const out: Record<string, number> = {};
  for (const e of EVENTS) {
    if (!matches(e, f, key)) continue;
    const v = pick(e);
    if (v) out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

export const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function activeCount(f: Filters): number {
  return f.teams.length + f.people.length + f.kinds.length + f.templates.length + (f.from || f.to ? 1 : 0) + (f.text.trim() ? 1 : 0);
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function toCsv(rows: AuditEvent[]): string {
  const head = ["When (demo clock, UTC)", "Who", "Team", "Template", "Version", "Action", "Details"];
  const body = rows.map((e) =>
    [whenLabel(e.at), ACTOR[e.actor]?.name ?? e.actor, TEAM[e.team] ?? e.team, e.template ? TMPL[e.template]!.name : "", e.version ? `v${e.version}` : "", KIND[e.kind].label, e.details]
      .map(q)
      .join(","),
  );
  return [head.map(q).join(","), ...body].join("\n");
}

export function downloadCsv(rows: AuditEvent[], name: string) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
