import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { formatAgo } from "@/domain/dates";
import type { Person } from "@/domain/review-types";
import type { ChannelFamily, VersionState } from "@/domain/types";
import { requireRequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type { TemplateLibrary } from "@/server/services/templates";
import { requireSpace } from "./spaces";

// The Library's read model: a space's templates, newest edit first, with whether the viewer may create there.
// The backend decides it (`services().templates.library`: which templates the viewer sees, the version each is
// shown by, the status, the sunset, the order, `can.create`); this words the rows (how long ago, from the read's
// `asOf`). It decides nothing.

// The version a template is shown by, picked everywhere in the CMS (the workspace header, the review screen's
// threads), is decided in the domain. Re-exported here until those read models import it from there.
export { pickLatest } from "@/domain/library";

export interface LibraryRow {
  id: string;
  /** The latest version's name (`pickLatest`): the open draft's, otherwise the newest version's. */
  name: string;
  /**
   * Document or Alert: the template's kind, from its content type's channels (`contentTypeFamily`). It is
   * fixed for the template's life, so it is never read from a version.
   */
  family: ChannelFamily;
  teamSlug: string;
  teamName: string;
  /** State of the template's latest version (a draft counts as latest). */
  status: VersionState;
  /** YYYY-MM-DD: the latest version's sunset day in the business time zone, for the badge. */
  sunsetDay: string | null;
  /** The sunset has passed (`sunsetPassed`): the badge says "Sunset passed". False when none is set. */
  sunsetPassed: boolean;
  /** Number of the Active version, if any. */
  activeNumber: number | null;
  /** How long ago the newest change to any of its versions was, from the read's `asOf`; "—" for none. */
  lastEdited: string;
  owner: Omit<Person, "id">;
}

export interface LibraryData {
  rows: LibraryRow[];
  /** The viewer may create a template here. Never in the cross-team space. */
  canCreate: boolean;
  /** ISO: the backend's instant the rows were read at; the rows' ages count from it. */
  asOf: string;
}

/** Templates in a space ("all" = every team), newest edit first. Not found when the viewer can't enter the space. */
export const getLibrary = cache(
  async (spaceSlug: string): Promise<LibraryData> => {
    const ctx = await requireRequestContext();
    const space = await requireSpace(spaceSlug);
    const library = await services().templates.library(ctx, {
      teamId: space.teamId,
    });
    if (!library.ok) notFound();
    return libraryData(library);
  },
);

/** The Library from the service's facts: each row with its age worded. */
export function libraryData(library: TemplateLibrary): LibraryData {
  return {
    rows: library.rows.map((row): LibraryRow => ({
      id: row.id,
      name: row.name,
      family: row.family,
      teamSlug: row.teamSlug,
      teamName: row.teamName,
      status: row.status,
      sunsetDay: row.sunsetDay,
      sunsetPassed: row.sunsetPassed,
      activeNumber: row.activeNumber,
      lastEdited: row.lastEditedAt
        ? formatAgo(row.lastEditedAt, library.asOf)
        : "—",
      owner: {
        name: row.owner.name,
        initials: row.owner.initials,
        hue: row.owner.hue,
      },
    })),
    canCreate: library.can.create.ok,
    asOf: library.asOf,
  };
}
