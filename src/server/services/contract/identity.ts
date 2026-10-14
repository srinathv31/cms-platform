import { describe, expect, it } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ContractHarness } from "./harness";

// Who is asking and where they may go, as every implementation must answer it (IdentityService in
// src/server/services/identity.ts), from the seed: Maya an Author on Coral Offers, Priya an Author there and a
// Viewer on Deposits, Alex Coral's Team Admin, Riley the Platform Admin, Taylor the Auditor, Morgan on no team.
// A team's id is never its slug (decision 0053), so a case that looks one up by the other fails.

const ALLOWED = { ok: true };

export function identityContract(h: ContractHarness) {
  describe("identity.viewer", () => {
    it("names the person a credential names, with their memberships by team id and slug", async () => {
      const priya = await h
        .services()
        .identity.viewer({ kind: "in_process", userId: "priya" });
      expect(priya).toMatchObject({ userId: "priya", platformRole: null });
      expect(
        priya!.memberships
          .map((m) => [m.teamId, m.teamSlug, m.status, [...m.roles].sort()])
          .sort(),
      ).toEqual([
        ["t_coral", "coral-offers", "active", ["author"]],
        ["t_deposits", "deposits", "active", ["viewer"]],
      ]);
    });

    it("is null for a credential naming nobody", async () => {
      expect(
        await h
          .services()
          .identity.viewer({ kind: "in_process", userId: "nobody" }),
      ).toBeNull();
    });
  });

  describe("identity.space", () => {
    it("resolves a slug to its team's id, with what the viewer may do there", async () => {
      const space = await h
        .services()
        .identity.space(await h.as("alex"), { slug: "coral-offers" });
      expect(space).toEqual({
        ok: true,
        space: {
          teamId: "t_coral",
          slug: "coral-offers",
          name: "Coral Offers",
          kind: "team",
          icon: expect.any(String),
          can: {
            viewAudit: ALLOWED,
            manageMembers: ALLOWED,
            managePlatform: expect.objectContaining({ ok: false }),
          },
        },
      });
    });

    it("refuses an unknown slug and a team the viewer can't see alike", async () => {
      const maya = await h.as("maya");
      for (const slug of ["nope", "deposits", "t_coral", "all"]) {
        const space = await h.services().identity.space(maya, { slug });
        expect(space, slug).toMatchObject({
          ok: false,
          status: 404,
          code: REQUEST_REFUSALS.spaceUnavailable.code,
        });
      }
      const morgan = await h.as("morgan");
      expect(
        await h.services().identity.space(morgan, { slug: "coral-offers" }),
      ).toMatchObject({ ok: false, status: 404 });
    });

    it("opens All teams to the platform roles only", async () => {
      for (const userId of ["riley", "taylor"]) {
        const space = await h
          .services()
          .identity.space(await h.as(userId), { slug: "all" });
        expect(space, userId).toMatchObject({
          ok: true,
          space: { teamId: null, slug: "all", kind: "all", icon: null },
        });
      }
      const riley = await h
        .services()
        .identity.space(await h.as("riley"), { slug: "all" });
      expect(riley.ok && riley.space.can).toEqual({
        viewAudit: ALLOWED,
        manageMembers: expect.objectContaining({ ok: false }),
        managePlatform: ALLOWED,
      });
      // A platform role enters every team too.
      expect(
        await h
          .services()
          .identity.space(await h.as("taylor"), { slug: "card-statements" }),
      ).toMatchObject({ ok: true, space: { teamId: "t_cards" } });
    });
  });

  describe("identity.shell", () => {
    it("lists a member's teams by name, each by id and slug", async () => {
      const shell = await h.services().identity.shell(await h.as("priya"));
      if (!shell.ok) throw new Error(shell.code);
      expect(shell.spaces.map((s) => [s.teamId, s.slug, s.kind])).toEqual([
        ["t_coral", "coral-offers", "team"],
        ["t_deposits", "deposits", "team"],
      ]);
      expect(shell.can.requestAccess).toEqual(ALLOWED);
    });

    it("puts All teams first for the platform roles, then every team; the Auditor may not ask for access", async () => {
      const shell = await h.services().identity.shell(await h.as("taylor"));
      if (!shell.ok) throw new Error(shell.code);
      expect(shell.spaces.map((s) => s.teamId)).toEqual([
        null,
        "t_cards",
        "t_coral",
        "t_deposits",
      ]);
      expect(shell.can.requestAccess).toMatchObject({ ok: false });
    });

    it("is empty for someone on no team", async () => {
      expect(
        await h.services().identity.shell(await h.as("morgan")),
      ).toMatchObject({ ok: true, spaces: [] });
    });
  });
}
