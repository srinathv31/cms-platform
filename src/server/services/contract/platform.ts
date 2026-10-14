import { describe, expect, it } from "vitest";
import { sunsetInstant } from "@/domain/business-zone";
import type { ApproverRule, RequiredSection } from "@/domain/types";
import type { StoredNotification } from "../notifications";
import { told } from "./access";
import type { ContractHarness } from "./harness";

// Platform settings, as every implementation must show them (PlatformService in src/server/services/platform.ts),
// from the seed: Riley is the Platform Admin; the Disclosure content type (`ct_disclosure`) has three required
// sections, PDF, Web and Email, and one stage, "Team approver" (`stage_disclosure_0`: the team's approvers); the
// Alert type (`ct_alert`) has Push and SMS. Two Coral Offers versions wait on the Team approver stage (Cash Back v3
// round 2 and Card Used Abroad v1); Balance Transfer v1 has a sunset set. The business time zone is Eastern.
//
// Each case sets the backend's clock and compares what the reads show before and after. A setting saved as it
// already is answers `changed: false`: the cases use it to see what a command stored, since the settings' own
// reads run on the local implementation only (./settings.ts). The rows each command writes to the audit log are
// ./audit.ts's; a chain edited under versions in review is ./approval-chain.ts's. A refusal is checked by its code.

const CT = "ct_disclosure";
const ALERT = "ct_alert";
const TEAM_STAGE = "stage_disclosure_0";
const TEAM_RULE: ApproverRule = { kind: "team_role", role: "approver" };
const SEEDED_SECTIONS: RequiredSection[] = [
  { key: "offer_details", title: "Offer details" },
  { key: "rates_and_fees", title: "Rates and fees" },
  { key: "legal_notices", title: "Legal notices" },
];
const EASTERN = "America/New_York";
const PACIFIC = "America/Los_Angeles";

export function platformContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);
  const platform = () => h.services().platform;

  async function bell(userId: string): Promise<StoredNotification[]> {
    const list = await h
      .services()
      .notifications.list(await h.as(userId), { limit: 100 });
    if (!list.ok) throw new Error(list.code);
    return list.items;
  }

  /** Balance Transfer v1, as the Versions read shows it. */
  async function balanceV1() {
    const history = await h.services().versions.history(await h.as("jordan"), {
      templateId: h.templates["balance-transfer"]!,
    });
    if (!history.ok) throw new Error(history.code);
    return history.versions.find((v) => v.number === 1 && v.head)!;
  }

  describe("only a Platform Admin", () => {
    it("refuses everyone else every platform command, and writes nothing", async () => {
      h.setClock(minute(1));
      for (const id of ["alex", "maya", "dana", "naomi", "taylor"]) {
        const ctx = await h.as(id);
        const answers = [
          await platform().createTeam(ctx, {
            name: "Home Loans",
            description: "",
            icon: "home",
            adminUserId: "alex",
          }),
          await platform().updateContentType(ctx, {
            contentTypeId: CT,
            requiredSections: [{ key: "", title: "Anything" }],
          }),
          await platform().setChannelRule(ctx, {
            contentTypeId: CT,
            channel: "email",
            allowed: false,
          }),
          await platform().saveApprovalChain(ctx, {
            contentTypeId: CT,
            stages: [{ id: TEAM_STAGE, name: "Renamed", rule: TEAM_RULE }],
          }),
          await platform().setBusinessZone(ctx, { zone: PACIFIC }),
        ];
        expect(answers.map((a) => (a.ok ? "ok" : a.code))).toEqual([
          "generic",
          "generic",
          "generic",
          "generic",
          "generic",
        ]);
      }
      // Nothing was written: Riley's own saves still change every one of them.
      const riley = await h.as("riley");
      expect(
        await platform().setBusinessZone(riley, { zone: PACIFIC }),
      ).toEqual({ ok: true, changed: true });
      expect(
        await platform().setChannelRule(riley, {
          contentTypeId: CT,
          channel: "email",
          allowed: false,
        }),
      ).toEqual({ ok: true, changed: true });
    });
  });

  describe("platform.createTeam", () => {
    it("creates Home Loans with Alex as its first Team Admin, by an id that isn't its slug, and tells Alex", async () => {
      const before = await bell("alex");
      h.setClock(minute(1));
      const riley = await h.as("riley");
      const created = await platform().createTeam(riley, {
        name: "  Home   Loans ",
        description: "Mortgages and home equity.",
        icon: "home",
        adminUserId: "alex",
      });
      expect(created).toEqual({
        ok: true,
        teamId: expect.any(String),
        slug: "home-loans",
      });
      if (!created.ok) return;
      // Opaque, never the slug (decision 0053).
      expect(created.teamId).not.toBe(created.slug);
      expect(["t_coral", "t_deposits", "t_cards"]).not.toContain(
        created.teamId,
      );

      // The URL's slug resolves to the new id.
      const space = await h
        .services()
        .identity.space(await h.as("riley"), { slug: "home-loans" });
      expect(space).toMatchObject({
        ok: true,
        space: {
          teamId: created.teamId,
          slug: "home-loans",
          name: "Home Loans",
        },
      });
      const alex = await h.as("alex");
      expect(
        alex.viewer.memberships.find((m) => m.teamId === created.teamId),
      ).toMatchObject({
        teamSlug: "home-loans",
        teamName: "Home Loans",
        status: "active",
        roles: ["team_admin"],
      });
      expect(told(before, await bell("alex"))).toEqual([
        {
          id: expect.any(String),
          kind: "team_admin_appointed",
          facts: { actorName: riley.viewer.name, teamName: "Home Loans" },
          link: {
            to: "settings",
            teamId: created.teamId,
            section: "members",
          },
          body: null,
          createdAt: minute(1).toISOString(),
          readAt: null,
        },
      ]);
    });

    it("refuses with the codes the interface lists, in its order, and creates nothing", async () => {
      h.setClock(minute(1));
      const create = async (
        input: Partial<
          Parameters<ReturnType<typeof platform>["createTeam"]>[1]
        >,
      ) => {
        const result = await platform().createTeam(await h.as("riley"), {
          name: "Home Loans",
          description: "",
          icon: "home",
          adminUserId: "alex",
          ...input,
        });
        return result.ok ? "ok" : result.code;
      };
      expect(await create({ adminUserId: "nobody" })).toBe("pick_person");
      expect(await create({ adminUserId: "taylor", name: "" })).toBe(
        "auditor_cant_be_admin",
      );
      expect(await create({ name: "  " })).toBe("team_name_missing");
      expect(await create({ name: "x".repeat(61) })).toBe("team_name_too_long");
      expect(await create({ description: "x".repeat(201) })).toBe(
        "team_description_too_long",
      );
      expect(await create({ icon: "rocket" })).toBe("team_icon_missing");
      expect(await create({ name: "Settings" })).toBe("team_name_reserved");
      expect(await create({ name: "coral offers" })).toBe("team_name_taken");
      expect(
        await h
          .services()
          .identity.space(await h.as("riley"), { slug: "home-loans" }),
      ).toMatchObject({ ok: false, code: "space_unavailable" });
      // Created once; the same name again is taken.
      expect(await create({})).toBe("ok");
      expect(await create({})).toBe("team_name_taken");
    });
  });

  describe("platform.updateContentType", () => {
    it("renames, adds and removes required sections, keyed from their titles; the same sections again change nothing", async () => {
      h.setClock(minute(1));
      const riley = await h.as("riley");
      const next = [
        { key: "offer_details", title: "Offer summary" },
        { key: "legal_notices", title: "Legal notices" },
        { key: "", title: "Privacy" },
      ];
      expect(
        await platform().updateContentType(riley, {
          contentTypeId: CT,
          requiredSections: next,
        }),
      ).toEqual({ ok: true, changed: true });
      // The new section's key is its title's: saving it with that key is the same list.
      expect(
        await platform().updateContentType(riley, {
          contentTypeId: CT,
          requiredSections: [
            next[0]!,
            next[1]!,
            { key: "privacy", title: "Privacy" },
          ],
        }),
      ).toEqual({ ok: true, changed: false });
      expect(
        await platform().updateContentType(riley, {
          contentTypeId: CT,
          requiredSections: SEEDED_SECTIONS,
        }),
      ).toEqual({ ok: true, changed: true });
    });

    it("refuses a content type that's gone, sections on a message type, no sections and a duplicate title", async () => {
      h.setClock(minute(1));
      const riley = await h.as("riley");
      const update = async (
        contentTypeId: string,
        requiredSections: RequiredSection[],
      ) => {
        const result = await platform().updateContentType(riley, {
          contentTypeId,
          requiredSections,
        });
        return result.ok ? "ok" : result.code;
      };
      expect(await update("ct_nowhere", [{ key: "", title: "A" }])).toBe(
        "content_type_gone",
      );
      expect(await update(ALERT, [{ key: "", title: "A" }])).toBe(
        "sections_on_messages",
      );
      expect(await update(CT, [])).toBe("last_section");
      expect(
        await update(CT, [
          { key: "offer_details", title: "Offer details" },
          { key: "", title: "offer details" },
        ]),
      ).toBe("section_duplicate");
      expect(
        await platform().updateContentType(riley, {
          contentTypeId: CT,
          requiredSections: SEEDED_SECTIONS,
        }),
      ).toEqual({ ok: true, changed: false });
    });
  });

  describe("platform.setChannelRule", () => {
    it("turns Email off and on again; the channel as it is changes nothing; the last channel stays on", async () => {
      h.setClock(minute(1));
      const riley = await h.as("riley");
      const set = (channel: "pdf" | "web" | "email", allowed: boolean) =>
        platform().setChannelRule(riley, {
          contentTypeId: CT,
          channel,
          allowed,
        });
      expect(await set("email", true)).toEqual({ ok: true, changed: false });
      expect(await set("email", false)).toEqual({ ok: true, changed: true });
      expect(await set("email", false)).toEqual({ ok: true, changed: false });
      expect(await set("pdf", false)).toEqual({ ok: true, changed: true });
      expect(await set("web", false)).toMatchObject({
        ok: false,
        code: "last_channel",
      });
      expect(await set("email", true)).toEqual({ ok: true, changed: true });
      expect(await set("pdf", true)).toEqual({ ok: true, changed: true });
      expect(await set("web", true)).toEqual({ ok: true, changed: false });
    });

    it("refuses a channel of the other family, either way, and a content type that's gone", async () => {
      h.setClock(minute(1));
      const riley = await h.as("riley");
      expect(
        await platform().setChannelRule(riley, {
          contentTypeId: CT,
          channel: "push",
          allowed: true,
        }),
      ).toMatchObject({ ok: false, code: "channel_family" });
      expect(
        await platform().setChannelRule(riley, {
          contentTypeId: ALERT,
          channel: "email",
          allowed: true,
        }),
      ).toMatchObject({ ok: false, code: "channel_family" });
      expect(
        await platform().setChannelRule(riley, {
          contentTypeId: "ct_nowhere",
          channel: "email",
          allowed: false,
        }),
      ).toMatchObject({ ok: false, code: "content_type_gone" });
      expect(
        await platform().setChannelRule(riley, {
          contentTypeId: ALERT,
          channel: "sms",
          allowed: true,
        }),
      ).toEqual({ ok: true, changed: false });
    });
  });

  describe("platform.saveApprovalChain", () => {
    const save = async (
      stages: { id?: string; name: string; rule: ApproverRule }[],
      by = "riley",
    ) => {
      const result = await platform().saveApprovalChain(await h.as(by), {
        contentTypeId: CT,
        stages,
      });
      return result.ok
        ? result.changed
          ? "changed"
          : "unchanged"
        : result.code;
    };
    const user = (userId: string): ApproverRule => ({ kind: "user", userId });

    it("saves a new stage and a renamed one; the chain as it is changes nothing", async () => {
      h.setClock(minute(1));
      expect(
        await save([
          { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
        ]),
      ).toBe("unchanged");
      expect(
        await save([{ id: TEAM_STAGE, name: "Team review", rule: TEAM_RULE }]),
      ).toBe("changed");
      expect(
        await save([{ id: TEAM_STAGE, name: "Team review", rule: TEAM_RULE }]),
      ).toBe("unchanged");
      expect(
        await save([
          { id: TEAM_STAGE, name: "Team review", rule: TEAM_RULE },
          { name: "Legal reviewer", rule: user("dana") },
        ]),
      ).toBe("changed");
    });

    it("refuses validateChain's problems by their codes, in stage order, and writes nothing", async () => {
      h.setClock(minute(1));
      const team = { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE };
      expect(await save([])).toBe("last_stage");
      expect(await save([{ ...team, id: "stage_nowhere" }])).toBe(
        "stage_changed",
      );
      expect(await save([{ ...team, name: " " }])).toBe("stage_name_missing");
      expect(await save([{ ...team, name: "x".repeat(41) }])).toBe(
        "stage_name_too_long",
      );
      expect(
        await save([team, { name: "team approver", rule: user("dana") }]),
      ).toBe("stage_duplicate");
      expect(
        await save([{ ...team, rule: { kind: "team_role", role: "author" } }]),
      ).toBe("role_cant_approve");
      expect(await save([team, { name: "Legal", rule: user("nobody") }])).toBe(
        "pick_person",
      );
      expect(await save([team, { name: "Legal", rule: user("riley") }])).toBe(
        "names_yourself",
      );
      expect(await save([team, { name: "Legal", rule: user("taylor") }])).toBe(
        "auditor_cant_approve",
      );
      expect(await save([team, { name: "Legal", rule: user("morgan") }])).toBe(
        "no_active_access",
      );
      expect(
        await save([
          team,
          { name: "Legal", rule: user("dana") },
          { name: "Second legal", rule: user("dana") },
        ]),
      ).toBe("person_on_two_stages");
      // Replacing the stage two versions wait on removes it from under them.
      expect(await save([{ name: "Another stage", rule: TEAM_RULE }])).toBe(
        "stage_in_use",
      );
      expect(await save([team])).toBe("unchanged");
    });

    it("tells whoever a waiting stage now names about the versions already waiting on it, in their own space", async () => {
      const before = await bell("naomi");
      h.setClock(minute(1));
      const riley = await h.as("riley");
      expect(
        await save([
          { id: TEAM_STAGE, name: "Team approver", rule: user("naomi") },
        ]),
      ).toBe("changed");
      // The Disclosure waiting on the stage: Cash Back v3, round 2 (Card Used Abroad is an Alert, another chain).
      expect(told(before, await bell("naomi"))).toEqual([
        {
          id: expect.any(String),
          kind: "review_requested",
          facts: {
            actorName: riley.viewer.name,
            templateName: expect.any(String),
            number: 3,
            round: 2,
            stage: "Team approver",
          },
          // Naomi isn't on Coral Offers: the link opens in her own team (decision 0055).
          link: {
            to: "review",
            teamId: "t_deposits",
            templateId: h.templates["cash-back"]!,
            versionNumber: 3,
            round: 2,
          },
          body: null,
          createdAt: minute(1).toISOString(),
          readAt: null,
        },
      ]);

      // Back to the team's approvers: Jordan is asked again, and nobody is told twice by a save that changes nothing.
      const jordan = await bell("jordan");
      h.setClock(minute(2));
      expect(
        await save([
          { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
        ]),
      ).toBe("changed");
      expect(
        told(jordan, await bell("jordan")).map((n) => [n.kind, n.facts.number]),
      ).toEqual([["review_requested", 3]]);
      const naomi = await bell("naomi");
      expect(
        await save([
          { id: TEAM_STAGE, name: "Team approver", rule: TEAM_RULE },
        ]),
      ).toBe("unchanged");
      expect(await bell("naomi")).toEqual(naomi);
    });
  });

  describe("platform.setBusinessZone", () => {
    it("changes the zone and moves no sunset already set; the zone it has changes nothing", async () => {
      const sunset = await balanceV1();
      expect(sunset.sunsetAt).not.toBeNull();
      h.setClock(minute(1));
      const riley = await h.as("riley");
      expect(
        await platform().setBusinessZone(riley, { zone: PACIFIC }),
      ).toEqual({ ok: true, changed: true });
      // Its consumers were told when it ends: the instant stays.
      expect(await balanceV1()).toMatchObject({ sunsetAt: sunset.sunsetAt });
      expect(
        await platform().setBusinessZone(riley, { zone: PACIFIC }),
      ).toEqual({ ok: true, changed: false });
      expect(
        await platform().setBusinessZone(riley, { zone: EASTERN }),
      ).toEqual({ ok: true, changed: true });
    });

    it("refuses a zone off the list", async () => {
      h.setClock(minute(1));
      expect(
        await platform().setBusinessZone(await h.as("riley"), {
          zone: "Europe/London",
        }),
      ).toMatchObject({ ok: false, code: "pick_zone" });
      expect(
        await platform().setBusinessZone(await h.as("riley"), {
          zone: EASTERN,
        }),
      ).toEqual({ ok: true, changed: false });
    });

    it("reads a sunset set afterwards in the new zone: 00:00 Pacific", async () => {
      h.setClock(minute(1));
      expect(
        await platform().setBusinessZone(await h.as("riley"), {
          zone: PACIFIC,
        }),
      ).toEqual({ ok: true, changed: true });
      h.setClock(minute(2));
      expect(
        await h.services().review.setSunset(await h.as("alex"), {
          templateId: h.templates["balance-transfer"]!,
          versionNumber: 1,
          sunsetDay: "2027-03-01",
        }),
      ).toEqual({ ok: true, changed: true });
      expect(await balanceV1()).toMatchObject({
        sunsetDay: "2027-03-01",
        sunsetAt: sunsetInstant("2027-03-01", PACIFIC).toISOString(),
      });
      // 00:00 PST.
      expect(sunsetInstant("2027-03-01", PACIFIC).toISOString()).toBe(
        "2027-03-01T08:00:00.000Z",
      );
    });
  });
}
