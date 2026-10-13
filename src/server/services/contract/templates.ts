import { describe, expect, it } from "vitest";
import type { ChannelFields } from "@/domain/channel-fields";
import type { ImportReport } from "@/domain/import-report";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import type { DraftContent } from "@/domain/lifecycle/types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { JSONContent } from "@/domain/types";
import type { ActionResult } from "../types";
import type { ContractHarness } from "./harness";

// New template, Import, Edit and an imported file's original, as every implementation must show them
// (TemplateService in src/server/services/templates.ts). The BFF builds the first draft and prepares its
// documents; the backend stores it, so the cases hand it drafts of their own (a starter's fee schedule, a Blank,
// an alert) and compare what the reads and the probe show before and after. Seed: Maya is an author on Coral
// Offers, Sam its viewer, Eli an author on Deposits, Jordan an approver; Balance Transfer has an Active v2 and
// nothing newer, Cash Back v3 is in review.
//
// Each case sets the backend's clock, then acts. A refusal is checked by its code: the sentence is the BFF's.

const CORAL = "t_coral";
const DEPOSITS = "t_deposits";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A paragraph of the text, with the block id every stored block has. */
const paragraph = (id: string, text: string): JSONContent => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});

/** A draft the BFF would have built for a document: fitted to Disclosure, with block ids. */
function documentDraft(over: Partial<DraftContent> = {}): DraftContent {
  return {
    name: "Fee schedule",
    body: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { id: "b_offer", level: 2, requiredKey: "offer_details" },
          content: [{ type: "text", text: "Offer details" }],
        },
        {
          type: "paragraph",
          attrs: { id: "b_hello" },
          content: [
            { type: "text", text: "Hello " },
            { type: "variable", attrs: { key: "first_name" } },
          ],
        },
      ],
    },
    channelFields: {},
    channels: ["pdf", "web"],
    variables: [
      {
        key: "first_name",
        label: "First name",
        type: "text",
        required: true,
        sample: "Maya",
      },
    ],
    sampleSets: [
      {
        id: "typical",
        name: "Typical customer",
        values: { first_name: "Maya" },
      },
      {
        id: "long",
        name: "Long name and maximum values",
        values: { first_name: "Alexandria-Marguerite" },
      },
      { id: "minimum", name: "Minimum values", values: { first_name: "Al" } },
    ],
    starterKey: "fee_schedule",
    ...over,
  };
}

/** A draft for an alert: a push and an SMS with their fields, and an empty body. */
function alertDraft(): DraftContent {
  const line = (text: string): JSONContent => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const channelFields: ChannelFields = {
    push: {
      title: line("Payment due"),
      body: line("Your payment is due soon."),
    },
    sms: { text: line("Your payment is due soon.") },
  };
  return documentDraft({
    name: "Payment reminder",
    body: { type: "doc", content: [paragraph("b_empty", "")] },
    channelFields,
    channels: ["push", "sms"],
    variables: [],
    sampleSets: [],
    starterKey: "payment_reminder",
  });
}

/** The report an import of a Word file would keep. */
function reportOf(kind: ImportReport["kind"], filename: string): ImportReport {
  return {
    kind,
    filename,
    size: 4,
    ...(kind === "pdf" ? { pages: 2 } : {}),
    nameFrom: "filename",
    placeholders: [
      {
        key: "first_name",
        label: "First name",
        raw: ["{{First Name}}"],
        count: 1,
      },
    ],
    skippedPlaceholders: [],
    sections: {
      matched: [],
      added: [{ key: "offer_details", title: "Offer details" }],
    },
    counts: { headings: 1, paragraphs: 1, lists: 0, tables: 0 },
    dropped: [],
  };
}

export function templatesContract(h: ContractHarness, base: Date) {
  const minute = (n: number) => new Date(base.getTime() + n * 60_000);

  /** A script of template ids for the backend to draw, one per call; the last repeats. */
  const drawing = (...ids: string[]) => {
    const drawn: string[] = [];
    return {
      drawn,
      source: {
        templateId: () => {
          const id = ids[Math.min(drawn.length, ids.length - 1)]!;
          drawn.push(id);
          return id;
        },
      },
    };
  };

  /** The created template's id, or the failure. */
  function createdId(result: ActionResult<{ templateId: string }>) {
    if (!result.ok) throw new Error(`create refused: ${result.code}`);
    return result.templateId;
  }

  async function create(
    userId: string,
    draft = documentDraft(),
    teamId = CORAL,
  ) {
    return h.services().templates.create(await h.as(userId), {
      teamId,
      contentTypeId: "ct_disclosure",
      draft,
    });
  }

  async function importDocx(
    userId: string,
    over: { kind?: "docx" | "pdf" | "txt"; teamId?: string } = {},
  ) {
    const kind = over.kind ?? "docx";
    const filename = `Rates.${kind}`;
    return h.services().templates.createImported(await h.as(userId), {
      teamId: over.teamId ?? CORAL,
      contentTypeId: "ct_disclosure",
      draft: documentDraft({ name: "Rates", starterKey: null }),
      original: {
        filename,
        mime: kind === "docx" ? DOCX_MIME : `application/${kind}`,
        bytes: Uint8Array.from([80, 75, 3, 4]),
      },
      report: reportOf(kind, filename),
      compareHtml: kind === "docx" ? "<p>Hello {{First Name}}</p>" : null,
    });
  }

  describe("templates.newTemplateType", () => {
    it("names the content type a document or an alert is made on, with its sections and channels, at the backend's instant", async () => {
      h.setClock(minute(1));
      const maya = await h.as("maya");
      const document = await h
        .services()
        .templates.newTemplateType(maya, { teamId: CORAL, family: "document" });
      expect(document).toMatchObject({
        ok: true,
        asOf: minute(1).toISOString(),
        contentTypeId: "ct_disclosure",
        requiredSections: [
          { key: "offer_details", title: "Offer details" },
          { key: "rates_and_fees", title: "Rates and fees" },
          { key: "legal_notices", title: "Legal notices" },
        ],
      });
      if (document.ok)
        expect(document.allowedChannels).toEqual(
          expect.arrayContaining(["pdf", "web"]),
        );

      expect(
        await h
          .services()
          .templates.newTemplateType(maya, {
            teamId: CORAL,
            family: "message",
          }),
      ).toMatchObject({
        ok: true,
        contentTypeId: "ct_alert",
        allowedChannels: ["push", "sms"],
      });
    });

    it("refuses someone who can't create on the team, and a team that isn't there, with the permission refusal", async () => {
      for (const [userId, teamId] of [
        ["sam", CORAL],
        ["jordan", CORAL],
        ["eli", CORAL],
        ["maya", DEPOSITS],
        ["maya", "t_nowhere"],
      ] as const)
        expect(
          await h.services().templates.newTemplateType(await h.as(userId), {
            teamId,
            family: "document",
          }),
          `${userId} on ${teamId}`,
        ).toMatchObject({ ok: false, status: 403, code: "generic" });
    });
  });

  describe("templates.create", () => {
    it("makes the template and its first draft, dated by the backend's clock, with the author its only writer, and records it", async () => {
      const draft = documentDraft();
      h.setClock(minute(1));
      const templateId = createdId(await create("maya", draft));
      expect(templateId).toMatch(/^UC-[0-9A-HJKMNP-TV-Z]{6}$/);

      const stored = (await h.probe.template({ templateId }))!;
      expect(stored).toMatchObject({
        teamId: CORAL,
        contentTypeId: "ct_disclosure",
        starterKey: "fee_schedule",
        createdBy: "maya",
        createdAt: minute(1).toISOString(),
      });
      expect(stored.versions).toEqual([
        {
          id: expect.any(String),
          state: "draft",
          rev: 0,
          name: "Fee schedule",
          body: draft.body,
          variables: draft.variables,
          channels: ["pdf", "web"],
          channelFields: {},
          sampleSets: draft.sampleSets,
          writers: ["maya"],
          basedOnVersionId: null,
          importUploadId: null,
          createdBy: "maya",
          createdAt: minute(1).toISOString(),
        },
      ]);
      expect(stored.audit).toEqual([
        {
          action: "template.created",
          at: minute(1).toISOString(),
          actorId: "maya",
          teamId: CORAL,
          templateId,
          versionId: null,
          details: { name: "Fee schedule", source: "starter:fee_schedule" },
        },
      ]);

      // The Versions read shows the draft, named as the CMS names the template, and Maya may submit it.
      const history = await h
        .services()
        .versions.history(await h.as("maya"), { templateId });
      expect(history).toMatchObject({
        ok: true,
        template: { id: templateId, teamId: CORAL, name: "Fee schedule" },
        versions: [
          {
            id: stored.versions[0]!.id,
            number: null,
            state: "draft",
            createdBy: "maya",
            createdAt: minute(1).toISOString(),
          },
        ],
      });
    });

    it("makes a Blank template with no starter key, and an alert with its channel fields", async () => {
      h.setClock(minute(1));
      const blank = createdId(
        await create(
          "maya",
          documentDraft({ name: "Untitled template", starterKey: null }),
        ),
      );
      const stored = (await h.probe.template({ templateId: blank }))!;
      expect(stored.starterKey).toBeNull();
      expect(stored.audit.map((e) => e.details)).toEqual([
        { name: "Untitled template", source: "blank" },
      ]);

      const alert = alertDraft();
      const templateId = createdId(
        await h.services().templates.create(await h.as("maya"), {
          teamId: CORAL,
          contentTypeId: "ct_alert",
          draft: alert,
        }),
      );
      const made = (await h.probe.template({ templateId }))!;
      expect(made).toMatchObject({
        contentTypeId: "ct_alert",
        starterKey: "payment_reminder",
      });
      expect(made.versions[0]).toMatchObject({
        channels: ["push", "sms"],
        channelFields: alert.channelFields,
        body: alert.body,
      });
    });

    it("refuses, in order, a viewer, a team that isn't there, a content type that is gone and channels the type doesn't allow, and writes nothing", async () => {
      const before = await h.probe.templateIds();
      const refused = async (
        userId: string,
        over: {
          teamId?: string;
          contentTypeId?: string;
          draft?: DraftContent;
        },
        code: string,
      ) =>
        expect(
          await h.services().templates.create(await h.as(userId), {
            teamId: over.teamId ?? CORAL,
            contentTypeId: over.contentTypeId ?? "ct_disclosure",
            draft: over.draft ?? documentDraft(),
          }),
          `${userId} ${JSON.stringify(over.teamId ?? "")} ${over.contentTypeId ?? ""}`,
        ).toMatchObject({ ok: false, code });

      await refused("sam", {}, "generic");
      await refused("eli", {}, "generic");
      await refused("maya", { teamId: DEPOSITS }, "generic");
      // Nothing to look up for a team that isn't there: refused like a team the viewer can't write to.
      await refused("maya", { teamId: "t_nowhere" }, "generic");
      // The permission comes first, whatever else is wrong.
      await refused("sam", { contentTypeId: "ct_nowhere" }, "generic");
      await refused(
        "maya",
        { contentTypeId: "ct_nowhere" },
        REQUEST_REFUSALS.contentTypeGone.code,
      );
      await refused(
        "maya",
        { draft: documentDraft({ channels: [] }) },
        REFUSALS.noChannels.code,
      );
      await refused(
        "maya",
        { draft: documentDraft({ channels: ["pdf", "push"] }) },
        REFUSALS.channelNotAllowed.code,
      );
      expect((await h.probe.templateIds()).sort()).toEqual([...before].sort());
    });

    it("draws a new id and writes again when the one it drew is taken", async () => {
      const taken = h.templates["balance-transfer"]!;
      const ids = drawing(taken, taken, "UC-RETRY2");
      h.ids(ids.source);
      h.setClock(minute(1));
      const before = await h.probe.templateIds();
      const existing = await h.probe.template({ templateId: taken });

      const templateId = createdId(await create("maya"));

      expect(templateId).toBe("UC-RETRY2");
      expect(ids.drawn).toEqual([taken, taken, "UC-RETRY2"]);
      expect((await h.probe.templateIds()).sort()).toEqual(
        [...before, "UC-RETRY2"].sort(),
      );
      // One write: one first draft and one creation row, and the template whose id was taken is as it was.
      const stored = (await h.probe.template({ templateId }))!;
      expect(stored.versions).toHaveLength(1);
      expect(stored.audit.map((e) => e.action)).toEqual(["template.created"]);
      expect(await h.probe.template({ templateId: taken })).toEqual(existing);
    });

    it("gives up when the third id it draws is taken too, and writes nothing", async () => {
      const taken = h.templates["balance-transfer"]!;
      const ids = drawing(taken);
      h.ids(ids.source);
      const before = await h.probe.templateIds();

      await expect(create("maya")).rejects.toThrow();

      expect(ids.drawn).toEqual([taken, taken, taken]);
      expect((await h.probe.templateIds()).sort()).toEqual([...before].sort());
    });
  });

  describe("templates.createPermission", () => {
    it("says yes to an author on the team, and gives the permission refusal to anyone else", async () => {
      const ask = async (userId: string, teamId: string) =>
        h.services().templates.createPermission(await h.as(userId), { teamId });
      expect(await ask("maya", CORAL)).toEqual({ ok: true });
      for (const [userId, teamId] of [
        ["sam", CORAL],
        ["eli", CORAL],
        ["maya", DEPOSITS],
        ["maya", "t_nowhere"],
      ] as const)
        expect(
          await ask(userId, teamId),
          `${userId} on ${teamId}`,
        ).toMatchObject({
          ok: false,
          code: "generic",
        });
    });
  });

  describe("templates.createImported", () => {
    it("stores the template, its draft, the original and the report together, and records the import", async () => {
      h.setClock(minute(1));
      const result = await importDocx("maya");
      if (!result.ok) throw new Error(`import refused: ${result.code}`);
      const { templateId, uploadId } = result;

      const stored = (await h.probe.template({ templateId }))!;
      expect(stored.starterKey).toBeNull();
      expect(stored.versions).toEqual([
        expect.objectContaining({
          state: "draft",
          name: "Rates",
          writers: ["maya"],
          importUploadId: uploadId,
        }),
      ]);
      expect(stored.audit).toEqual([
        {
          action: "template.created",
          at: minute(1).toISOString(),
          actorId: "maya",
          teamId: CORAL,
          templateId,
          versionId: null,
          details: {
            name: "Rates",
            source: "import:docx",
            filename: "Rates.docx",
          },
        },
      ]);

      const maya = await h.as("maya");
      expect(
        await h.services().templates.importOriginal(maya, { uploadId }),
      ).toEqual({
        ok: true,
        filename: "Rates.docx",
        mime: DOCX_MIME,
        bytes: Uint8Array.from([80, 75, 3, 4]),
      });
      const original = {
        uploadId,
        filename: "Rates.docx",
        kind: "docx",
        size: 4,
        uploadedAt: minute(1).toISOString(),
        uploadedBy: {
          id: "maya",
          name: "Maya Chen",
          initials: expect.any(String),
          hue: expect.any(Number),
        },
      };
      expect(
        await h.services().templates.importOriginalView(maya, { uploadId }),
      ).toEqual({
        ok: true,
        original,
        report: reportOf("docx", "Rates.docx"),
        compareHtml: "<p>Hello {{First Name}}</p>",
      });
      expect(
        await h.services().templates.importOriginalRef(maya, { templateId }),
      ).toEqual({ ok: true, original });
    });

    it("keeps a PDF and a text file's report beside the original, with no Compare HTML", async () => {
      for (const kind of ["pdf", "txt"] as const) {
        const result = await importDocx("maya", { kind });
        if (!result.ok) throw new Error(`import refused: ${result.code}`);
        const view = await h
          .services()
          .templates.importOriginalView(await h.as("maya"), {
            uploadId: result.uploadId,
          });
        expect(view, kind).toMatchObject({
          ok: true,
          original: { kind, filename: `Rates.${kind}` },
          report: reportOf(kind, `Rates.${kind}`),
          compareHtml: null,
        });
      }
    });

    it("shows the original to the template's space only; anyone else reads it as not there", async () => {
      const result = await importDocx("maya");
      if (!result.ok) throw new Error(`import refused: ${result.code}`);
      const { templateId, uploadId } = result;

      // Sam (a viewer on Coral) and Riley (a platform role) may see it; Naomi (Deposits only) may not.
      for (const userId of ["sam", "riley"])
        expect(
          await h
            .services()
            .templates.importOriginal(await h.as(userId), { uploadId }),
          userId,
        ).toMatchObject({ ok: true, filename: "Rates.docx" });
      const naomi = await h.as("naomi");
      for (const read of [
        h.services().templates.importOriginal(naomi, { uploadId }),
        h.services().templates.importOriginalView(naomi, { uploadId }),
        // An upload that isn't there, and an id that is no upload's, read the same.
        h
          .services()
          .templates.importOriginal(naomi, { uploadId: "up_0000000000" }),
        h
          .services()
          .templates.importOriginal(await h.as("maya"), {
            uploadId: "../../etc",
          }),
      ])
        expect(await read).toMatchObject({
          ok: false,
          status: 404,
          code: "upload_unavailable",
        });
      expect(
        await h.services().templates.importOriginalRef(naomi, { templateId }),
      ).toMatchObject({ ok: false, status: 404, code: "template_unavailable" });
    });

    it("has no original for a template that wasn't imported", async () => {
      expect(
        await h.services().templates.importOriginalRef(await h.as("maya"), {
          templateId: h.templates["balance-transfer"]!,
        }),
      ).toEqual({ ok: true, original: null });
    });

    it("refuses as create does, before it stores anything", async () => {
      const before = await h.probe.templateIds();
      for (const [userId, over, code] of [
        ["sam", {}, "generic"],
        ["maya", { teamId: DEPOSITS }, "generic"],
        ["maya", { teamId: "t_nowhere" }, "generic"],
      ] as const) {
        expect(await importDocx(userId, over), userId).toMatchObject({
          ok: false,
          code,
        });
      }
      expect(
        await h.services().templates.createImported(await h.as("maya"), {
          teamId: CORAL,
          contentTypeId: "ct_disclosure",
          draft: documentDraft({ channels: ["push"] }),
          original: {
            filename: "Rates.docx",
            mime: DOCX_MIME,
            bytes: Uint8Array.from([1]),
          },
          report: reportOf("docx", "Rates.docx"),
          compareHtml: null,
        }),
      ).toMatchObject({ ok: false, code: REFUSALS.channelNotAllowed.code });
      expect((await h.probe.templateIds()).sort()).toEqual([...before].sort());
    });

    it("draws a new id when the one it drew is taken, and keeps one original", async () => {
      const taken = h.templates["balance-transfer"]!;
      h.ids(drawing(taken, "UC-IMPRT2").source);
      const result = await importDocx("maya");
      if (!result.ok) throw new Error(`import refused: ${result.code}`);
      expect(result.templateId).toBe("UC-IMPRT2");
      expect(
        await h
          .services()
          .templates.importOriginal(await h.as("maya"), {
            uploadId: result.uploadId,
          }),
      ).toMatchObject({ ok: true, filename: "Rates.docx" });
    });
  });

  describe("templates.startDraft", () => {
    /** The template's rows as the probe shows them. */
    const versionsOf = async (templateId: string) =>
      (await h.probe.template({ templateId }))!.versions;

    it("opens a draft copied from the Active version, with the person who pressed Edit as its only writer, and records it", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const [active] = (await versionsOf(templateId)).filter(
        (v) => v.state === "active",
      );
      const auditBefore = (await h.probe.template({ templateId }))!.audit;
      h.setClock(minute(1));

      const result = await h
        .services()
        .templates.startDraft(await h.as("maya"), { templateId });
      expect(result).toEqual({
        ok: true,
        changed: true,
        draftId: expect.any(String),
        teamSlug: "coral-offers",
      });
      if (!result.ok) return;

      const draft = (await versionsOf(templateId)).find(
        (v) => v.id === result.draftId,
      )!;
      expect(draft).toMatchObject({
        state: "draft",
        rev: 0,
        name: active!.name,
        body: active!.body,
        variables: active!.variables,
        channels: active!.channels,
        sampleSets: active!.sampleSets,
        basedOnVersionId: active!.id,
        createdBy: "maya",
        // Not the Active version's writers: whoever wrote an earlier release may still decide the next one.
        writers: ["maya"],
        createdAt: minute(1).toISOString(),
      });
      const audit = (await h.probe.template({ templateId }))!.audit;
      expect(audit.slice(auditBefore.length)).toEqual([
        {
          action: "draft.started",
          at: minute(1).toISOString(),
          actorId: "maya",
          teamId: CORAL,
          templateId,
          versionId: result.draftId,
          details: { basedOn: 2 },
        },
      ]);
    });

    it("opens the draft that is open already, writing nothing (a second click, or another tab)", async () => {
      const templateId = h.templates["balance-transfer"]!;
      const first = await h
        .services()
        .templates.startDraft(await h.as("maya"), { templateId });
      if (!first.ok) throw new Error(first.code);
      const rows = await versionsOf(templateId);
      const audit = (await h.probe.template({ templateId }))!.audit;

      // Priya, another author on the team, presses Edit on the draft Maya started: she gets it, as it is.
      const second = await h
        .services()
        .templates.startDraft(await h.as("priya"), { templateId });
      expect(second).toEqual({
        ok: true,
        changed: false,
        draftId: first.draftId,
        teamSlug: "coral-offers",
      });
      expect(await versionsOf(templateId)).toEqual(rows);
      expect((await h.probe.template({ templateId }))!.audit).toEqual(audit);

      // Annual Fee Waiver has Maya's draft from the seed: Edit opens it.
      const annualFee = h.templates["annual-fee-waiver"]!;
      const open = await versionsOf(annualFee).then((all) =>
        all.find((v) => v.state === "draft")!,
      );
      expect(
        await h
          .services()
          .templates.startDraft(await h.as("maya"), { templateId: annualFee }),
      ).toMatchObject({ ok: true, changed: false, draftId: open.id });
    });

    it("lets one of two Edits at once in, and the other opens that draft", async () => {
      const templateId = h.templates["rate-change-notice"]!;
      const auditBefore = (await h.probe.template({ templateId }))!.audit;
      h.hooks({
        beforeCompareAndSet: (target) =>
          target.table === "drafts" && target.id === templateId
            ? "competing_write"
            : undefined,
      });
      h.setClock(minute(1));

      const result = await h
        .services()
        .templates.startDraft(await h.as("maya"), { templateId });

      // The competing Edit's draft stands, and this one opened it: one draft, and no second record of it.
      const drafts = (await versionsOf(templateId)).filter(
        (v) => v.state === "draft",
      );
      expect(drafts).toHaveLength(1);
      expect(result).toEqual({
        ok: true,
        changed: false,
        draftId: drafts[0]!.id,
        teamSlug: "coral-offers",
      });
      expect((await h.probe.template({ templateId }))!.audit).toEqual(
        auditBefore,
      );
    });

    it("refuses someone who can't edit and a template that isn't there alike, then a newer version in review", async () => {
      const cashBack = h.templates["cash-back"]!;
      const before = await versionsOf(cashBack);
      for (const [userId, templateId] of [
        ["sam", h.templates["balance-transfer"]!],
        ["eli", h.templates["balance-transfer"]!],
        ["jordan", h.templates["balance-transfer"]!],
        ["maya", "UC-ZZZZZZ"],
      ] as const)
        expect(
          await h
            .services()
            .templates.startDraft(await h.as(userId), { templateId }),
          `${userId} ${templateId}`,
        ).toMatchObject({ ok: false, code: "generic" });

      expect(
        await h
          .services()
          .templates.startDraft(await h.as("maya"), { templateId: cashBack }),
      ).toMatchObject({ ok: false, code: REFUSALS.newerInReview.code });
      expect(await versionsOf(cashBack)).toEqual(before);
    });
  });
}
