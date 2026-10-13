import { describe, expect, it } from "vitest";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type {
  DraftPatch,
  DraftSaveResponse,
  JSONContent,
} from "@/domain/types";
import type { ContractHarness, ProbeVersion } from "./harness";

// Autosave's behaviour, as every implementation must show it (DraftService in src/server/services/drafts.ts), from
// the seed: Annual Fee Waiver (Coral Offers, a Disclosure: PDF, web and email allowed) has an open draft Maya
// started, and Rate Change Heads-up (Coral Offers, an Alert: push and SMS) has one with a push title and body and an
// SMS text. Cash Back v3 is in review. Maya and Priya are authors on Coral Offers; Jordan approves there, Sam views,
// Eli is an author on Deposits, Morgan has no team, Riley is the platform admin.
//
// Each case sets the backend's clock, saves through the service, and compares the draft as stored (the probe's
// `version`) and the reads before and after. A save arrives prepared (the BFF's route prepares every document), so
// the documents here are already in stored form and come back exactly as sent. A refusal is checked by its code.
// The editing session's audit row isn't pinned: the Java API keeps one row per save (decision 0066).

const ONE = "session-one-0001";
const TWO = "session-two-0002";

/** A stored-form document: one paragraph with its block id. */
const doc = (text: string, id = "p1"): JSONContent => ({
  type: "doc",
  content: [
    { type: "paragraph", attrs: { id }, content: [{ type: "text", text }] },
  ],
});

/** A stored-form one-line channel field. */
const line = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

export function draftsContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);

  /** A template's open draft, as the Versions read lists it, and as stored. */
  async function draftOf(key: string) {
    const templateId = h.templates[key]!;
    const history = await h
      .services()
      .versions.history(await h.as("maya"), { templateId });
    if (!history.ok) throw new Error(history.code);
    const row = history.versions.find((v) => v.state === "draft");
    if (!row) throw new Error(`${key} has no open draft.`);
    return { templateId, versionId: row.id, stored: await stored(row.id) };
  }

  /** A template's version by number, as the Versions read lists it. */
  async function versionOf(key: string, number: number) {
    const history = await h
      .services()
      .versions.history(await h.as("maya"), { templateId: h.templates[key]! });
    if (!history.ok) throw new Error(history.code);
    return history.versions.find((v) => v.number === number && v.head)!;
  }

  async function stored(versionId: string): Promise<ProbeVersion> {
    const version = await h.probe.version({ versionId });
    if (!version) throw new Error(`No version ${versionId}.`);
    return version;
  }

  /** The CMS's name for the template: its open draft's. */
  async function templateName(templateId: string) {
    const history = await h
      .services()
      .versions.history(await h.as("maya"), { templateId });
    if (!history.ok) throw new Error(history.code);
    return history.template.name;
  }

  async function save(
    userId: string,
    versionId: string,
    patch: Partial<DraftPatch> & Pick<DraftPatch, "rev">,
  ): Promise<DraftSaveResponse> {
    return h.services().drafts.save(await h.as(userId), {
      versionId,
      patch: { sessionKey: ONE, ...patch },
    });
  }

  describe("drafts.save", () => {
    it("writes the fields it names at the current rev, one rev up, dated by the backend's clock, and only on the draft", async () => {
      const {
        templateId,
        versionId,
        stored: before,
      } = await draftOf("annual-fee-waiver");
      const v1 = await versionOf("annual-fee-waiver", 1);
      const v1Before = await stored(v1.id);
      h.setClock(minute(1));
      expect(
        await save("maya", versionId, {
          rev: before.rev,
          body: doc("Edited"),
          name: "Annual Fee Waiver — New Accounts",
        }),
      ).toEqual({
        ok: true,
        rev: before.rev + 1,
        savedAt: minute(1).toISOString(),
      });
      expect(await stored(versionId)).toEqual({
        ...before,
        rev: before.rev + 1,
        body: doc("Edited"),
        name: "Annual Fee Waiver — New Accounts",
      });
      // The template's name in the CMS is its draft's; the version it was started from keeps its own.
      expect(await templateName(templateId)).toBe(
        "Annual Fee Waiver — New Accounts",
      );
      expect(await stored(v1.id)).toEqual(v1Before);

      h.setClock(minute(2));
      expect(
        await save("maya", versionId, {
          rev: before.rev + 1,
          variables: [],
          channels: ["pdf", "web", "email"],
          sampleSets: [],
        }),
      ).toEqual({
        ok: true,
        rev: before.rev + 2,
        savedAt: minute(2).toISOString(),
      });
      expect(await stored(versionId)).toMatchObject({
        rev: before.rev + 2,
        body: doc("Edited"),
        variables: [],
        channels: ["pdf", "web", "email"],
        sampleSets: [],
      });
    });

    it("keeps the channel fields the patch doesn't name, and clears one with null", async () => {
      const { versionId, stored: before } = await draftOf(
        "rate-change-heads-up",
      );
      expect(before.channelFields.push?.body).toBeDefined();
      expect(before.channelFields.sms?.text).toBeDefined();

      h.setClock(minute(1));
      await save("maya", versionId, {
        rev: before.rev,
        "push.title": line("Your APR is changing"),
      });
      expect((await stored(versionId)).channelFields).toEqual({
        ...before.channelFields,
        push: {
          ...before.channelFields.push,
          title: line("Your APR is changing"),
        },
      });

      h.setClock(minute(2));
      await save("maya", versionId, {
        rev: before.rev + 1,
        "push.title": null,
      });
      const push = { ...before.channelFields.push };
      delete push.title;
      expect((await stored(versionId)).channelFields).toEqual({
        ...before.channelFields,
        push,
      });
    });

    it("adds whoever saves to the version's writers, once, in the order they first wrote", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      expect(before.writers).not.toContain("priya");
      h.setClock(minute(1));
      await save("priya", versionId, {
        rev: before.rev,
        sessionKey: TWO,
        body: doc("Priya's"),
      });
      expect((await stored(versionId)).writers).toEqual([
        ...before.writers,
        "priya",
      ]);
      h.setClock(minute(2));
      await save("maya", versionId, { rev: before.rev + 1, name: "Renamed" });
      await save("priya", versionId, {
        rev: before.rev + 2,
        sessionKey: TWO,
        body: doc("Priya's again"),
      });
      expect((await stored(versionId)).writers).toEqual([
        ...new Set([...before.writers, "maya", "priya"]),
      ]);
    });

    it("refuses a rev that isn't the current one draft_changed with the current rev, and writes nothing", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      for (const rev of [before.rev - 1, 0, before.rev + 1, 99])
        expect(
          await save("maya", versionId, { rev, body: doc("Stale") }),
        ).toMatchObject({
          ok: false,
          code: REQUEST_REFUSALS.draftChanged.code,
          rev: before.rev,
        });
      expect(await stored(versionId)).toEqual(before);
    });

    it("takes the resend of a save whose response was lost: the same session carries on from the current rev", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      const r = before.rev;
      h.setClock(minute(1));
      // It lands; the client never hears, and sends its next save with the rev it had.
      expect(
        await save("maya", versionId, {
          rev: r,
          body: doc("First try"),
          name: "Landed",
        }),
      ).toMatchObject({ ok: true, rev: r + 1 });
      h.setClock(minute(2));
      expect(
        await save("maya", versionId, { rev: r, body: doc("Second try") }),
      ).toEqual({ ok: true, rev: r + 2, savedAt: minute(2).toISOString() });
      expect(await stored(versionId)).toMatchObject({
        rev: r + 2,
        body: doc("Second try"),
        // The first save's other fields stay.
        name: "Landed",
      });
      // And the client, told the new rev, is back in step.
      expect(
        await save("maya", versionId, { rev: r + 2, body: doc("Third") }),
      ).toMatchObject({ ok: true, rev: r + 3 });
    });

    it("takes it again when several responses in a row were lost", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      for (const [i, text] of ["One", "Two", "Three"].entries())
        expect(
          await save("maya", versionId, { rev: before.rev, body: doc(text) }),
        ).toMatchObject({ ok: true, rev: before.rev + i + 1 });
      expect((await stored(versionId)).body).toEqual(doc("Three"));
    });

    it("is a conflict when another session wrote in between, even the same person's other tab", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      const r = before.rev;
      h.setClock(minute(1));
      await save("maya", versionId, { rev: r, body: doc("Tab one") }); // r+1, its answer lost
      await save("maya", versionId, {
        rev: r + 1,
        sessionKey: TWO,
        body: doc("Tab two"),
      }); // r+2
      for (const rev of [r, r + 1])
        expect(
          await save("maya", versionId, { rev, body: doc("Tab one again") }),
        ).toMatchObject({
          ok: false,
          code: REQUEST_REFUSALS.draftChanged.code,
          rev: r + 2,
        });
      expect(await stored(versionId)).toMatchObject({
        rev: r + 2,
        body: doc("Tab two"),
      });
    });

    it("is a conflict for another person who borrows the session's key", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      await save("maya", versionId, { rev: before.rev, body: doc("Maya's") });
      expect(
        await save("priya", versionId, {
          rev: before.rev,
          body: doc("Priya's"),
        }),
      ).toMatchObject({
        ok: false,
        code: REQUEST_REFUSALS.draftChanged.code,
        rev: before.rev + 1,
      });
      expect((await stored(versionId)).body).toEqual(doc("Maya's"));
    });

    it("is a conflict for a rev from the future, even from the session that wrote the current one", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      await save("maya", versionId, { rev: before.rev, body: doc("Mine") });
      expect(
        await save("maya", versionId, {
          rev: before.rev + 5,
          body: doc("Ahead"),
        }),
      ).toMatchObject({
        ok: false,
        code: REQUEST_REFUSALS.draftChanged.code,
        rev: before.rev + 1,
      });
    });

    it("still refuses a resend the draft can't take, and writes nothing", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      await save("maya", versionId, { rev: before.rev, body: doc("Mine") });
      const landed = await stored(versionId);
      // Behind, but the session owns the current rev: the channels are what refuse it.
      expect(
        await save("maya", versionId, {
          rev: before.rev,
          channels: ["pdf", "push"],
        }),
      ).toMatchObject({ ok: false, code: REFUSALS.channelNotAllowed.code });
      expect(await stored(versionId)).toEqual(landed);
    });

    it("refuses version_not_draft for a version that has left draft, before the rev, and writes nothing", async () => {
      const inReview = await versionOf("cash-back", 3);
      const sentBack = await versionOf("annual-fee-waiver", 1);
      expect([inReview.state, sentBack.state]).toEqual([
        "in_review",
        "changes_requested",
      ]);
      h.setClock(minute(1));
      for (const version of [inReview, sentBack]) {
        const before = await stored(version.id);
        expect(
          await save("maya", version.id, { rev: 0, body: doc("Too late") }),
        ).toMatchObject({
          ok: false,
          code: REQUEST_REFUSALS.versionNotDraft.code,
        });
        expect(await stored(version.id)).toEqual(before);
      }
    });

    it("refuses version_gone for no such version, and the permission refusal for anyone who may not edit the team's drafts, before the state", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      const inReview = await versionOf("cash-back", 3);
      h.setClock(minute(1));
      expect(
        await save("maya", "v_missing", { rev: 0, body: doc("x") }),
      ).toMatchObject({ ok: false, code: REQUEST_REFUSALS.versionGone.code });
      for (const userId of ["sam", "jordan", "eli", "morgan", "riley"]) {
        for (const id of [versionId, inReview.id])
          expect(
            await save(userId, id, { rev: before.rev, body: doc("x") }),
            `${userId} on ${id}`,
          ).toMatchObject({ ok: false, code: REASONS.generic.code });
      }
      expect(await stored(versionId)).toEqual(before);
    });

    it("refuses channels the content type doesn't allow, and none at all", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      expect(
        await save("maya", versionId, {
          rev: before.rev,
          channels: ["pdf", "push"],
        }),
      ).toMatchObject({ ok: false, code: REFUSALS.channelNotAllowed.code });
      expect(
        await save("maya", versionId, { rev: before.rev, channels: [] }),
      ).toMatchObject({ ok: false, code: REFUSALS.noChannels.code });
      expect(await stored(versionId)).toEqual(before);
    });

    it("refuses draft_changed, and writes nothing, when another write lands between the save's read and its write", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      h.hooks({ beforeCompareAndSet: () => "competing_write" });
      const answer = await save("maya", versionId, {
        rev: before.rev,
        body: doc("Lost the race"),
      });
      h.hooks({});
      expect(answer).toMatchObject({
        ok: false,
        code: REQUEST_REFUSALS.draftChanged.code,
      });
      // The rev it answers is the one the competing write left: past the one the save was based on.
      expect(!answer.ok && answer.rev).toBeGreaterThan(before.rev);
      expect(await stored(versionId)).toEqual(before);
      // Nothing is left half done: the next save at the current rev lands.
      expect(
        await save("maya", versionId, { rev: before.rev, body: doc("Again") }),
      ).toMatchObject({ ok: true, rev: before.rev + 1 });
    });

    it("lets exactly one of two saves at once from different sessions with the same rev land", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      const answers = await Promise.all([
        save("maya", versionId, { rev: before.rev, body: doc("Tab one") }),
        save("maya", versionId, {
          rev: before.rev,
          sessionKey: TWO,
          body: doc("Tab two"),
        }),
      ]);
      expect(answers.filter((a) => a.ok)).toEqual([
        { ok: true, rev: before.rev + 1, savedAt: minute(1).toISOString() },
      ]);
      expect(answers.find((a) => !a.ok)).toMatchObject({
        code: REQUEST_REFUSALS.draftChanged.code,
        rev: before.rev + 1,
      });
      expect((await stored(versionId)).rev).toBe(before.rev + 1);
    });

    it("takes both of two resends at once from the session that owns the rev, one after the other", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      await save("maya", versionId, { rev: before.rev, body: doc("Mine") });
      const answers = await Promise.all([
        save("maya", versionId, { rev: before.rev, body: doc("x") }),
        save("maya", versionId, { rev: before.rev, body: doc("y") }),
      ]);
      expect(answers.every((a) => a.ok)).toBe(true);
      expect((await stored(versionId)).rev).toBe(before.rev + 3);
    });
  });

  describe("drafts.saveAccess", () => {
    it("lets an author of the template's team save, whatever state the version is in", async () => {
      const { versionId } = await draftOf("annual-fee-waiver");
      const inReview = await versionOf("cash-back", 3);
      for (const userId of ["maya", "priya"])
        for (const id of [versionId, inReview.id])
          expect(
            await h
              .services()
              .drafts.saveAccess(await h.as(userId), { versionId: id }),
          ).toEqual({ ok: true });
    });

    it("refuses version_gone and the permission refusal exactly as the save does", async () => {
      const { versionId, stored: before } = await draftOf("annual-fee-waiver");
      const cases: [string, string][] = [
        ["maya", "v_missing"],
        ["sam", versionId],
        ["jordan", versionId],
        ["eli", versionId],
        ["morgan", versionId],
        ["eli", "v_missing"],
      ];
      for (const [userId, id] of cases) {
        const access = await h
          .services()
          .drafts.saveAccess(await h.as(userId), { versionId: id });
        expect(access, `${userId} ${id}`).toMatchObject({
          ok: false,
          code:
            id === "v_missing"
              ? REQUEST_REFUSALS.versionGone.code
              : REASONS.generic.code,
        });
        const saved = await save(userId, id, {
          rev: before.rev,
          body: doc("x"),
        });
        expect(!access.ok && access.code).toBe(!saved.ok && saved.code);
      }
    });
  });
}
