import { describe, expect, it } from "vitest";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ChannelFields } from "@/domain/channel-fields";
import type {
  Channel,
  DraftPatch,
  DraftSaveResponse,
  JSONContent,
  SampleSet,
  Variable,
  VersionState,
} from "@/domain/types";
import type { ContractHarness } from "./harness";

// Autosave's behaviour, as every implementation must show it (DraftService in src/server/services/drafts.ts), from
// the seed: Annual Fee Waiver (Coral Offers, a Disclosure: PDF, web and email allowed) has an open draft Maya
// started, and Rate Change Heads-up (Coral Offers, an Alert: push and SMS) has one with a push title and body and an
// SMS text. Cash Back v3 is in review. Maya and Priya are authors on Coral Offers; Jordan approves there, Sam views,
// Eli is an author on Deposits, Morgan has no team, Riley is the platform admin.
//
// Each case sets the backend's clock, saves through the service, and compares the draft as the reads show it before
// and after: its rev and content in the workspace's document, its name in Compare, its writers by who may then
// decide it (maker-checker). A save arrives prepared (the BFF's route prepares every document), so
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

/** A version's state, name and content, as the reads show them. */
interface StoredVersion {
  state: VersionState;
  name: string;
  body: JSONContent;
  variables: Variable[];
  channels: Channel[];
  channelFields: ChannelFields;
}

/** The open draft: its content, and where autosave starts (`rev`) with its sample sets. */
interface StoredDraft extends StoredVersion {
  rev: number;
  sampleSets: SampleSet[];
}

export function draftsContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);

  /** A template's open draft, as the Versions read lists it, and as the reads show it now (`current()` again). */
  async function draftOf(key: string) {
    const templateId = h.templates[key]!;
    const history = await h
      .services()
      .versions.history(await h.as("maya"), { templateId });
    if (!history.ok) throw new Error(history.code);
    const row = history.versions.find((v) => v.state === "draft");
    if (!row) throw new Error(`${key} has no open draft.`);
    const current = () => storedDraft(templateId, row.id);
    return { templateId, versionId: row.id, stored: await current(), current };
  }

  /** A template's version by number, as the Versions read lists it. */
  async function versionOf(key: string, number: number) {
    const templateId = h.templates[key]!;
    const history = await h
      .services()
      .versions.history(await h.as("maya"), { templateId });
    if (!history.ok) throw new Error(history.code);
    return {
      templateId,
      ...history.versions.find((v) => v.number === number && v.head)!,
    };
  }

  /** A version as the reads show it: its state (the Versions tab), and its name and content (Compare). */
  async function stored(
    templateId: string,
    versionId: string,
  ): Promise<StoredVersion> {
    const taylor = await h.as("taylor");
    const [history, pair] = await Promise.all([
      h.services().versions.history(taylor, { templateId }),
      h.services().versions.compare(taylor, {
        templateId,
        from: versionId,
        to: versionId,
      }),
    ]);
    if (!history.ok) throw new Error(history.code);
    if (!pair.ok) throw new Error(pair.code);
    const { name, body, variables, channels, channelFields } = pair.to;
    return {
      state: history.versions.find((v) => v.id === versionId)!.state,
      name,
      body,
      variables,
      channels,
      channelFields,
    };
  }

  /** The open draft as the reads show it: `stored`, with its rev and sample sets from the workspace's document. */
  async function storedDraft(
    templateId: string,
    versionId: string,
  ): Promise<StoredDraft> {
    const document = await h
      .services()
      .templates.workspaceDocument(await h.as("taylor"), { templateId });
    if (!document.ok) throw new Error(document.code);
    if (document.version.id !== versionId)
      throw new Error(`${versionId} isn't ${templateId}'s open draft.`);
    return {
      ...(await stored(templateId, versionId)),
      rev: document.version.rev,
      sampleSets: document.version.sampleSets,
    };
  }

  /** Whether `userId` may decide the round in review, as its code or "ok": maker-checker shows who wrote it. */
  async function deciding(userId: string, templateId: string, round: number) {
    const answer = await h
      .services()
      .review.requestChanges(await h.as(userId), {
        templateId,
        versionNumber: 1,
        round,
        reason: "Who may decide this?",
      });
    return answer.ok ? "ok" : answer.code;
  }

  /** The CMS's name for the template: its open draft's. */
  async function templateName(templateId: string) {
    const history = await h
      .services()
      .versions.history(await h.as("maya"), { templateId });
    if (!history.ok) throw new Error(history.code);
    return history.template.name;
  }

  let sent = 0;
  async function save(
    userId: string,
    versionId: string,
    patch: Partial<DraftPatch> & Pick<DraftPatch, "rev">,
  ): Promise<DraftSaveResponse> {
    return h.services().drafts.save(await h.as(userId), {
      versionId,
      // Each save is sent after the one before it, as the client's counter makes them, unless a case says otherwise.
      patch: { sessionKey: ONE, seq: ++sent, ...patch },
    });
  }

  describe("drafts.save", () => {
    it("writes the fields it names at the current rev, one rev up, dated by the backend's clock, and only on the draft", async () => {
      const {
        templateId,
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
      const v1 = await versionOf("annual-fee-waiver", 1);
      const v1Before = await stored(templateId, v1.id);
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
      expect(await current()).toEqual({
        ...before,
        rev: before.rev + 1,
        body: doc("Edited"),
        name: "Annual Fee Waiver — New Accounts",
      });
      // The template's name in the CMS is its draft's; the version it was started from keeps its own.
      expect(await templateName(templateId)).toBe(
        "Annual Fee Waiver — New Accounts",
      );
      expect(await stored(templateId, v1.id)).toEqual(v1Before);

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
      expect(await current()).toMatchObject({
        rev: before.rev + 2,
        body: doc("Edited"),
        variables: [],
        channels: ["pdf", "web", "email"],
        sampleSets: [],
      });
    });

    it("keeps the channel fields the patch doesn't name, and clears one with null", async () => {
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("rate-change-heads-up");
      expect(before.channelFields.push?.body).toBeDefined();
      expect(before.channelFields.sms?.text).toBeDefined();

      h.setClock(minute(1));
      await save("maya", versionId, {
        rev: before.rev,
        "push.title": line("Your APR is changing"),
      });
      expect((await current()).channelFields).toEqual({
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
      expect((await current()).channelFields).toEqual({
        ...before.channelFields,
        push,
      });
    });

    it("adds whoever saves to the version's writers: once it is submitted, they may not decide it (maker-checker)", async () => {
      const {
        templateId,
        versionId,
        stored: before,
      } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      expect(
        await save("priya", versionId, {
          rev: before.rev,
          sessionKey: TWO,
          body: doc("Priya's"),
        }),
      ).toMatchObject({ ok: true });
      h.setClock(minute(2));
      expect(
        await h.services().review.submit(await h.as("maya"), {
          templateId,
          rev: before.rev + 1,
        }),
      ).toMatchObject({ ok: true, number: 1, round: 2 });
      // Maya submitted it; Priya wrote in it, so she may not decide it either.
      expect(await deciding("maya", templateId, 2)).toBe(
        REASONS.ownVersion.code,
      );
      expect(await deciding("priya", templateId, 2)).toBe(
        REASONS.wroteVersion.code,
      );
    });

    it("refuses a rev that isn't the current one draft_changed with the current rev, and writes nothing", async () => {
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      for (const rev of [before.rev - 1, 0, before.rev + 1, 99])
        expect(
          await save("maya", versionId, { rev, body: doc("Stale") }),
        ).toMatchObject({
          ok: false,
          code: REQUEST_REFUSALS.draftChanged.code,
          rev: before.rev,
        });
      expect(await current()).toEqual(before);
    });

    it("takes the resend of a save whose response was lost: the same session carries on from the current rev", async () => {
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
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
      expect(await current()).toMatchObject({
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
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      for (const [i, text] of ["One", "Two", "Three"].entries())
        expect(
          await save("maya", versionId, { rev: before.rev, body: doc(text) }),
        ).toMatchObject({ ok: true, rev: before.rev + i + 1 });
      expect((await current()).body).toEqual(doc("Three"));
    });

    it("is a conflict when another session wrote in between, even the same person's other tab", async () => {
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
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
      expect(await current()).toMatchObject({
        rev: r + 2,
        body: doc("Tab two"),
      });
    });

    it("is a conflict for another person who borrows the session's key", async () => {
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
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
      expect((await current()).body).toEqual(doc("Maya's"));
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
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      await save("maya", versionId, { rev: before.rev, body: doc("Mine") });
      const landed = await current();
      // Behind, but the session owns the current rev: the channels are what refuse it.
      expect(
        await save("maya", versionId, {
          rev: before.rev,
          channels: ["pdf", "push"],
        }),
      ).toMatchObject({ ok: false, code: REFUSALS.channelNotAllowed.code });
      expect(await current()).toEqual(landed);
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
        const before = await stored(version.templateId, version.id);
        expect(
          await save("maya", version.id, { rev: 0, body: doc("Too late") }),
        ).toMatchObject({
          ok: false,
          code: REQUEST_REFUSALS.versionNotDraft.code,
        });
        expect(await stored(version.templateId, version.id)).toEqual(before);
      }
    });

    it("refuses version_gone for no such version or one the viewer may not see, and the permission refusal for anyone who sees it but may not edit the team's drafts, before the state", async () => {
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
      const inReview = await versionOf("cash-back", 3);
      h.setClock(minute(1));
      expect(
        await save("maya", "v_missing", { rev: 0, body: doc("x") }),
      ).toMatchObject({ ok: false, code: REQUEST_REFUSALS.versionGone.code });
      // Sam views Coral Offers, Jordan approves there, Riley sees every team: none may edit its drafts.
      for (const userId of ["sam", "jordan", "riley"]) {
        for (const id of [versionId, inReview.id])
          expect(
            await save(userId, id, { rev: before.rev, body: doc("x") }),
            `${userId} on ${id}`,
          ).toMatchObject({ ok: false, code: REASONS.generic.code });
      }
      // Eli (Deposits) and Morgan (no team) may not see Coral Offers: its versions read as not there.
      for (const userId of ["eli", "morgan"]) {
        for (const id of [versionId, inReview.id])
          expect(
            await save(userId, id, { rev: before.rev, body: doc("x") }),
            `${userId} on ${id}`,
          ).toMatchObject({
            ok: false,
            code: REQUEST_REFUSALS.versionGone.code,
          });
      }
      expect(await current()).toEqual(before);
    });

    it("refuses channels the content type doesn't allow, and none at all", async () => {
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
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
      expect(await current()).toEqual(before);
    });

    it("refuses draft_changed, and writes nothing, when another write lands between the save's read and its write", async () => {
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
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
      expect(await current()).toEqual(before);
      // Nothing is left half done: the next save at the current rev lands.
      expect(
        await save("maya", versionId, { rev: before.rev, body: doc("Again") }),
      ).toMatchObject({ ok: true, rev: before.rev + 1 });
    });

    it("lets exactly one of two saves at once from different sessions with the same rev land", async () => {
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
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
      expect((await current()).rev).toBe(before.rev + 1);
    });

    it("takes two resends at once from the session that owns the rev in the order they were sent, and refuses one sent before the save that landed", async () => {
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      await save("maya", versionId, { rev: before.rev, body: doc("Mine") });
      const answers = await Promise.all([
        save("maya", versionId, { rev: before.rev, body: doc("x") }),
        save("maya", versionId, { rev: before.rev, body: doc("y") }),
      ]);
      // "y" was sent after "x": it lands whichever arrives first, and "x" lands only if it arrives before "y".
      expect(answers[1]).toMatchObject({ ok: true });
      expect((await current()).body).toEqual(doc("y"));
    });

    it("refuses draft_changed, and writes nothing, for a save the client gave up on that arrives after the retry that replaced it", async () => {
      const {
        versionId,
        stored: before,
        current,
      } = await draftOf("annual-fee-waiver");
      h.setClock(minute(1));
      // The client sent "a" (seq 1), gave up waiting, and retried with what it had by then (seq 2): the retry lands.
      expect(
        await save("maya", versionId, {
          rev: before.rev,
          seq: 2,
          body: doc("ab"),
        }),
      ).toMatchObject({ ok: true, rev: before.rev + 1 });
      // Then the request it gave up on arrives. Its rev is behind and the session wrote the current one, but it was
      // sent before the save that landed: putting back "a" would undo the author's edit without a word.
      const late = await save("maya", versionId, {
        rev: before.rev,
        seq: 1,
        body: doc("a"),
      });
      expect(late).toEqual({
        ok: false,
        ...REQUEST_REFUSALS.draftChanged,
        rev: before.rev + 1,
      });
      expect(await current()).toMatchObject({
        rev: before.rev + 1,
        body: doc("ab"),
      });
      // The session carries on from the rev it was answered.
      expect(
        await save("maya", versionId, {
          rev: before.rev + 1,
          seq: 3,
          body: doc("abc"),
        }),
      ).toMatchObject({ ok: true, rev: before.rev + 2 });
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
        // Eli (Deposits) and Morgan (no team) may not see Coral Offers: its draft reads as not there to them.
        expect(access, `${userId} ${id}`).toMatchObject({
          ok: false,
          code:
            id === "v_missing" || userId === "eli" || userId === "morgan"
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
