import { libraryOf } from "@/domain/library";
import {
  paletteSearch,
  PALETTE_RECENT_SCAN,
  recentTemplateIds,
} from "@/domain/palette-search";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { refusal } from "../results";
import type { TemplateService } from "../templates";
import type { FakeDeps } from "./index";
import { businessZone } from "./settings";
import type { FakeState } from "./state";

// The Library and the ⌘K palette in memory: what services/local/library.ts reads with SQL, read from the fake's
// arrays, decided by the same domain functions (`libraryOf`, `paletteSearch`). A contract case reads them to see
// what a command did to the templates (a sunset moves a template up the Library and into Recent).

/** A space's templates (a team by id; null, every team) with the team, its content type's channels and the owner. */
function spaceTemplates(state: FakeState, teamId: string | null) {
  return state.templates
    .filter((t) => teamId === null || t.teamId === teamId)
    .map((t) => {
      const team = state.teams.find((x) => x.id === t.teamId)!;
      const type = state.contentTypes.find((c) => c.id === t.contentTypeId)!;
      const owner = state.users.find((u) => u.id === t.createdBy)!;
      return {
        id: t.id,
        teamId: t.teamId,
        teamSlug: team.slug,
        teamName: team.name,
        allowedChannels: type.allowedChannels,
        owner: {
          id: owner.id,
          name: owner.name,
          initials: owner.initials,
          hue: owner.avatarHue,
        },
      };
    });
}

export function fakeLibrary({
  store,
  clock,
}: FakeDeps): Pick<TemplateService, "library" | "palette"> {
  return {
    async library(ctx, { teamId }) {
      const now = await clock();
      const { state } = store;
      const library = libraryOf({
        viewer: ctx.viewer,
        teamId,
        templates: spaceTemplates(state, teamId),
        versions: state.versions,
        zone: businessZone(state),
        now,
      });
      if (!library) return refusal(404, REQUEST_REFUSALS.spaceUnavailable);
      return { ok: true, asOf: now.toISOString(), ...library };
    },

    async palette(ctx, { teamId, q, templateId }) {
      const { state } = store;
      // The viewer's newest audit rows that name a template; the array's order is the write order (`rowid`'s
      // stand-in), so rows at one instant: the later write first.
      const events = state.auditEvents
        .map((e, written) => ({ e, written }))
        .filter(({ e }) => e.actorId === ctx.viewer.userId && e.templateId)
        .sort(
          (a, b) =>
            b.e.at.getTime() - a.e.at.getTime() || b.written - a.written,
        )
        .slice(0, PALETTE_RECENT_SCAN)
        .map(({ e }) => e);
      const palette = paletteSearch({
        viewer: ctx.viewer,
        teamId,
        templates: spaceTemplates(state, teamId),
        versions: state.versions,
        recentIds: recentTemplateIds(events),
        q,
        currentId: templateId,
      });
      if (!palette) return refusal(404, REQUEST_REFUSALS.spaceUnavailable);
      return { ok: true, ...palette };
    },
  };
}
