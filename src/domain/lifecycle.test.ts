import { describe, expect, it } from "vitest";
import {
  BLANK_STARTER_KEY,
  DEFAULT_CHANNELS,
  LifecycleError,
  UNTITLED_TEMPLATE_NAME,
  createDraft,
  editActive,
  initialTemplateName,
  planDraftStart,
  type StarterContent,
  type VersionSnapshot,
} from "./lifecycle";
import type { JSONContent, SampleSet, Variable, VersionState } from "./types";

const NOW = new Date("2026-10-04T12:00:00.000Z");

const heading = (id: string, requiredKey: string, text: string): JSONContent => ({
  type: "heading",
  attrs: { id, level: 2, requiredKey },
  content: [{ type: "text", text }],
});

const BODY: JSONContent = {
  type: "doc",
  content: [
    heading("b_one", "offer_details", "Offer details"),
    {
      type: "paragraph",
      attrs: { id: "b_two" },
      content: [{ type: "text", text: "Hi " }, { type: "variable", attrs: { key: "first_name" } }],
    },
    heading("b_three", "rates_and_fees", "Rates and fees"),
    heading("b_four", "legal_notices", "Legal notices"),
  ],
};

const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
];

const SAMPLE_SETS: SampleSet[] = [
  { id: "typical", name: "Typical customer", values: { first_name: "Maya", purchase_apr: "21.99" } },
  { id: "long", name: "Long name and maximum values", values: { first_name: "Alexandria-Marguerite", purchase_apr: "29.99" } },
  { id: "minimum", name: "Minimum values", values: { first_name: "Al", purchase_apr: "9.99" } },
];

const EXAMPLE: StarterContent = {
  key: "card_offer_terms",
  name: "Card offer terms",
  body: BODY,
  variables: VARIABLES,
  sampleSets: SAMPLE_SETS,
};

const BLANK: StarterContent = {
  key: BLANK_STARTER_KEY,
  name: "Blank",
  body: { type: "doc", content: [heading("b_one", "offer_details", "Offer details")] },
  variables: [],
  sampleSets: [
    { id: "typical", name: "Typical customer", values: {} },
    { id: "long", name: "Long name and maximum values", values: {} },
    { id: "minimum", name: "Minimum values", values: {} },
  ],
};

describe("initialTemplateName", () => {
  it("names Blank untitled and every example after itself", () => {
    expect(initialTemplateName(BLANK)).toBe(UNTITLED_TEMPLATE_NAME);
    expect(initialTemplateName(EXAMPLE)).toBe("Card offer terms");
  });
});

describe("createDraft", () => {
  it("starts an example template as a rev 0 draft with no number", () => {
    const { changes } = createDraft({ starter: EXAMPLE, createdBy: "maya", now: NOW });

    expect(changes.template).toEqual({
      name: "Card offer terms",
      starterKey: "card_offer_terms",
      createdBy: "maya",
      createdAt: NOW,
    });
    expect(changes.draft).toMatchObject({
      state: "draft",
      number: null,
      basedOnVersionId: null,
      contractChanges: null,
      currentStage: 0,
      rev: 0,
      createdBy: "maya",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("carries the starter's body, variables and sample sets", () => {
    const { changes } = createDraft({ starter: EXAMPLE, createdBy: "maya", now: NOW });
    expect(changes.draft.body).toEqual(BODY);
    expect(changes.draft.variables).toEqual(VARIABLES);
    expect(changes.draft.sampleSets).toEqual(SAMPLE_SETS);
  });

  it("turns on PDF and Web only, with no email copy, unless the starter says otherwise", () => {
    const { changes } = createDraft({ starter: EXAMPLE, createdBy: "maya", now: NOW });
    expect(changes.draft.channels).toEqual([...DEFAULT_CHANNELS]);
    expect(changes.draft.channels).not.toContain("email");
    expect(changes.draft.emailSubject).toBeNull();
    expect(changes.draft.emailPreheader).toBeNull();

    const subject: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
    const withEmail = createDraft({
      starter: { ...EXAMPLE, channels: ["pdf", "web", "email"], emailSubject: subject, emailPreheader: subject },
      createdBy: "maya",
      now: NOW,
    });
    expect(withEmail.changes.draft.channels).toEqual(["pdf", "web", "email"]);
    expect(withEmail.changes.draft.emailSubject).toEqual(subject);
    expect(withEmail.changes.draft.emailPreheader).toEqual(subject);
  });

  it("makes Blank untitled, with no starter key and no variables", () => {
    const { changes, effects } = createDraft({ starter: BLANK, createdBy: "maya", now: NOW });
    expect(changes.template.name).toBe(UNTITLED_TEMPLATE_NAME);
    expect(changes.template.starterKey).toBeNull();
    expect(changes.draft.variables).toEqual([]);
    expect(effects).toEqual([
      { kind: "audit", action: "template.created", details: { name: UNTITLED_TEMPLATE_NAME, source: "blank" } },
    ]);
  });

  it("records the creation for the audit log, naming the starter", () => {
    const { effects } = createDraft({ starter: EXAMPLE, createdBy: "maya", now: NOW });
    expect(effects).toEqual([
      {
        kind: "audit",
        action: "template.created",
        details: { name: "Card offer terms", source: "starter:card_offer_terms" },
      },
    ]);
  });

  it("copies, so editing the draft never changes the starter", () => {
    const { changes } = createDraft({ starter: EXAMPLE, createdBy: "maya", now: NOW });
    changes.draft.variables[0]!.label = "Changed";
    changes.draft.sampleSets[0]!.values.first_name = "Changed";
    changes.draft.body.content![0]!.attrs!.id = "changed";
    expect(VARIABLES[0]!.label).toBe("First name");
    expect(SAMPLE_SETS[0]!.values.first_name).toBe("Maya");
    expect(BODY.content![0]!.attrs!.id).toBe("b_one");
  });
});

describe("planDraftStart", () => {
  const v = (id: string, state: VersionState, number: number | null) => ({ id, state, number });

  it("goes to the open draft when there is one, even beside an Active version", () => {
    expect(
      planDraftStart([v("v1", "superseded", 1), v("v2", "active", 2), v("d1", "draft", null)]),
    ).toEqual({ kind: "open", versionId: "d1" });
  });

  it("copies the Active version when it is the latest and there is no open draft", () => {
    expect(planDraftStart([v("v1", "superseded", 1), v("v2", "active", 2)])).toEqual({
      kind: "create",
      from: "v2",
    });
    expect(planDraftStart([v("v1", "active", 1)])).toEqual({ kind: "create", from: "v1" });
  });

  it("refuses while a newer version is in review", () => {
    expect(
      planDraftStart([v("v1", "superseded", 1), v("v2", "active", 2), v("v3", "in_review", 3)]),
    ).toEqual({ kind: "blocked", reason: "A newer version is in review." });
  });

  it.each(["in_review", "changes_requested", "revoked", "superseded"] as const)(
    "refuses when the only version is %s",
    (state) => {
      expect(planDraftStart([v("v1", state, 1)]).kind).toBe("blocked");
    },
  );

  it("refuses a template with no versions", () => {
    expect(planDraftStart([]).kind).toBe("blocked");
  });
});

describe("editActive", () => {
  const active: VersionSnapshot = {
    id: "v_active",
    number: 3,
    state: "active",
    body: BODY,
    emailSubject: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Subject" }] }] },
    emailPreheader: null,
    channels: ["pdf", "web", "email"],
    variables: VARIABLES,
    sampleSets: SAMPLE_SETS,
  };

  it("copies body, variables, channels, email fields and sample sets into a draft", () => {
    const { changes } = editActive({ active, createdBy: "priya", now: NOW });
    expect(changes.draft).toEqual({
      state: "draft",
      number: null,
      basedOnVersionId: "v_active",
      body: BODY,
      emailSubject: active.emailSubject,
      emailPreheader: null,
      channels: ["pdf", "web", "email"],
      variables: VARIABLES,
      sampleSets: SAMPLE_SETS,
      contractChanges: null,
      currentStage: 0,
      rev: 0,
      createdBy: "priya",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("keeps every block id, so comment threads and the redline stay anchored", () => {
    const { changes } = editActive({ active, createdBy: "priya", now: NOW });
    const ids = (changes.draft.body.content ?? []).map((b) => b.attrs?.id);
    expect(ids).toEqual(["b_one", "b_two", "b_three", "b_four"]);
  });

  it("records which version number the draft is based on", () => {
    const { effects } = editActive({ active, createdBy: "priya", now: NOW });
    expect(effects).toEqual([{ kind: "audit", action: "draft.started", details: { basedOn: 3 } }]);
  });

  it("copies, so editing the draft never changes the Active version", () => {
    const { changes } = editActive({ active, createdBy: "priya", now: NOW });
    changes.draft.channels.push("pdf");
    changes.draft.variables[1]!.required = false;
    changes.draft.sampleSets[2]!.values.purchase_apr = "0.01";
    changes.draft.body.content![1]!.content![0]!.text = "Changed";
    expect(active.channels).toEqual(["pdf", "web", "email"]);
    expect(VARIABLES[1]!.required).toBe(true);
    expect(SAMPLE_SETS[2]!.values.purchase_apr).toBe("9.99");
    expect(BODY.content![1]!.content![0]!.text).toBe("Hi ");
  });

  it.each(["draft", "in_review", "changes_requested", "superseded", "revoked"] as const)(
    "refuses to copy a %s version",
    (state) => {
      expect(() => editActive({ active: { ...active, state }, createdBy: "priya", now: NOW })).toThrow(
        LifecycleError,
      );
    },
  );
});
