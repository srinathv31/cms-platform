// The Library: a space's templates, newest edit first, each shown by the version its row stands for. The
// backend (the templates service's `library`, src/server/services/templates.ts) decides it with these
// functions in the local implementation and in the fake alike; the BFF words the rows (how long ago, the
// status badge).
//
//   pickLatest    the version a template is shown by everywhere in the CMS
//   libraryOf     a space's rows and whether the viewer may create there, or null when they can't enter it

import { sunsetDay } from "./business-zone";
import { compareCodePoints } from "./golive/cursor";
import { sunsetPassed } from "./lifecycle/sunset";
import { can, canSeeSpace } from "./permissions";
import type { Person } from "./review-types";
import { compareRounds, type RoundRow } from "./rounds";
import {
  contentTypeFamily,
  type Channel,
  type ChannelFamily,
  type PermissionResult,
  type VersionState,
  type Viewer,
} from "./types";

/**
 * Latest = the open draft if there is one, otherwise the highest version number, and of its rounds the
 * latest (`compareRounds`). The CMS shows a template by this version's name (`currentName` in
 * services/local/template-name.ts is the same pick in SQL).
 */
export function pickLatest<T extends RoundRow>(list: T[]): T | undefined {
  const draft = list.find((v) => v.state === "draft");
  if (draft) return draft;
  return list.reduce<T | undefined>(
    (best, v) => (best === undefined || compareRounds(v, best) > 0 ? v : best),
    undefined,
  );
}

/** A template the Library may list, with its team and who made it. */
export interface LibraryTemplate {
  id: string;
  teamId: string;
  teamSlug: string;
  teamName: string;
  /** Its content type's channels: they fix the template's kind for life. */
  allowedChannels: readonly Channel[];
  owner: Person;
}

/** The light columns of a version (never its body). */
export interface LibraryVersion extends RoundRow {
  templateId: string;
  name: string;
  sunsetAt: Date | null;
  updatedAt: Date;
}

/** One row of the Library, as facts. */
export interface LibraryRowFacts {
  id: string;
  teamId: string;
  teamSlug: string;
  teamName: string;
  /** The latest version's name (`pickLatest`): the open draft's, otherwise the newest version's; the id for none. */
  name: string;
  /**
   * Document or Alert: the template's kind, from its content type's channels (`contentTypeFamily`). It is
   * fixed for the template's life, so it is never read from a version.
   */
  family: ChannelFamily;
  /** State of the template's latest version (a draft counts as latest). */
  status: VersionState;
  /** YYYY-MM-DD: the latest version's sunset day in the business time zone; null when none is set. */
  sunsetDay: string | null;
  /** The latest version's sunset has passed (`sunsetPassed`). False when none is set. */
  sunsetPassed: boolean;
  /** Number of the Active version, if any. */
  activeNumber: number | null;
  /** ISO: the newest change to any of its versions; null for a template with none. */
  lastEditedAt: string | null;
  owner: Person;
}

/** A space's Library: its rows and what the viewer may do there. */
export interface LibraryFacts {
  rows: LibraryRowFacts[];
  can: {
    /** New template and Import. Never in the cross-team space, which has no team to create in. */
    create: PermissionResult;
  };
}

/** Newest edit first; equal instants by name, then id, by code point (decision 0059's order). */
function newestEditFirst(a: LibraryRowFacts, b: LibraryRowFacts): number {
  return (
    compareCodePoints(b.lastEditedAt ?? "", a.lastEditedAt ?? "") ||
    compareCodePoints(a.name, b.name) ||
    compareCodePoints(a.id, b.id)
  );
}

/**
 * The Library of a space: a team by id, or every team (null) for the platform roles. `templates` holds the
 * candidates (any team); only the space's own, in teams the viewer may see, are listed. Null when the viewer
 * may not enter the space.
 */
export function libraryOf(input: {
  viewer: Viewer;
  teamId: string | null;
  templates: readonly LibraryTemplate[];
  versions: readonly LibraryVersion[];
  /** The business time zone: a sunset's day is read there. */
  zone: string;
  now: Date;
}): LibraryFacts | null {
  const { viewer, teamId, zone, now } = input;
  if (!canSeeSpace(viewer, teamId)) return null;

  const byTemplate = new Map<string, LibraryVersion[]>();
  for (const v of input.versions) {
    const list = byTemplate.get(v.templateId);
    if (list) list.push(v);
    else byTemplate.set(v.templateId, [v]);
  }

  const rows = input.templates
    .filter(
      (t) =>
        (teamId === null || t.teamId === teamId) &&
        canSeeSpace(viewer, t.teamId),
    )
    .map((t): LibraryRowFacts => {
      const list = byTemplate.get(t.id) ?? [];
      const latest = pickLatest(list);
      const active = list.find((v) => v.state === "active");
      const edited = list.reduce<Date | null>(
        (max, v) => (max === null || v.updatedAt > max ? v.updatedAt : max),
        null,
      );
      return {
        id: t.id,
        teamId: t.teamId,
        teamSlug: t.teamSlug,
        teamName: t.teamName,
        name: latest?.name ?? t.id,
        family: contentTypeFamily(t.allowedChannels),
        status: latest?.state ?? "draft",
        sunsetDay: latest?.sunsetAt ? sunsetDay(latest.sunsetAt, zone) : null,
        sunsetPassed: latest ? sunsetPassed(latest, now) : false,
        activeNumber: active?.number ?? null,
        lastEditedAt: edited?.toISOString() ?? null,
        owner: t.owner,
      };
    })
    .sort(newestEditFirst);

  return { rows, can: { create: can(viewer, "template.create", { teamId }) } };
}
