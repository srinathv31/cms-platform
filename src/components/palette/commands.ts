import type {
  PaletteGroup,
  PaletteGroupKey,
  PaletteContext,
  PaletteItem,
  PalettePageKey,
  TemplateTabKey,
} from "@/domain/import-types";
import type { PaletteTemplate } from "@/server/queries/palette";
import type { SpaceNav } from "@/server/queries/spaces";
import { visibleGroups } from "@/components/settings/sections";
import { statusLabel } from "@/domain/status";

// The ⌘K palette's items, as pure data: what the viewer may open from here, in the contract's group
// order. The component renders it; the tests pin it. Everything a later track adds (a page, a settings
// section, a template tab) is one row in a list below, or comes in through the lists it already reads
// (`PALETTE_PAGES`, `SETTINGS_GROUPS`).

export const GROUP_HEADINGS: Record<PaletteGroupKey, string> = {
  recent: "Recent",
  actions: "Actions",
  this_template: "This template",
  templates: "Templates",
  pages: "Pages",
  settings: "Settings",
  teams: "Teams",
};

/** The sidebar's pages, in its order. `audit` shows only where the viewer may read the audit log. */
export const PALETTE_PAGES: { key: PalettePageKey; label: string }[] = [
  { key: "library", label: "Library" },
  { key: "review", label: "Review" },
  { key: "usage", label: "Usage" },
  { key: "audit", label: "Audit" },
];

/** A template's tabs (`WORKSPACE_TABS`): `segment` is the route under the template. */
export const PALETTE_TEMPLATE_TABS: { key: TemplateTabKey; label: string; segment: string | null }[] = [
  { key: "content", label: "Content", segment: null },
  { key: "versions", label: "Versions", segment: "versions" },
  { key: "usage", label: "Usage", segment: "usage" },
  { key: "activity", label: "Activity", segment: "activity" },
];

const RECENT_LIMIT = 5;

export interface PaletteInput {
  /** The space the viewer is in. */
  space: Pick<SpaceNav, "slug" | "kind" | "showAudit" | "settings">;
  /** Every space the viewer can switch to (the current one included). */
  spaces: Pick<SpaceNav, "slug" | "name">[];
  /** Every template the viewer can see; narrowed to the space here. */
  templates: PaletteTemplate[];
  /** Null until it has loaded: the groups that need it (Recent, Actions) wait. */
  context: PaletteContext | null;
  pathname: string;
  /** What the viewer typed. Empty or omitted = the resting list. */
  query?: string;
}

/** The template whose pages the viewer is on: /{space}/templates/{id}[/tab] or /{space}/review/{id}[/…]. */
export function templateIdFromPath(pathname: string): string | null {
  const match = /^\/[^/]+\/(?:templates|review)\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

function tokensOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
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

function ranked<T>(items: T[], tokens: string[], text: (item: T) => [string, string?]): T[] {
  if (tokens.length === 0) return items;
  return items
    .map((item, index) => ({ item, index, s: score(tokens, ...text(item)) }))
    .filter((entry): entry is { item: T; index: number; s: number } => entry.s !== null)
    .sort((a, b) => a.s - b.s || a.index - b.index)
    .map((entry) => entry.item);
}

export function paletteGroups({ space, spaces, templates, context, pathname, query = "" }: PaletteInput): PaletteGroup[] {
  const tokens = tokensOf(query);
  const searching = tokens.length > 0;
  const base = `/${space.slug}`;

  const inSpace = space.kind === "all" ? templates : templates.filter((t) => t.teamSlug === space.slug);
  const toItem = (t: PaletteTemplate): PaletteItem => ({
    kind: "template",
    id: t.id,
    name: t.name,
    teamName: t.teamName,
    status: t.status,
    href: `${base}/templates/${t.id}`,
  });
  const templateText = (item: PaletteItem): [string, string] =>
    item.kind === "template" ? [item.name, `${item.teamName} ${item.id} ${statusLabel(item.status)}`] : ["", ""];

  // Recent: only at rest; while typing, those templates simply rank first in Templates. The template
  // the viewer is on is not "recent" (This template covers it), and a template shown in Recent is not
  // repeated in Templates.
  const currentId = templateIdFromPath(pathname);
  const recentIds = context?.space === space.slug ? context.recent : [];
  const recentRank = new Map(recentIds.map((id, i) => [id, i]));
  const byId = new Map(inSpace.map((t) => [t.id, t]));
  const recent: PaletteItem[] = searching
    ? []
    : recentIds
        .filter((id) => id !== currentId)
        .map((id) => byId.get(id))
        .filter((t): t is PaletteTemplate => t !== undefined)
        .slice(0, RECENT_LIMIT)
        .map(toItem);
  const shownInRecent = new Set(recent.map((item) => (item.kind === "template" ? item.id : "")));

  const actions: PaletteItem[] =
    context?.space === space.slug && context.canCreate
      ? [
          { kind: "action", key: "new_template", label: "New template", href: `${base}/library` },
          { kind: "action", key: "import", label: "Import a file", href: `${base}/library` },
        ]
      : [];

  const thisTemplate: PaletteItem[] =
    currentId && byId.has(currentId)
      ? PALETTE_TEMPLATE_TABS.map((tab) => ({
          kind: "template_tab" as const,
          key: tab.key,
          label: tab.label,
          href: tab.segment ? `${base}/templates/${currentId}/${tab.segment}` : `${base}/templates/${currentId}`,
        }))
      : [];

  const templateItems = inSpace.filter((t) => !shownInRecent.has(t.id)).map(toItem);
  if (searching) {
    // Recently touched templates win ties.
    templateItems.sort((a, b) => (recentRank.get(a.kind === "template" ? a.id : "") ?? 99) - (recentRank.get(b.kind === "template" ? b.id : "") ?? 99));
  }

  const pages: PaletteItem[] = PALETTE_PAGES.filter((p) => p.key !== "audit" || space.showAudit).map((p) => ({
    kind: "page" as const,
    key: p.key,
    label: p.label,
    href: `${base}/${p.key}`,
  }));

  const settings: PaletteItem[] = visibleGroups(space.settings).flatMap((group) =>
    group.sections.map((section) => ({
      kind: "settings" as const,
      key: section.key,
      label: section.label,
      group: group.key,
      href: `${base}/settings/${section.key}`,
    })),
  );

  const teams: PaletteItem[] = spaces
    .filter((s) => s.slug !== space.slug)
    .map((s) => ({ kind: "team" as const, slug: s.slug, name: s.name, href: `/${s.slug}/library` }));

  const labelText = (item: PaletteItem): [string, string?] => {
    switch (item.kind) {
      case "page":
      case "template_tab":
      case "action":
        return [item.label];
      case "settings":
        return [item.label, item.group];
      case "team":
        return [item.name];
      case "template":
        return templateText(item);
    }
  };

  const groups: { key: PaletteGroupKey; items: PaletteItem[] }[] = [
    { key: "recent", items: recent },
    { key: "actions", items: ranked(actions, tokens, labelText) },
    { key: "this_template", items: ranked(thisTemplate, tokens, labelText) },
    { key: "templates", items: ranked(templateItems, tokens, templateText) },
    { key: "pages", items: ranked(pages, tokens, labelText) },
    { key: "settings", items: ranked(settings, tokens, labelText) },
    { key: "teams", items: ranked(teams, tokens, labelText) },
  ];
  return groups.filter((g) => g.items.length > 0).map((g) => ({ ...g, heading: GROUP_HEADINGS[g.key] }));
}
