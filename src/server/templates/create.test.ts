import { describe, expect, it } from "vitest";
import type { StarterContent } from "@/domain/lifecycle/types";
import type { JSONContent } from "@/domain/types";
import { DOCUMENT_MESSAGES } from "@/editor/model/document-check";
import {
  conformToContentType,
  draftContentOf,
  prepareDraftContent,
} from "./create";

// The BFF's half of a new template's first draft, on hand-built facts: a starter fitted to the content type the
// backend names, shaped as the `DraftContent` it stores, and its documents made ready for storage. The actions
// (src/server/actions/create-template.ts, src/server/import/create.ts) run these against the fake.

const heading = (
  id: string,
  requiredKey: string | null,
  text: string,
): JSONContent => ({
  type: "heading",
  attrs: { id, level: 2, ...(requiredKey ? { requiredKey } : {}) },
  content: [{ type: "text", text }],
});
const paragraph = (id: string, text: string): JSONContent => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});

const STARTER: StarterContent = {
  key: "rate_change_notice",
  name: "Rate change notice",
  body: {
    type: "doc",
    content: [
      heading("b_offer", "offer_details", "Offer details"),
      paragraph("b_one", "Your rate is changing."),
      heading("b_rates", "rates_and_fees", "Rates and fees"),
      heading("b_legal", "legal_notices", "Legal notices"),
    ],
  },
  variables: [],
  sampleSets: [],
  channels: ["pdf", "web", "email"],
};

const headings = (body: JSONContent) =>
  (body.content ?? [])
    .filter((b) => b.type === "heading")
    .map((b) => [
      b.attrs?.requiredKey ?? null,
      (b.content ?? []).map((n) => n.text).join(""),
    ]);

describe("conformToContentType", () => {
  const type = {
    requiredSections: [
      { key: "offer_details", title: "Offer details" },
      { key: "rates_and_fees", title: "Rates and fees" },
      { key: "legal_notices", title: "Legal notices" },
    ],
    allowedChannels: ["pdf", "web", "email"] as const,
  };

  it("leaves a starter as it is when the content type is as the starter was written", () => {
    const fitted = conformToContentType(STARTER, {
      ...type,
      allowedChannels: [...type.allowedChannels],
    });
    expect(headings(fitted.body)).toEqual(headings(STARTER.body));
    expect(fitted.channels).toEqual(["pdf", "web", "email"]);
  });

  it("renames a section, turns a removed one into an ordinary heading, and appends a new one with a block id", () => {
    const fitted = conformToContentType(STARTER, {
      requiredSections: [
        { key: "offer_details", title: "Offer details" },
        { key: "rates_and_fees", title: "Rates, fees and APR" },
        { key: "eligibility", title: "Eligibility" },
      ],
      allowedChannels: ["pdf", "web", "email"],
    });
    expect(headings(fitted.body)).toEqual([
      ["offer_details", "Offer details"],
      ["rates_and_fees", "Rates, fees and APR"],
      [null, "Legal notices"],
      ["eligibility", "Eligibility"],
    ]);
    const added = fitted.body.content!.at(-1)!;
    expect(added.attrs?.id).toMatch(/^b_/);
  });

  it("leaves a section's body alone when an import has fitted the sections already", () => {
    const fitted = conformToContentType(
      STARTER,
      {
        requiredSections: [{ key: "other", title: "Other" }],
        allowedChannels: ["pdf", "web", "email"],
      },
      { sectionsFitted: true },
    );
    expect(fitted.body).toBe(STARTER.body);
  });

  it("keeps the channels the starter wants that the type allows, else the family's defaults it allows, else its first", () => {
    const fit = (allowedChannels: ("pdf" | "web" | "email")[]) =>
      conformToContentType(STARTER, {
        requiredSections: type.requiredSections,
        allowedChannels,
      }).channels;
    expect(fit(["pdf", "web"])).toEqual(["pdf", "web"]);
    expect(fit(["web", "email"])).toEqual(["web", "email"]);
    expect(
      conformToContentType(
        { ...STARTER, channels: undefined },
        { requiredSections: type.requiredSections, allowedChannels: ["email"] },
      ).channels,
    ).toEqual(["email"]);
  });
});

describe("draftContentOf", () => {
  it("names a Blank starter untitled and keeps no starter key for it", () => {
    expect(
      draftContentOf({ ...STARTER, key: "blank", name: "Blank" }),
    ).toMatchObject({ name: "Untitled template", starterKey: null });
  });

  it("keeps an example's own name and key, and defaults the channels and fields a starter leaves out", () => {
    expect(draftContentOf({ ...STARTER, channels: undefined })).toMatchObject({
      name: "Rate change notice",
      starterKey: "rate_change_notice",
      channels: ["pdf", "web"],
      channelFields: {},
    });
  });

  it("keeps no starter key for an import, whatever the name", () => {
    expect(
      draftContentOf(
        { ...STARTER, key: "import", name: "Spring offer" },
        { imported: true },
      ),
    ).toMatchObject({ name: "Spring offer", starterKey: null });
  });
});

describe("prepareDraftContent", () => {
  const line = (text: string): JSONContent => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  it("makes the body and each channel field ready for storage: no tabs, one line where a field is one line, block ids on every block", () => {
    const draft = draftContentOf({
      ...STARTER,
      body: {
        type: "doc",
        content: [
          heading("b_offer", "offer_details", "Offer details"),
          { type: "paragraph", content: [{ type: "text", text: "A\tB" }] },
        ],
      },
      channelFields: { email: { subject: line("Your rate\nis changing") } },
    });
    const prepared = prepareDraftContent(draft);
    if (!prepared.ok) throw new Error(prepared.message);

    const [, second] = prepared.draft.body.content!;
    expect(second!.attrs?.id).toMatch(/^[\w-]+$/);
    expect(JSON.stringify(prepared.draft.body)).not.toContain("\t");
    expect(prepared.draft.channelFields.email?.subject).toEqual(
      line("Your rate is changing"),
    );
    expect(prepared.draft.name).toBe("Rate change notice");
  });

  it("is idempotent: a prepared draft is prepared as it is", () => {
    const first = prepareDraftContent(draftContentOf(STARTER));
    if (!first.ok) throw new Error(first.message);
    expect(prepareDraftContent(first.draft)).toEqual(first);
  });

  it("refuses a document the check refuses, with the check's sentence", () => {
    const cell = (
      text: string,
      attrs: Record<string, unknown> = {},
    ): JSONContent => ({
      type: "tableCell",
      attrs,
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const draft = draftContentOf({
      ...STARTER,
      body: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [cell("A"), cell("B", { rowspan: 2 })],
              },
              { type: "tableRow", content: [cell("C", { colspan: 2 })] },
            ],
          },
        ],
      },
    });
    expect(prepareDraftContent(draft)).toEqual({
      ok: false,
      message: DOCUMENT_MESSAGES.tableShape,
    });
  });
});
