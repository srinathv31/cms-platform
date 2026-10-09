import type { PaletteTemplateRow } from "./import-types";
import { statusLabel } from "./status";

// The ⌘K palette's search: one way to match what was typed, for everything the palette lists. The
// server lists templates with `paletteTemplates` (GET /api/palette/{space}), so no page carries the
// catalog. The browser ranks the palette's own rows (pages, settings, teams, actions) with
// `rankByQuery`, and narrows the last answer with it while the next one is on its way.

/** The longest search the palette sends. Its field stops there; the route refuses a longer one. */
export const PALETTE_QUERY_MAX = 200;
/** Templates shown in Recent, at rest. */
export const PALETTE_RECENT_LIMIT = 5;
/** Templates listed at rest after Recent: the first page by name. Typing finds the rest. */
export const PALETTE_REST_LIMIT = 8;
/** Templates a search answers with, best first. */
export const PALETTE_MATCH_LIMIT = 20;

/** The words of a search, lowercased. */
export function paletteTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** A search in the one form the server answers and the palette keys its answers by: "Cash  BACK " → "cash back". */
export function normalizePaletteQuery(query: string): string {
  return paletteTokens(query).join(" ");
}

/**
 * Null = no match. Every word of the query must appear in the item's text (its label first, then the
 * extra words); a lower score is a better match: label starts with it, a word of it does, it contains it.
 */
function score(tokens: string[], label: string, extra = ""): number | null {
  if (tokens.length === 0) return 0;
  const name = label.toLowerCase();
  const all = `${name} ${extra.toLowerCase()}`;
  let total = 0;
  for (const token of tokens) {
    if (!all.includes(token)) return null;
    if (name.startsWith(token)) total += 0;
    else if (name.includes(` ${token}`)) total += 1;
    else if (name.includes(token)) total += 2;
    else total += 3;
  }
  return total;
}

/**
 * The items that match every word, best first; equal matches keep their order. With no words, every
 * item, in order. `text` gives an item's label and the extra words it is also found by.
 */
export function rankByQuery<T>(items: readonly T[], tokens: string[], text: (item: T) => [string, string?]): T[] {
  if (tokens.length === 0) return [...items];
  return items
    .map((item, index) => ({ item, index, s: score(tokens, ...text(item)) }))
    .filter((entry): entry is { item: T; index: number; s: number } => entry.s !== null)
    .sort((a, b) => a.s - b.s || a.index - b.index)
    .map((entry) => entry.item);
}

/** A template is found by its name first, then by its team, its id and its status ("draft", "in review"). */
export function templateSearchText(t: PaletteTemplateRow): [string, string] {
  return [t.name, `${t.teamName} ${t.id} ${statusLabel(t.status)}`];
}

export interface PaletteTemplatesInput {
  /** Every template the viewer can see in the space, in name order. */
  templates: readonly PaletteTemplateRow[];
  /** What was typed. Empty = at rest. */
  query: string;
  /** Templates the viewer acted on, newest first (any space; those not in `templates` are skipped). */
  recentIds: readonly string[];
  /** The template whose pages the viewer is on, if any. */
  currentId: string | null;
}

/**
 * The templates the palette lists for one space and one search.
 *
 * At rest, Recent is the viewer's five most recent templates without the one they are on (This template
 * covers it), and Templates is the first page by name without those. While searching there is no
 * Recent: Templates is every template that matches every word, best first, the recent ones winning
 * ties, at most `PALETTE_MATCH_LIMIT`.
 */
export function paletteTemplates({ templates, query, recentIds, currentId }: PaletteTemplatesInput): {
  recent: PaletteTemplateRow[];
  templates: PaletteTemplateRow[];
} {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const latest = recentIds.filter((id) => byId.has(id)).slice(0, PALETTE_RECENT_LIMIT);
  const tokens = paletteTokens(query);

  if (tokens.length > 0) {
    const rank = new Map(latest.map((id, i) => [id, i]));
    const recentFirst = [...templates].sort((a, b) => (rank.get(a.id) ?? latest.length) - (rank.get(b.id) ?? latest.length));
    return { recent: [], templates: rankByQuery(recentFirst, tokens, templateSearchText).slice(0, PALETTE_MATCH_LIMIT) };
  }

  const recent = latest.filter((id) => id !== currentId).map((id) => byId.get(id)!);
  const inRecent = new Set(recent.map((t) => t.id));
  return { recent, templates: templates.filter((t) => !inRecent.has(t.id)).slice(0, PALETTE_REST_LIMIT) };
}
