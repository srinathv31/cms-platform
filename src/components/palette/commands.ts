import type {
  PaletteGroup,
  PaletteGroupKey,
  PaletteItem,
  PalettePageKey,
  PaletteResults,
  PaletteTemplateRow,
  TemplateTabKey,
} from "@/domain/import-types";
import { normalizePaletteQuery, paletteTokens, rankByQuery, templateSearchText } from "@/domain/palette";
import type { SpaceNav } from "@/server/queries/spaces";
import { visibleGroups } from "@/components/settings/sections";

// The ⌘K palette's items, as pure data: what the viewer may open from here, in the contract's group
// order. The component renders it; the tests pin it. Recent, Actions, This template and Templates come
// from the server's answer (GET /api/palette/{space}, `usePaletteResults`); pages, settings and teams
// are the palette's own rows, matched here with the rule the server searches templates by
// (`rankByQuery` in src/domain/palette.ts). Everything a later track adds (a page, a settings section,
// a template tab) is one row in a list below, or comes in through the lists it already reads
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

export interface PaletteInput {
  /** The space the viewer is in. */
  space: Pick<SpaceNav, "slug" | "kind" | "showAudit" | "settings">;
  /** Every space the viewer can switch to (the current one included). */
  spaces: Pick<SpaceNav, "slug" | "name">[];
  /**
   * The server's answer for this space and the template at `pathname`: to what was typed, or to an
   * earlier search while the next answer is on its way, which is narrowed here to what was typed. Null
   * until one has come: the groups it decides (Recent, Actions, This template, Templates) wait.
   */
  results: PaletteResults | null;
  pathname: string;
  /** What the viewer typed. Empty or omitted = the resting list. */
  query?: string;
}

/** The template whose pages the viewer is on: /{space}/templates/{id}[/tab] or /{space}/review/{id}[/…]. */
export function templateIdFromPath(pathname: string): string | null {
  const match = /^\/[^/]+\/(?:templates|review)\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

export function paletteGroups({ space, spaces, results, pathname, query = "" }: PaletteInput): PaletteGroup[] {
  const tokens = paletteTokens(query);
  const base = `/${space.slug}`;
  // An answer for another space is not trusted.
  const answer = results?.space === space.slug ? results : null;
  const exact = answer !== null && answer.query === normalizePaletteQuery(query);

  const toItem = (t: PaletteTemplateRow): PaletteItem => ({
    kind: "template",
    id: t.id,
    name: t.name,
    teamName: t.teamName,
    status: t.status,
    href: `${base}/templates/${t.id}`,
  });

  // Recent: only at rest (a search has none: those templates rank first in Templates). The server
  // leaves out the template being viewed, which This template covers, and doesn't repeat Recent in
  // Templates.
  const recent = exact ? answer.recent.map(toItem) : [];

  const actions: PaletteItem[] = answer?.canCreate
    ? [
        { kind: "action", key: "new_template", label: "New template", href: `${base}/library` },
        { kind: "action", key: "import", label: "Import a file", href: `${base}/library` },
      ]
    : [];

  const currentId = templateIdFromPath(pathname);
  const thisTemplate: PaletteItem[] =
    currentId && answer?.current
      ? PALETTE_TEMPLATE_TABS.map((tab) => ({
          kind: "template_tab" as const,
          key: tab.key,
          label: tab.label,
          href: tab.segment ? `${base}/templates/${currentId}/${tab.segment}` : `${base}/templates/${currentId}`,
        }))
      : [];

  // The answer to what was typed comes ranked. An earlier one is narrowed to what was typed now, by the
  // rule the server ranks with, its recent templates first as the server would rank them.
  const templateRows = !answer
    ? []
    : exact
      ? answer.templates
      : rankByQuery([...answer.recent, ...answer.templates], tokens, templateSearchText);

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
      case "template":
        return [item.name];
    }
  };

  const groups: { key: PaletteGroupKey; items: PaletteItem[] }[] = [
    { key: "recent", items: recent },
    { key: "actions", items: rankByQuery(actions, tokens, labelText) },
    { key: "this_template", items: rankByQuery(thisTemplate, tokens, labelText) },
    { key: "templates", items: templateRows.map(toItem) },
    { key: "pages", items: rankByQuery(pages, tokens, labelText) },
    { key: "settings", items: rankByQuery(settings, tokens, labelText) },
    { key: "teams", items: rankByQuery(teams, tokens, labelText) },
  ];
  return groups.filter((g) => g.items.length > 0).map((g) => ({ ...g, heading: GROUP_HEADINGS[g.key] }));
}
