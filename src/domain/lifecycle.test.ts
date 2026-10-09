import { describe, expect, it } from "vitest";
import {
  BLANK_STARTER_KEY,
  DEFAULT_CHANNELS,
  LifecycleError,
  REFUSALS,
  UNTITLED_TEMPLATE_NAME,
  approve,
  cancelRevoke,
  confirmRevoke,
  contractBaseline,
  createDraft,
  editLatest,
  initialTemplateName,
  isAfterToday,
  planDraftStart,
  requestChanges,
  revokePending,
  setSunset,
  startRevoke,
  submit,
  sunsetPassed,
  withWriter,
  type ReviewVersion,
  type StarterContent,
  type SubmitDraft,
  type VersionSnapshot,
} from "./lifecycle";
import { REASONS } from "./permissions";
import type { ApprovalStage, Recipients, VersionStage } from "./review-types";
import {
  VERSION_STATES,
  type ContractChange,
  type JSONContent,
  type RevokeRecord,
  type SampleSet,
  type Variable,
  type VersionState,
} from "./types";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const TEMPLATE = { id: "UC-4F7K2Q", name: "Spring Travel Rewards — Terms" };
const CHAIN_1: ApprovalStage[] = [{ id: "st_team", position: 0, name: "Team approver", rule: { kind: "team_role", role: "approver" } }];

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

  // Handoff review D1: revoking the Active version used to leave nothing anyone could edit.
  it("copies the revoked version when the Active one was revoked and nothing newer exists", () => {
    expect(planDraftStart([v("v1", "superseded", 1), v("v2", "revoked", 2)])).toEqual({ kind: "create", from: "v2" });
    expect(planDraftStart([v("v1", "revoked", 1)])).toEqual({ kind: "create", from: "v1" });
    expect(planDraftStart([v("v1", "revoked", 1), v("v2", "revoked", 2)])).toEqual({ kind: "create", from: "v2" });
  });

  it("still goes to the open draft after a revoke, and copies the Active version over an older revoked one", () => {
    expect(planDraftStart([v("v1", "revoked", 1), v("d1", "draft", null)])).toEqual({ kind: "open", versionId: "d1" });
    expect(planDraftStart([v("v1", "revoked", 1), v("v2", "active", 2)])).toEqual({ kind: "create", from: "v2" });
  });

  it("refuses a revoked version while a newer one is in review", () => {
    expect(planDraftStart([v("v1", "revoked", 1), v("v2", "in_review", 2)])).toEqual({
      kind: "blocked",
      reason: "A newer version is in review.",
    });
  });

  it.each(["in_review", "changes_requested", "superseded"] as const)(
    "refuses when the only version is %s",
    (state) => {
      expect(planDraftStart([v("v1", state, 1)]).kind).toBe("blocked");
    },
  );

  it("refuses a template with no versions", () => {
    expect(planDraftStart([]).kind).toBe("blocked");
  });
});

describe("editLatest", () => {
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
    const { changes } = editLatest({ from: active, createdBy: "priya", now: NOW });
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
      // Whoever pressed Edit; the Active version's own writers don't carry over.
      writers: ["priya"],
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("keeps every block id, so comment threads and the redline stay anchored", () => {
    const { changes } = editLatest({ from: active, createdBy: "priya", now: NOW });
    const ids = (changes.draft.body.content ?? []).map((b) => b.attrs?.id);
    expect(ids).toEqual(["b_one", "b_two", "b_three", "b_four"]);
  });

  it("records which version number the draft is based on", () => {
    const { effects } = editLatest({ from: active, createdBy: "priya", now: NOW });
    expect(effects).toEqual([{ kind: "audit", action: "draft.started", details: { basedOn: 3 } }]);
  });

  it("copies, so editing the draft never changes the Active version", () => {
    const { changes } = editLatest({ from: active, createdBy: "priya", now: NOW });
    changes.draft.channels.push("pdf");
    changes.draft.variables[1]!.required = false;
    changes.draft.sampleSets[2]!.values.purchase_apr = "0.01";
    changes.draft.body.content![1]!.content![0]!.text = "Changed";
    expect(active.channels).toEqual(["pdf", "web", "email"]);
    expect(VARIABLES[1]!.required).toBe(true);
    expect(SAMPLE_SETS[2]!.values.purchase_apr).toBe("9.99");
    expect(BODY.content![1]!.content![0]!.text).toBe("Hi ");
  });

  it("copies a revoked version the same way: the corrected draft is based on it, with its block ids", () => {
    const revoked: VersionSnapshot = { ...active, id: "v_revoked", state: "revoked" };
    const { changes, effects } = editLatest({ from: revoked, createdBy: "maya", now: NOW });
    expect(changes.draft).toMatchObject({
      state: "draft",
      number: null,
      basedOnVersionId: "v_revoked",
      body: BODY,
      emailSubject: active.emailSubject,
      channels: ["pdf", "web", "email"],
      variables: VARIABLES,
      sampleSets: SAMPLE_SETS,
      contractChanges: null,
      createdBy: "maya",
    });
    expect((changes.draft.body.content ?? []).map((b) => b.attrs?.id)).toEqual(["b_one", "b_two", "b_three", "b_four"]);
    expect(effects).toEqual([{ kind: "audit", action: "draft.started", details: { basedOn: 3 } }]);
  });

  it.each(["draft", "in_review", "changes_requested", "superseded"] as const)(
    "refuses to copy a %s version",
    (state) => {
      expect(() => editLatest({ from: { ...active, state }, createdBy: "priya", now: NOW })).toThrow(
        LifecycleError,
      );
    },
  );
});

describe("contractBaseline", () => {
  const DAY = 86_400_000;
  const v = (id: string, state: VersionState, number: number | null, sunsetAt: Date | null = null) => ({
    id,
    state,
    number,
    sunsetAt,
  });
  const later = new Date(NOW.getTime() + 30 * DAY);
  const passed = new Date(NOW.getTime() - DAY);

  it("is the Active version when there is one, whatever is newer or older", () => {
    expect(
      contractBaseline([v("v1", "superseded", 1, later), v("v2", "active", 2), v("v3", "in_review", 3), v("d", "draft", null)], NOW)?.id,
    ).toBe("v2");
    expect(contractBaseline([v("v1", "revoked", 1), v("v2", "active", 2)], NOW)?.id).toBe("v2");
  });

  it("after the Active version is revoked, is the newest Superseded version that still renders", () => {
    const list = [v("v1", "superseded", 1, later), v("v2", "superseded", 2), v("v3", "revoked", 3), v("d", "draft", null)];
    expect(contractBaseline(list, NOW)?.id).toBe("v2");
  });

  it("skips a Superseded version whose sunset has passed, to the next newest that still renders", () => {
    const list = [v("v1", "superseded", 1, later), v("v2", "superseded", 2, passed), v("v3", "revoked", 3)];
    expect(contractBaseline(list, NOW)?.id).toBe("v1");
    // At the sunset's own instant it has passed, as the render rule says.
    expect(contractBaseline([v("v1", "superseded", 1, NOW), v("v2", "revoked", 2)], NOW)).toBeNull();
  });

  it("is null when nothing renders: no versions, only drafts, or everything revoked or past its sunset", () => {
    expect(contractBaseline([], NOW)).toBeNull();
    expect(contractBaseline([v("d", "draft", null)], NOW)).toBeNull();
    expect(contractBaseline([v("v1", "superseded", 1, passed), v("v2", "revoked", 2), v("d", "draft", null)], NOW)).toBeNull();
    expect(contractBaseline([v("v1", "changes_requested", 1), v("v2", "in_review", 2)], NOW)).toBeNull();
  });
});

describe("submit", () => {
  const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });
  const oneLine = (...inline: JSONContent[]): JSONContent => ({
    type: "doc",
    content: [{ type: "paragraph", content: inline }],
  });
  const text = (value: string): JSONContent => ({ type: "text", text: value });

  const draft: SubmitDraft = {
    state: "draft",
    variables: VARIABLES,
    body: BODY,
    emailSubject: null,
    emailPreheader: null,
    channels: ["pdf", "web"],
    writers: ["maya"],
    rev: 7,
  };
  const SUBMITTER = "maya";
  const run = (
    over: Partial<SubmitDraft> = {},
    extra: {
      highestNumber?: number;
      baseline?: Variable[] | null;
      note?: string | null;
      chain?: ApprovalStage[];
      seenRev?: number;
    } = {},
  ) =>
    submit({
      draft: { ...draft, ...over },
      seenRev: extra.seenRev ?? draft.rev,
      highestNumber: extra.highestNumber ?? 0,
      baseline: extra.baseline ?? null,
      now: NOW,
      submittedBy: SUBMITTER,
      submitterName: "Maya Chen",
      templateId: TEMPLATE.id,
      templateName: TEMPLATE.name,
      note: extra.note,
      chain: extra.chain ?? CHAIN_1,
    });

  const reviewRequested = (number: number, extra: { body?: string; to?: Recipients } = {}) => ({
    kind: "notification",
    notification: "review_requested",
    to: extra.to ?? { kind: "team_role", role: "approver", exceptUserIds: ["maya"] },
    title: `Maya Chen submitted Spring Travel Rewards — Terms v${number} for review.`,
    ...(extra.body ? { body: extra.body } : {}),
    link: { to: "review", templateId: TEMPLATE.id, versionNumber: number },
  });
  const submitted = (number: number, extra: { note?: string | null; contractChanges?: number; breaking?: boolean } = {}) => ({
    kind: "audit",
    action: "version.submitted",
    details: {
      number,
      note: extra.note ?? null,
      contractChanges: extra.contractChanges ?? 0,
      breaking: extra.breaking ?? false,
    },
  });

  it("makes a first draft v1, in review, at the first approval stage", () => {
    const result = run();
    expect(result).toEqual({
      ok: true,
      changes: {
        state: "in_review",
        number: 1,
        submittedBy: "maya",
        submittedAt: NOW,
        writers: ["maya"],
        submitNote: null,
        stages: [{ id: "st_team", name: "Team approver" }],
        currentStage: 0,
        contractChanges: null,
      },
      effects: [submitted(1), reviewRequested(1)],
    });
  });

  it("numbers the version one above the template's highest", () => {
    const result = run({}, { highestNumber: 4 });
    expect(result.ok && result.changes.number).toBe(5);
    expect(result.ok && result.effects).toEqual([submitted(5), reviewRequested(5)]);
  });

  it("keeps the note to reviewers, trimmed, and passes it on to them", () => {
    const result = run({}, { note: "  Adds the annual fee for the spring launch.\n" });
    expect(result.ok && result.changes.submitNote).toBe("Adds the annual fee for the spring launch.");
    expect(result.ok && result.effects).toEqual([
      submitted(1, { note: "Adds the annual fee for the spring launch." }),
      reviewRequested(1, { body: "Adds the annual fee for the spring launch." }),
    ]);
  });

  it.each([undefined, null, "", "   \n "])("stores no note when it is %j", (note) => {
    const result = run({}, { note });
    expect(result.ok && result.changes.submitNote).toBeNull();
    expect(result.ok && result.effects[1]).toEqual(reviewRequested(1));
  });

  it("asks the team's approvers to review, never the submitter", () => {
    const result = run();
    expect(result.ok && result.effects.filter((e) => e.kind === "notification")).toEqual([reviewRequested(1)]);
  });

  it("asks nobody who wrote the draft", () => {
    const allWriters: Recipients = { kind: "team_role", role: "approver", exceptUserIds: ["priya", "maya"] };
    expect(run({ writers: ["priya"] })).toMatchObject({ effects: [submitted(1), reviewRequested(1, { to: allWriters })] });
  });

  it("records the chain's stages in order, and asks whoever its first stage names", () => {
    const legalFirst: ApprovalStage[] = [
      { id: "st_team", position: 1, name: "Team approver", rule: { kind: "team_role", role: "approver" } },
      { id: "st_legal", position: 0, name: "Legal reviewer", rule: { kind: "user", userId: "dana" } },
    ];
    const result = run({}, { chain: legalFirst });
    expect(result).toMatchObject({
      effects: [submitted(1), reviewRequested(1, { to: { kind: "user", userId: "dana" } })],
    });
    expect(result.ok && result.changes.stages).toEqual([
      { id: "st_legal", name: "Legal reviewer" },
      { id: "st_team", name: "Team approver" },
    ]);
    expect(run({}, { chain: CHAIN_1 })).toMatchObject({ effects: [submitted(1), reviewRequested(1)] });
  });

  it("records how many contract changes there are, and whether any breaks", () => {
    const annualFee: Variable = { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" };
    const breaking = run({ variables: [...VARIABLES, annualFee] }, { baseline: VARIABLES });
    expect(breaking.ok && breaking.effects[0]).toEqual(submitted(1, { contractChanges: 1, breaking: true }));

    const relabelled = run({ variables: [{ ...VARIABLES[0]!, label: "Given name" }, VARIABLES[1]!] }, { baseline: VARIABLES });
    expect(relabelled.ok && relabelled.effects[0]).toEqual(submitted(1, { contractChanges: 1, breaking: false }));
  });

  it("records no contract changes when there is no Active version to compare with", () => {
    const result = run({ variables: [...VARIABLES, { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" }] });
    expect(result.ok && result.changes.contractChanges).toBeNull();
  });

  it("records the contract changes against the Active version's variables", () => {
    const annualFee: Variable = { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" };
    const result = run({ variables: [...VARIABLES, annualFee] }, { baseline: VARIABLES });
    expect(result.ok && result.changes.contractChanges).toEqual([
      { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true },
    ]);

    const unchanged = run({}, { baseline: VARIABLES });
    expect(unchanged.ok && unchanged.changes.contractChanges).toEqual([]);
  });

  it("refuses a draft that changed after the summary was read, before anything else", () => {
    expect(run({}, { seenRev: 6 })).toEqual({ ok: false, reason: REFUSALS.summaryStale });
    // Even when its content would be refused too: the author sees what changed first.
    const body: JSONContent = { type: "doc", content: [{ type: "paragraph", attrs: { id: "b_one" }, content: [chip("gift_name")] }] };
    expect(run({ body })).toEqual({ ok: false, reason: "Define or remove {{gift_name}} before submitting." });
    expect(run({ body }, { seenRev: 6 })).toEqual({ ok: false, reason: REFUSALS.summaryStale });
  });

  it("submits the draft the summary showed", () => {
    expect(run({ rev: 12 }, { seenRev: 12 })).toMatchObject({ ok: true, changes: { number: 1 } });
  });

  it.each(["in_review", "changes_requested", "active", "superseded", "revoked"] as const)(
    "refuses a %s version",
    (state) => {
      const result = run({ state });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toBe(
        state === "in_review" ? "This version is already in review." : "Only a draft can be submitted.",
      );
    },
  );

  it("names a chip in the document whose key isn't in the variable list", () => {
    const body: JSONContent = {
      type: "doc",
      content: [
        heading("b_one", "offer_details", "Offer details"),
        { type: "paragraph", attrs: { id: "b_two" }, content: [text("Use code "), chip("promo_code")] },
      ],
    };
    expect(run({ body })).toEqual({ ok: false, reason: "Define or remove {{promo_code}} before submitting." });
  });

  it("names every missing key once, in order of first use", () => {
    const body: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "b_one" }, content: [chip("promo_code"), chip("first_name"), chip("promo_code")] },
        { type: "paragraph", attrs: { id: "b_two" }, content: [chip("gift_name")] },
      ],
    };
    expect(run({ body })).toEqual({
      ok: false,
      reason: "Define or remove {{promo_code}} and {{gift_name}} before submitting.",
    });

    const more: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "b_one" }, content: [chip("a_one"), chip("b_two"), chip("c_three")] }],
    };
    expect(run({ body: more })).toEqual({
      ok: false,
      reason: "Define or remove {{a_one}}, {{b_two}} and {{c_three}} before submitting.",
    });
  });

  it("finds a missing key in a table cell, a list or a callout", () => {
    const nested: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { id: "t" },
          content: [
            {
              type: "tableRow",
              content: [{ type: "tableCell", content: [{ type: "paragraph", content: [chip("in_table")] }] }],
            },
          ],
        },
      ],
    };
    expect(run({ body: nested })).toEqual({ ok: false, reason: "Define or remove {{in_table}} before submitting." });
  });

  it("checks the email subject and preheader while Email is on", () => {
    const channels = ["pdf", "web", "email"] as const;
    const subject = oneLine(text("Hi "), chip("first_name"));

    expect(run({ channels: [...channels], emailSubject: oneLine(text("Offer "), chip("promo_code")) })).toEqual({
      ok: false,
      reason: "Define or remove {{promo_code}} before submitting.",
    });
    expect(run({ channels: [...channels], emailSubject: subject, emailPreheader: oneLine(chip("gift_name")) })).toEqual({
      ok: false,
      reason: "Define or remove {{gift_name}} before submitting.",
    });
    expect(run({ channels: [...channels], emailSubject: subject, emailPreheader: oneLine(chip("purchase_apr")) }).ok).toBe(true);
  });

  it("ignores the email fields while Email is off: they are not part of the output", () => {
    const result = run({ channels: ["pdf", "web"], emailSubject: oneLine(chip("promo_code")) });
    expect(result.ok).toBe(true);
  });

  it("asks for an email subject when Email is on and the subject is empty", () => {
    const reason = "Add an email subject before submitting.";
    const email = ["pdf", "web", "email"] as const;
    expect(run({ channels: [...email], emailSubject: null })).toEqual({ ok: false, reason });
    expect(run({ channels: [...email], emailSubject: oneLine() })).toEqual({ ok: false, reason });
    expect(run({ channels: [...email], emailSubject: { type: "doc", content: [{ type: "paragraph" }] } })).toEqual({
      ok: false,
      reason,
    });
    expect(run({ channels: [...email], emailSubject: oneLine(text("   ")) })).toEqual({ ok: false, reason });
  });

  it("accepts an email subject that is only a chip, and needs no preheader", () => {
    const result = run({ channels: ["email"], emailSubject: oneLine(chip("first_name")), emailPreheader: null });
    expect(result.ok).toBe(true);
  });

  it("doesn't need a subject when Email is off", () => {
    expect(run({ channels: ["pdf"], emailSubject: null }).ok).toBe(true);
  });

  it("reports an unknown key before the missing subject", () => {
    const body: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "b_one" }, content: [chip("promo_code")] }],
    };
    expect(run({ body, channels: ["email"], emailSubject: null })).toEqual({
      ok: false,
      reason: "Define or remove {{promo_code}} before submitting.",
    });
  });
});

// ── Review transitions ────────────────────────────────────────

const CHAIN_2: ApprovalStage[] = [
  ...CHAIN_1,
  { id: "st_legal", position: 1, name: "Legal reviewer", rule: { kind: "user", userId: "dana" } },
];
/** What a version submitted under each chain recorded. */
const STAGES_1: VersionStage[] = [{ id: "st_team", name: "Team approver" }];
const STAGES_2: VersionStage[] = [...STAGES_1, { id: "st_legal", name: "Legal reviewer" }];
const TOMORROW = new Date("2026-10-05T00:00:00.000Z");
const MARCH_1 = new Date("2027-03-01T00:00:00.000Z");
const REASON = "The APR in Rates and fees doesn't match the offer sheet.";
const REVOKE_REASON = "Wrong APR in legal notices";
const EMAIL_SUBJECT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Your offer" }] }],
};
const ANNUAL_FEE_ADDED: ContractChange = {
  kind: "added",
  key: "annual_fee",
  breaking: true,
  type: "currency",
  required: true,
};
const PENDING: RevokeRecord = { reason: REVOKE_REASON, startedBy: "jordan", startedAt: "2026-10-03T09:00:00.000Z" };
const CONFIRMED: RevokeRecord = { ...PENDING, confirmedBy: "alex", confirmedAt: "2026-10-03T10:00:00.000Z" };

const APPROVERS_BUT = (userId: string): Recipients => ({ kind: "team_role", role: "approver", exceptUserIds: [userId] });

function reviewVersion(over: Partial<ReviewVersion> = {}): ReviewVersion {
  return {
    id: "v_1",
    templateId: TEMPLATE.id,
    number: 1,
    state: "in_review",
    body: BODY,
    emailSubject: EMAIL_SUBJECT,
    emailPreheader: null,
    channels: ["pdf", "web", "email"],
    variables: VARIABLES,
    sampleSets: SAMPLE_SETS,
    submittedBy: "maya",
    writers: ["maya"],
    stages: null,
    currentStage: 0,
    contractChanges: null,
    sunsetAt: null,
    revoke: null,
    ...over,
  };
}

/** A version as it would be in a state: drafts have no number, a revoked one has a confirmed revoke. */
function inState(state: VersionState, over: Partial<ReviewVersion> = {}): ReviewVersion {
  return reviewVersion({
    state,
    number: state === "draft" ? null : 1,
    submittedBy: state === "draft" ? null : "maya",
    revoke: state === "revoked" ? CONFIRMED : null,
    ...over,
  });
}

const tryRequestChanges = (version: ReviewVersion) =>
  requestChanges({
    version,
    chain: CHAIN_1,
    actorId: "jordan",
    actorName: "Jordan Ellis",
    reason: REASON,
    now: NOW,
    templateName: TEMPLATE.name,
  });
const tryApprove = (version: ReviewVersion) =>
  approve({
    version,
    chain: CHAIN_1,
    actorId: "jordan",
    actorName: "Jordan Ellis",
    now: NOW,
    active: null,
    sunsetPrevious: null,
    sampleSetsSeen: ["typical"],
    templateName: TEMPLATE.name,
  });
const trySetSunset = (version: ReviewVersion) =>
  setSunset({ version, actorId: "jordan", now: NOW, sunsetAt: MARCH_1, activeNumber: 2, templateName: TEMPLATE.name });
const tryStartRevoke = (version: ReviewVersion) =>
  startRevoke({
    version,
    actorId: "jordan",
    actorName: "Jordan Ellis",
    reason: REVOKE_REASON,
    now: NOW,
    templateName: TEMPLATE.name,
  });
const tryConfirmRevoke = (version: ReviewVersion) =>
  confirmRevoke({ version, actorId: "alex", actorName: "Alex Kim", now: NOW, activeNumber: 2, templateName: TEMPLATE.name });
const tryCancelRevoke = (version: ReviewVersion) => cancelRevoke({ version, actorId: "alex", now: NOW });

describe("the transitions table: every review move from every state", () => {
  // `true` = allowed; otherwise the exact refusal. Confirm and cancel are tried with a revoke pending.
  const { notInReview, sunsetNotSuperseded, notRevocable, alreadyRevoked, noRevokePending } = REFUSALS;
  const TABLE: Record<string, { attempt: (v: ReviewVersion) => { ok: boolean }; pending?: true; to: Record<VersionState, true | string> }> = {
    "request changes": {
      attempt: tryRequestChanges,
      to: { draft: notInReview, in_review: true, changes_requested: notInReview, active: notInReview, superseded: notInReview, revoked: notInReview },
    },
    approve: {
      attempt: tryApprove,
      to: { draft: notInReview, in_review: true, changes_requested: notInReview, active: notInReview, superseded: notInReview, revoked: notInReview },
    },
    "set sunset": {
      attempt: trySetSunset,
      to: {
        draft: sunsetNotSuperseded,
        in_review: sunsetNotSuperseded,
        changes_requested: sunsetNotSuperseded,
        active: sunsetNotSuperseded,
        superseded: true,
        revoked: sunsetNotSuperseded,
      },
    },
    "start revoke": {
      attempt: tryStartRevoke,
      to: { draft: notRevocable, in_review: notRevocable, changes_requested: notRevocable, active: true, superseded: true, revoked: alreadyRevoked },
    },
    "confirm revoke": {
      attempt: tryConfirmRevoke,
      pending: true,
      to: { draft: noRevokePending, in_review: noRevokePending, changes_requested: noRevokePending, active: true, superseded: true, revoked: alreadyRevoked },
    },
    "cancel revoke": {
      attempt: tryCancelRevoke,
      pending: true,
      to: { draft: noRevokePending, in_review: noRevokePending, changes_requested: noRevokePending, active: true, superseded: true, revoked: alreadyRevoked },
    },
  };

  const cases = Object.entries(TABLE).flatMap(([move, row]) =>
    VERSION_STATES.map((state) => ({ move, state, row, expected: row.to[state] })),
  );

  it.each(cases)("$move from $state", ({ state, row, expected }) => {
    const version = inState(state, row.pending && state !== "revoked" ? { revoke: PENDING } : {});
    const result = row.attempt(version);
    if (expected === true) expect(result.ok).toBe(true);
    else expect(result).toEqual({ ok: false, reason: expected });
  });
});

describe("requestChanges", () => {
  const run = (over: Partial<Parameters<typeof requestChanges>[0]> = {}) =>
    requestChanges({
      version: reviewVersion(),
      chain: CHAIN_1,
      actorId: "jordan",
      actorName: "Jordan Ellis",
      reason: REASON,
      now: NOW,
      templateName: TEMPLATE.name,
      ...over,
    });

  it("sends the version back, records the decision, and leaves the author a new draft", () => {
    expect(run()).toEqual({
      ok: true,
      changes: { state: "changes_requested" },
      approval: {
        versionId: "v_1",
        stageId: "st_team",
        stagePosition: 0,
        stageName: "Team approver",
        actorId: "jordan",
        decision: "changes_requested",
        reason: REASON,
        sampleSetsSeen: null,
        decidedAt: NOW,
      },
      newDraft: {
        state: "draft",
        number: null,
        basedOnVersionId: "v_1",
        body: BODY,
        emailSubject: EMAIL_SUBJECT,
        emailPreheader: null,
        channels: ["pdf", "web", "email"],
        variables: VARIABLES,
        sampleSets: SAMPLE_SETS,
        contractChanges: null,
        currentStage: 0,
        rev: 0,
        createdBy: "maya",
        writers: ["maya"],
        createdAt: NOW,
        updatedAt: NOW,
      },
      reasonComment: { blockId: "doc", body: REASON, kind: "change_request" },
      effects: [
        {
          kind: "audit",
          action: "version.changes_requested",
          details: { number: 1, stage: "Team approver", reason: REASON },
        },
        {
          kind: "notification",
          notification: "changes_requested",
          to: { kind: "user", userId: "maya" },
          title: "Jordan Ellis requested changes on Spring Travel Rewards — Terms v1.",
          body: REASON,
          link: { to: "template", templateId: TEMPLATE.id },
        },
      ],
    });
  });

  it("keeps every block id in the new draft, so the review threads re-anchor in the editor", () => {
    const result = run();
    const ids = (result.ok ? (result.newDraft.body.content ?? []) : []).map((b) => b.attrs?.id);
    expect(ids).toEqual(["b_one", "b_two", "b_three", "b_four"]);
  });

  it("copies, so editing the new draft never changes the version under review", () => {
    const result = run();
    if (!result.ok) throw new Error(result.reason);
    result.newDraft.body.content![1]!.content![0]!.text = "Changed";
    result.newDraft.variables[0]!.label = "Changed";
    result.newDraft.sampleSets[0]!.values.first_name = "Changed";
    result.newDraft.emailSubject!.content![0]!.content![0]!.text = "Changed";
    expect(BODY.content![1]!.content![0]!.text).toBe("Hi ");
    expect(VARIABLES[0]!.label).toBe("First name");
    expect(SAMPLE_SETS[0]!.values.first_name).toBe("Maya");
    expect(EMAIL_SUBJECT.content![0]!.content![0]!.text).toBe("Your offer");
  });

  it("trims the reason before it becomes the comment", () => {
    const result = run({ reason: `  ${REASON}\n` });
    expect(result.ok && result.reasonComment.body).toBe(REASON);
    expect(result.ok && result.approval.reason).toBe(REASON);
  });

  it.each(["", "   ", "\n\t"])("refuses an empty reason (%j)", (reason) => {
    expect(run({ reason })).toEqual({ ok: false, reason: "Give a reason." });
  });

  it("refuses the submitter: nobody decides their own version", () => {
    expect(run({ actorId: "maya", actorName: "Maya Chen" })).toEqual({ ok: false, reason: REASONS.ownVersion });
  });

  it("refuses anyone else who wrote it: Priya edited Maya's draft, so she can't send it back", () => {
    const version = reviewVersion({ writers: ["maya", "priya"] });
    expect(run({ version, actorId: "priya", actorName: "Priya Raman" })).toEqual({
      ok: false,
      reason: REASONS.wroteVersion,
    });
    expect(run({ version }).ok, "Jordan wrote none of it").toBe(true);
  });

  it("hands the version's writers to the new draft, and not the approver who sent it back", () => {
    const result = run({ version: reviewVersion({ writers: ["maya", "priya"] }) });
    expect(result.ok && result.newDraft.writers).toEqual(["maya", "priya"]);
  });

  it("checks the state before who is asking", () => {
    expect(run({ version: reviewVersion({ state: "active" }), actorId: "maya" })).toEqual({
      ok: false,
      reason: "This version isn't in review.",
    });
  });

  it("records the stage that sent it back", () => {
    const result = run({ version: reviewVersion({ currentStage: 1 }), chain: CHAIN_2, actorId: "dana", actorName: "Dana Park" });
    expect(result.ok && result.approval).toMatchObject({ stagePosition: 1, stageName: "Legal reviewer", actorId: "dana" });
    expect(result.ok && result.effects[0]).toEqual({
      kind: "audit",
      action: "version.changes_requested",
      details: { number: 1, stage: "Legal reviewer", reason: REASON },
    });
  });

  it("records the stage of the version's own that sent it back, by id, after the chain was reordered and renamed", () => {
    const edited: ApprovalStage[] = [
      { ...CHAIN_2[1]!, position: 0, name: "Legal sign-off" },
      { ...CHAIN_2[0]!, position: 1 },
    ];
    const version = reviewVersion({ stages: STAGES_2, currentStage: 1 });
    const result = run({ version, chain: edited, actorId: "dana", actorName: "Dana Park" });
    expect(result.ok && result.approval).toMatchObject({ stageId: "st_legal", stagePosition: 1, stageName: "Legal reviewer" });
  });

  it("refuses when the chain has no stage for the version", () => {
    expect(run({ chain: [] })).toEqual({ ok: false, reason: "This version's approval stage no longer exists." });
    expect(run({ version: reviewVersion({ currentStage: 1 }) })).toEqual({
      ok: false,
      reason: "This version's approval stage no longer exists.",
    });
  });

  it("gives the draft to the approver, and notifies nobody, when no submitter is on record", () => {
    const result = run({ version: reviewVersion({ submittedBy: null }) });
    expect(result.ok && result.newDraft.createdBy).toBe("jordan");
    expect(result.ok && result.effects.map((e) => e.kind)).toEqual(["audit"]);
  });
});

describe("approve", () => {
  const v2 = reviewVersion({ id: "v_2", number: 2, contractChanges: [ANNUAL_FEE_ADDED] });
  const run = (over: Partial<Parameters<typeof approve>[0]> = {}) =>
    approve({
      version: v2,
      chain: CHAIN_1,
      actorId: "jordan",
      actorName: "Jordan Ellis",
      now: NOW,
      active: { id: "v_1", number: 1 },
      sunsetPrevious: null,
      sampleSetsSeen: ["typical", "long"],
      templateName: TEMPLATE.name,
      ...over,
    });

  const activated = (supersedes: number | null, stage = "Team approver") => ({
    kind: "audit",
    action: "version.activated",
    details: { number: 2, supersedes, stage },
  });
  const superseded = { kind: "audit", action: "version.superseded", versionId: "v_1", details: { number: 1, supersededBy: 2 } };
  const live = {
    kind: "notification",
    notification: "version_live",
    to: { kind: "user", userId: "maya" },
    title: "Spring Travel Rewards — Terms v2 is now Active.",
    body: "Jordan Ellis approved it.",
    link: { to: "template", templateId: TEMPLATE.id },
  };
  const newVersion = {
    kind: "consumer_notice",
    notice: "new_version",
    versionId: "v_2",
    payload: {
      versionNumber: 2,
      activeVersion: 2,
      contractChanges: [ANNUAL_FEE_ADDED],
      contractLines: ["v2 adds required `annual_fee` (Currency)."],
    },
  };

  it("makes the last stage's approval go live, and supersedes the previous Active version", () => {
    expect(run()).toEqual({
      ok: true,
      changes: { state: "active", currentStage: 0, activatedAt: NOW },
      approval: {
        versionId: "v_2",
        stageId: "st_team",
        stagePosition: 0,
        stageName: "Team approver",
        actorId: "jordan",
        decision: "approved",
        reason: null,
        sampleSetsSeen: ["typical", "long"],
        decidedAt: NOW,
      },
      previous: { id: "v_1", changes: { state: "superseded", supersededAt: NOW } },
      wentLive: true,
      effects: [activated(1), superseded, live, newVersion],
    });
  });

  it("sets the previous version's sunset in the same step, and tells its consumers", () => {
    const result = run({ sunsetPrevious: MARCH_1 });
    expect(result.ok && result.previous).toEqual({
      id: "v_1",
      changes: { state: "superseded", supersededAt: NOW, sunsetAt: MARCH_1, sunsetSetBy: "jordan" },
    });
    expect(result.ok && result.effects).toEqual([
      activated(1),
      superseded,
      {
        kind: "audit",
        action: "version.sunset_set",
        versionId: "v_1",
        details: { number: 1, sunsetAt: "2027-03-01T00:00:00.000Z", previousSunsetAt: null },
      },
      live,
      newVersion,
      {
        kind: "consumer_notice",
        notice: "sunset_scheduled",
        versionId: "v_1",
        payload: {
          versionNumber: 1,
          activeVersion: 2,
          sunsetAt: "2027-03-01T00:00:00.000Z",
          contractChanges: [ANNUAL_FEE_ADDED],
          contractLines: ["v2 adds required `annual_fee` (Currency)."],
        },
      },
    ]);
  });

  it("goes live with nothing to supersede when no version is Active", () => {
    const result = run({ active: null });
    expect(result.ok && "previous" in result).toBe(false);
    expect(result.ok && result.effects).toEqual([activated(null), live, newVersion]);
  });

  it("has nothing to sunset when no version is Active", () => {
    const result = run({ active: null, sunsetPrevious: MARCH_1 });
    expect(result.ok && "previous" in result).toBe(false);
    expect(result.ok && result.effects.map((e) => (e.kind === "audit" ? e.action : e.kind))).toEqual([
      "version.activated",
      "notification",
      "consumer_notice",
    ]);
  });

  it.each([
    ["later today", new Date("2026-10-04T23:00:00.000Z")],
    ["earlier today", new Date("2026-10-04T00:00:00.000Z")],
    ["in the past", new Date("2026-09-01T00:00:00.000Z")],
  ])("refuses a sunset date %s", (_, date) => {
    expect(run({ sunsetPrevious: date })).toEqual({ ok: false, reason: "Pick a date after today." });
  });

  it("accepts a sunset date of tomorrow", () => {
    expect(run({ sunsetPrevious: TOMORROW }).ok).toBe(true);
  });

  it("refuses the submitter: nobody approves their own version", () => {
    expect(run({ actorId: "maya", actorName: "Maya Chen" })).toEqual({ ok: false, reason: "You submitted this version." });
  });

  it("refuses anyone else who wrote it, even when someone else submitted it", () => {
    const version = { ...v2, writers: ["priya", "maya"] };
    expect(run({ version, actorId: "priya", actorName: "Priya Raman" })).toEqual({
      ok: false,
      reason: "You wrote part of this version.",
    });
    expect(run({ version }).ok, "Jordan wrote none of it").toBe(true);
  });

  it("records each sample set the approver saw once", () => {
    const result = run({ sampleSetsSeen: ["typical", "long", "typical"] });
    expect(result.ok && result.approval.sampleSetsSeen).toEqual(["typical", "long"]);
  });

  it("says nothing to a submitter who isn't on record", () => {
    const result = run({ version: { ...v2, submittedBy: null } });
    expect(result.ok && result.effects).toEqual([activated(1), superseded, newVersion]);
  });

  describe("with two stages", () => {
    it("moves the first stage's approval on to the next stage, and asks it to review", () => {
      expect(run({ chain: CHAIN_2 })).toEqual({
        ok: true,
        changes: { state: "in_review", currentStage: 1, activatedAt: null },
        approval: {
          versionId: "v_2",
          stageId: "st_team",
          stagePosition: 0,
          stageName: "Team approver",
          actorId: "jordan",
          decision: "approved",
          reason: null,
          sampleSetsSeen: ["typical", "long"],
          decidedAt: NOW,
        },
        wentLive: false,
        effects: [
          {
            kind: "audit",
            action: "version.stage_approved",
            details: { number: 2, stage: "Team approver", stagePosition: 0, next: "Legal reviewer" },
          },
          {
            kind: "notification",
            notification: "review_requested",
            to: { kind: "user", userId: "dana" },
            title: "Spring Travel Rewards — Terms v2 is waiting on Legal reviewer.",
            link: { to: "review", templateId: TEMPLATE.id, versionNumber: 2 },
          },
          {
            kind: "notification",
            notification: "stage_approved",
            to: { kind: "user", userId: "maya" },
            title: "Jordan Ellis approved Spring Travel Rewards — Terms v2 for Team approver.",
            body: "Next: Legal reviewer.",
            link: { to: "review", templateId: TEMPLATE.id, versionNumber: 2 },
          },
        ],
      });
    });

    it("doesn't supersede or sunset anything before the last stage", () => {
      const result = run({ chain: CHAIN_2, sunsetPrevious: MARCH_1 });
      expect(result.ok && result.wentLive).toBe(false);
      expect(result.ok && "previous" in result).toBe(false);
      expect(result.ok && result.effects.some((e) => e.kind === "consumer_notice")).toBe(false);
    });

    it("goes live at the second stage", () => {
      const result = run({ chain: CHAIN_2, version: { ...v2, currentStage: 1 }, actorId: "dana", actorName: "Dana Park" });
      expect(result.ok && result.wentLive).toBe(true);
      expect(result.ok && result.changes).toEqual({ state: "active", currentStage: 1, activatedAt: NOW });
      expect(result.ok && result.approval).toMatchObject({ stagePosition: 1, stageName: "Legal reviewer", actorId: "dana" });
      expect(result.ok && result.effects[0]).toEqual(activated(1, "Legal reviewer"));
    });

    it("follows the stages' positions, whatever order the chain arrives in", () => {
      const result = run({ chain: [...CHAIN_2].reverse() });
      expect(result.ok && result.approval.stageName).toBe("Team approver");
      expect(result.ok && result.changes.currentStage).toBe(1);
    });

    it("asks a team-role stage's approvers, never the submitter or whoever approved a stage of this round", () => {
      const teamSecond: ApprovalStage[] = [
        { id: "st_legal", position: 0, name: "Legal reviewer", rule: { kind: "user", userId: "dana" } },
        { id: "st_team", position: 1, name: "Team approver", rule: { kind: "team_role", role: "approver" } },
      ];
      const result = run({ chain: teamSecond, actorId: "dana", actorName: "Dana Park" });
      expect(result.ok && result.effects[1]).toMatchObject({
        notification: "review_requested",
        to: { kind: "team_role", role: "approver", exceptUserIds: ["maya", "dana"] },
        title: "Spring Travel Rewards — Terms v2 is waiting on Team approver.",
      });

      const coWritten = run({ chain: teamSecond, version: { ...v2, writers: ["priya", "maya"] }, actorId: "dana", actorName: "Dana Park" });
      expect(coWritten.ok && coWritten.effects[1]).toMatchObject({
        notification: "review_requested",
        to: { kind: "team_role", role: "approver", exceptUserIds: ["priya", "maya", "dana"] },
      });
    });

    it("asks nobody when the next stage names someone who already approved a stage of this round", () => {
      // Three stages, Jordan named on the third; he approved the first (rules swapped since, say).
      const three: ApprovalStage[] = [
        ...CHAIN_2,
        { id: "st_final", position: 2, name: "Final sign-off", rule: { kind: "user", userId: "jordan" } },
      ];
      const version = { ...v2, currentStage: 1 };
      const result = run({
        chain: three,
        version,
        actorId: "dana",
        actorName: "Dana Park",
        decisions: [{ stageId: "st_team", actorId: "jordan", decision: "approved" }],
      });
      expect(result.ok && result.changes.currentStage).toBe(2);
      expect(result.ok && result.effects.filter((e) => e.kind === "notification").map((e) => e.notification)).toEqual(["stage_approved"]);
    });

    it("refuses someone who approved an earlier stage of the same round", () => {
      const second = { ...v2, currentStage: 1 };
      const twoTeamStages: ApprovalStage[] = [
        { id: "st_team", position: 0, name: "Team approver", rule: { kind: "team_role", role: "approver" } },
        { id: "st_second", position: 1, name: "Second approver", rule: { kind: "team_role", role: "approver" } },
      ];
      const approvedTeam = (actorId: string) => [{ stageId: "st_team", actorId, decision: "approved" as const }];
      expect(run({ chain: twoTeamStages, version: second, decisions: approvedTeam("jordan") })).toEqual({
        ok: false,
        reason: "You approved an earlier stage.",
      });
      expect(REFUSALS.approvedEarlierStage).toBe("You approved an earlier stage.");
      expect(run({ chain: twoTeamStages, version: second, decisions: approvedTeam("alex") }).ok).toBe(true);
      expect(run({ chain: twoTeamStages, version: second, decisions: [] }).ok).toBe(true);
    });
  });

  // Finding D3: the version goes through the stages it recorded at submit, whatever the chain becomes.
  describe("after the chain is edited mid-review", () => {
    const DANA_APPROVED_LEGAL = [{ stageId: "st_legal", actorId: "dana", decision: "approved" as const }];
    const LEGAL_FIRST: VersionStage[] = [STAGES_2[1]!, STAGES_2[0]!];

    it("a reorder doesn't send it back to a stage it passed: Jordan's Team approval makes it Active", () => {
      // Submitted under [Legal, Team]; Dana approved Legal; the chain is now [Team, Legal].
      const version = { ...v2, stages: LEGAL_FIRST, currentStage: 1 };
      const result = run({ chain: CHAIN_2, version, decisions: DANA_APPROVED_LEGAL });
      expect(result.ok && result.changes).toEqual({ state: "active", currentStage: 1, activatedAt: NOW });
      expect(result.ok && result.approval).toMatchObject({ stageId: "st_team", stagePosition: 1, stageName: "Team approver" });
    });

    it("an inserted stage isn't added to it, and it still waits on the stage it was at", () => {
      const compliance: ApprovalStage = { id: "st_comp", position: 0, name: "Compliance", rule: { kind: "user", userId: "naomi" } };
      const inserted = [compliance, ...CHAIN_2.map((s) => ({ ...s, position: s.position + 1 }))];
      const atTeam = run({ chain: inserted, version: { ...v2, stages: STAGES_2, currentStage: 0 } });
      expect(atTeam.ok && atTeam.changes).toEqual({ state: "in_review", currentStage: 1, activatedAt: null });
      expect(atTeam.ok && atTeam.effects[0]).toMatchObject({ details: { stage: "Team approver", next: "Legal reviewer" } });

      const atLegal = run({ chain: inserted, version: { ...v2, stages: STAGES_2, currentStage: 1 }, actorId: "dana", actorName: "Dana Park" });
      expect(atLegal.ok && atLegal.wentLive).toBe(true);
      expect(atLegal.ok && atLegal.approval).toMatchObject({ stageId: "st_legal", stageName: "Legal reviewer" });
    });

    it("a stage's new rule reaches it: the stage's own name, whoever the chain names now", () => {
      const naomiOnLegal = CHAIN_2.map((s) => (s.id === "st_legal" ? { ...s, name: "Legal sign-off", rule: { kind: "user" as const, userId: "naomi" } } : s));
      const result = run({ chain: naomiOnLegal, version: { ...v2, stages: STAGES_2 } });
      expect(result.ok && result.effects[1]).toMatchObject({
        notification: "review_requested",
        to: { kind: "user", userId: "naomi" },
        title: "Spring Travel Rewards — Terms v2 is waiting on Legal reviewer.",
      });
    });

    it("on migrated data, an approval matched to the stage it waits on still bars its approver", () => {
      // Before stage ids: chain [Team1, Team2], Jordan approved Team1, an admin removed Team1 and the
      // version moved to position 0. The 0005 backfill then matched Jordan's position-0 approval to Team2.
      const team2: ApprovalStage = { id: "st_team2", position: 0, name: "Second approver", rule: { kind: "team_role", role: "approver" } };
      const version = { ...v2, stages: [{ id: "st_team2", name: "Second approver" }], currentStage: 0 };
      const decisions = [{ stageId: "st_team2", actorId: "jordan", decision: "approved" as const }];
      expect(run({ chain: [team2], version, decisions })).toEqual({ ok: false, reason: REFUSALS.approvedEarlierStage });
      expect(run({ chain: [team2], version, decisions, actorId: "alex", actorName: "Alex Kim" }).ok).toBe(true);
    });

    it("a version that recorded Release 1's default stage stays decidable once the content type has a chain", () => {
      const version = { ...v2, stages: [{ id: "default", name: "Team approver" }], currentStage: 0 };
      const result = run({ chain: CHAIN_2, version });
      expect(result.ok && result.wentLive).toBe(true);
      expect(result.ok && result.approval).toMatchObject({ stageId: "default", stageName: "Team approver" });
    });

    it("refuses when the stage it waits on, or the next one, has left the chain", () => {
      const missing = { ok: false, reason: "This version's approval stage no longer exists." };
      expect(run({ chain: [CHAIN_2[1]!], version: { ...v2, stages: STAGES_2 } })).toEqual(missing);
      expect(run({ chain: CHAIN_1, version: { ...v2, stages: STAGES_2 } })).toEqual(missing);
    });
  });

  it("refuses when the chain has no stage for the version", () => {
    expect(run({ version: { ...v2, currentStage: 1 } })).toEqual({
      ok: false,
      reason: "This version's approval stage no longer exists.",
    });
  });
});

describe("setSunset", () => {
  const v1 = reviewVersion({ state: "superseded", submittedBy: "priya" });
  const run = (over: Partial<Parameters<typeof setSunset>[0]> = {}) =>
    setSunset({
      version: v1,
      actorId: "jordan",
      now: NOW,
      sunsetAt: MARCH_1,
      activeNumber: 2,
      templateName: "Balance Transfer Intro",
      ...over,
    });

  it("schedules the sunset and tells the consumers and the version's author", () => {
    expect(run()).toEqual({
      ok: true,
      changes: { sunsetAt: MARCH_1, sunsetSetBy: "jordan" },
      effects: [
        {
          kind: "audit",
          action: "version.sunset_set",
          details: { number: 1, sunsetAt: "2027-03-01T00:00:00.000Z", previousSunsetAt: null },
        },
        {
          kind: "consumer_notice",
          notice: "sunset_scheduled",
          versionId: "v_1",
          payload: { versionNumber: 1, activeVersion: 2, sunsetAt: "2027-03-01T00:00:00.000Z" },
        },
        {
          kind: "notification",
          notification: "sunset_scheduled",
          to: { kind: "user", userId: "priya" },
          title: "Balance Transfer Intro v1 will stop rendering on March 1, 2027.",
          link: { to: "versions", templateId: TEMPLATE.id },
        },
      ],
    });
  });

  it("moves an existing sunset, earlier or later, and records the old date", () => {
    const scheduled = { ...v1, sunsetAt: new Date("2026-10-25T00:00:00.000Z") };
    for (const sunsetAt of [TOMORROW, MARCH_1]) {
      const result = run({ version: scheduled, sunsetAt });
      expect(result.ok && result.changes.sunsetAt).toEqual(sunsetAt);
      expect(result.ok && result.effects[0]).toEqual({
        kind: "audit",
        action: "version.sunset_set",
        details: { number: 1, sunsetAt: sunsetAt.toISOString(), previousSunsetAt: "2026-10-25T00:00:00.000Z" },
      });
    }
  });

  it.each([
    ["today", new Date("2026-10-04T00:00:00.000Z")],
    ["later today", new Date("2026-10-04T18:00:00.000Z")],
    ["in the past", new Date("2026-01-01T00:00:00.000Z")],
  ])("refuses a date %s", (_, sunsetAt) => {
    expect(run({ sunsetAt })).toEqual({ ok: false, reason: "Pick a date after today." });
  });

  it("sends the contract changes consumers will meet on the Active version, when given", () => {
    const result = run({ contractChanges: [ANNUAL_FEE_ADDED] });
    expect(result.ok && result.effects[1]).toEqual({
      kind: "consumer_notice",
      notice: "sunset_scheduled",
      versionId: "v_1",
      payload: {
        versionNumber: 1,
        activeVersion: 2,
        sunsetAt: "2027-03-01T00:00:00.000Z",
        contractChanges: [ANNUAL_FEE_ADDED],
        contractLines: ["v2 adds required `annual_fee` (Currency)."],
      },
    });
  });

  it("doesn't notify the author when they set it", () => {
    const result = run({ actorId: "priya" });
    expect(result.ok && result.effects.map((e) => e.kind)).toEqual(["audit", "consumer_notice"]);
  });

  it("moves a sunset that is still to come, even one due at the next midnight", () => {
    const scheduled = { ...v1, sunsetAt: TOMORROW };
    const result = run({ version: scheduled, sunsetAt: MARCH_1 });
    expect(result.ok && result.changes).toEqual({ sunsetAt: MARCH_1, sunsetSetBy: "jordan" });
  });

  // A version past its sunset has stopped rendering and its consumers have moved on: a new date would
  // make it render again.
  it.each([
    ["the day before", new Date("2026-10-03T00:00:00.000Z")],
    ["earlier today", new Date("2026-10-04T00:00:00.000Z")],
    ["this very instant", NOW],
  ])("refuses any new date once the sunset has passed (%s)", (_, passed) => {
    const sunset = { ...v1, sunsetAt: passed };
    for (const sunsetAt of [TOMORROW, MARCH_1]) {
      expect(run({ version: sunset, sunsetAt })).toEqual({
        ok: false,
        reason: "This version's sunset has passed. It can't render again.",
      });
    }
  });

  it("says the version isn't Superseded before it says the sunset passed", () => {
    const revoked = { ...v1, state: "revoked" as const, sunsetAt: new Date("2026-10-03T00:00:00.000Z") };
    expect(run({ version: revoked })).toEqual({ ok: false, reason: REFUSALS.sunsetNotSuperseded });
  });
});

describe("startRevoke", () => {
  const run = (over: Partial<Parameters<typeof startRevoke>[0]> = {}) =>
    startRevoke({
      version: reviewVersion({ state: "superseded", submittedBy: "priya" }),
      actorId: "jordan",
      actorName: "Jordan Ellis",
      reason: REVOKE_REASON,
      now: NOW,
      templateName: "Balance Transfer Intro",
      ...over,
    });

  it("starts a revoke that waits for a second approver", () => {
    expect(run()).toEqual({
      ok: true,
      changes: { revoke: { reason: REVOKE_REASON, startedBy: "jordan", startedAt: "2026-10-04T12:00:00.000Z" } },
      effects: [
        { kind: "audit", action: "version.revoke_started", details: { number: 1, reason: REVOKE_REASON } },
        {
          kind: "notification",
          notification: "revoke_started",
          to: APPROVERS_BUT("jordan"),
          title: "Jordan Ellis started revoking Balance Transfer Intro v1. Confirm or cancel.",
          body: REVOKE_REASON,
          link: { to: "versions", templateId: TEMPLATE.id },
        },
      ],
    });
  });

  it("works on the Active version too", () => {
    expect(run({ version: reviewVersion({ state: "active" }) }).ok).toBe(true);
  });

  it("refuses while another revoke is waiting for confirmation", () => {
    expect(run({ version: reviewVersion({ state: "superseded", revoke: PENDING }), actorId: "alex" })).toEqual({
      ok: false,
      reason: "A revoke is already waiting for confirmation.",
    });
  });

  it.each(["", "  ", "\n"])("refuses an empty reason (%j)", (reason) => {
    expect(run({ reason })).toEqual({ ok: false, reason: "Give a reason." });
  });

  it("trims the reason", () => {
    const result = run({ reason: `  ${REVOKE_REASON} ` });
    expect(result.ok && result.changes.revoke.reason).toBe(REVOKE_REASON);
  });
});

describe("confirmRevoke", () => {
  const superseded = reviewVersion({ state: "superseded", submittedBy: "priya", revoke: PENDING });
  const run = (over: Partial<Parameters<typeof confirmRevoke>[0]> = {}) =>
    confirmRevoke({
      version: superseded,
      actorId: "alex",
      actorName: "Alex Kim",
      now: NOW,
      activeNumber: 2,
      templateName: "Balance Transfer Intro",
      ...over,
    });
  const notice = (activeVersion: number | null) => ({
    kind: "consumer_notice",
    notice: "revoked",
    versionId: "v_1",
    payload: { versionNumber: 1, activeVersion, reason: REVOKE_REASON },
  });
  const revoked = (to: Recipients) => ({
    kind: "notification",
    notification: "version_revoked",
    to,
    title: "Alex Kim confirmed the revoke of Balance Transfer Intro v1.",
    body: REVOKE_REASON,
    link: { to: "versions", templateId: TEMPLATE.id },
  });

  it("revokes, filling in who confirmed it and when, and tells consumers and the team", () => {
    expect(run()).toEqual({
      ok: true,
      changes: {
        state: "revoked",
        revoke: { ...PENDING, confirmedBy: "alex", confirmedAt: "2026-10-04T12:00:00.000Z" },
      },
      effects: [
        {
          kind: "audit",
          action: "version.revoked",
          details: { number: 1, reason: REVOKE_REASON, startedBy: "jordan", wasActive: false },
        },
        notice(2),
        revoked(APPROVERS_BUT("alex")),
        revoked({ kind: "user", userId: "priya" }),
      ],
    });
  });

  it("refuses the approver who started it: a different approver must confirm", () => {
    expect(run({ actorId: "jordan", actorName: "Jordan Ellis" })).toEqual({
      ok: false,
      reason: "You started this revoke. Another approver must confirm it.",
    });
  });

  it("leaves no Active version when it revokes the Active one: nothing is reinstated", () => {
    const result = run({ version: { ...superseded, state: "active" }, activeNumber: 1 });
    expect(result.ok && Object.keys(result).sort()).toEqual(["changes", "effects", "ok"]);
    expect(result.ok && result.changes.state).toBe("revoked");
    expect(result.ok && result.effects[0]).toMatchObject({ details: { wasActive: true } });
    expect(result.ok && result.effects[1]).toEqual(notice(null));
  });

  it("refuses when nothing is waiting for confirmation", () => {
    expect(run({ version: { ...superseded, revoke: null } })).toEqual({
      ok: false,
      reason: "There's no revoke waiting for confirmation.",
    });
    expect(run({ version: { ...superseded, state: "revoked", revoke: CONFIRMED } })).toEqual({
      ok: false,
      reason: "This version is already revoked.",
    });
  });

  it("notifies only the approvers when no author is on record", () => {
    const result = run({ version: { ...superseded, submittedBy: null } });
    expect(result.ok && result.effects.filter((e) => e.kind === "notification")).toEqual([revoked(APPROVERS_BUT("alex"))]);
  });
});

describe("cancelRevoke", () => {
  const pending = reviewVersion({ state: "superseded", revoke: PENDING });
  const cancelled = (ownRevoke: boolean) => ({
    ok: true,
    changes: { revoke: null },
    effects: [
      {
        kind: "audit",
        action: "version.revoke_cancelled",
        details: { number: 1, reason: REVOKE_REASON, startedBy: "jordan", ownRevoke },
      },
    ],
  });

  // Any approver may cancel: the starter (a mistake) or another one (the "Confirm or cancel" they were
  // sent). Cancelling keeps the version rendering, so it needs no second person.
  it("lets the approver who started it cancel", () => {
    expect(cancelRevoke({ version: pending, actorId: "jordan", now: NOW })).toEqual(cancelled(true));
  });

  it("lets another approver cancel", () => {
    expect(cancelRevoke({ version: pending, actorId: "alex", now: NOW })).toEqual(cancelled(false));
  });

  it("refuses when nothing is waiting, or the revoke is already confirmed", () => {
    expect(cancelRevoke({ version: { ...pending, revoke: null }, actorId: "alex", now: NOW })).toEqual({
      ok: false,
      reason: "There's no revoke waiting for confirmation.",
    });
    expect(cancelRevoke({ version: { ...pending, state: "revoked", revoke: CONFIRMED }, actorId: "alex", now: NOW })).toEqual({
      ok: false,
      reason: "This version is already revoked.",
    });
  });

  it("allows a new revoke afterwards", () => {
    const result = cancelRevoke({ version: pending, actorId: "alex", now: NOW });
    if (!result.ok) throw new Error(result.reason);
    expect(tryStartRevoke({ ...pending, ...result.changes }).ok).toBe(true);
  });
});

describe("review helpers", () => {
  it("revokePending: started and not yet confirmed", () => {
    expect(revokePending({ revoke: null })).toBe(false);
    expect(revokePending({ revoke: PENDING })).toBe(true);
    expect(revokePending({ revoke: CONFIRMED })).toBe(false);
  });

  it("sunsetPassed: a sunset at or before now (the instant renders start failing)", () => {
    expect(sunsetPassed({ sunsetAt: null }, NOW)).toBe(false);
    expect(sunsetPassed({ sunsetAt: TOMORROW }, NOW)).toBe(false);
    expect(sunsetPassed({ sunsetAt: new Date(NOW.getTime() + 1) }, NOW)).toBe(false);
    expect(sunsetPassed({ sunsetAt: NOW }, NOW)).toBe(true);
    expect(sunsetPassed({ sunsetAt: new Date("2026-10-04T00:00:00.000Z") }, NOW)).toBe(true);
  });

  it("isAfterToday: a later UTC day than now", () => {
    expect(isAfterToday(TOMORROW, NOW)).toBe(true);
    expect(isAfterToday(new Date("2026-10-04T23:59:59.000Z"), NOW)).toBe(false);
    expect(isAfterToday(new Date("2026-10-03T00:00:00.000Z"), NOW)).toBe(false);
  });

  it("throws, rather than refuses, on a reviewed version with no number (a data bug)", () => {
    expect(() => tryApprove(reviewVersion({ number: null }))).toThrow(LifecycleError);
  });
});

// ── The demo scenarios, end to end through the rules ─────────

describe("scenario 3: the review loop", () => {
  it("submit v1, changes requested, resubmit as v2, approve: v2 is Active", () => {
    const draft: SubmitDraft = {
      state: "draft",
      variables: VARIABLES,
      body: BODY,
      emailSubject: null,
      emailPreheader: null,
      channels: ["pdf", "web"],
      writers: ["maya"],
      rev: 3,
    };
    const base = { now: NOW, submittedBy: "maya", submitterName: "Maya Chen", templateId: TEMPLATE.id, templateName: TEMPLATE.name, chain: CHAIN_1 };

    const first = submit({ ...base, draft, seenRev: 3, highestNumber: 0, baseline: null });
    if (!first.ok) throw new Error(first.reason);
    const v1 = reviewVersion({ ...first.changes, id: "v_1" });

    // Maya can't approve her own version; Jordan sends it back.
    expect(approve({ ...approveArgs(v1), actorId: "maya" })).toEqual({ ok: false, reason: REASONS.ownVersion });
    const returned = tryRequestChanges(v1);
    if (!returned.ok) throw new Error(returned.reason);
    expect(returned.newDraft.basedOnVersionId).toBe("v_1");

    const second = submit({ ...base, draft: { ...returned.newDraft }, seenRev: returned.newDraft.rev, highestNumber: 1, baseline: null });
    if (!second.ok) throw new Error(second.reason);
    expect(second.changes.number).toBe(2);

    const approved = approve(approveArgs(reviewVersion({ ...second.changes, id: "v_2" })));
    expect(approved).toMatchObject({ ok: true, wentLive: true, changes: { state: "active" } });
  });

  function approveArgs(version: ReviewVersion): Parameters<typeof approve>[0] {
    return {
      version,
      chain: CHAIN_1,
      actorId: "jordan",
      actorName: "Jordan Ellis",
      now: NOW,
      active: null,
      sunsetPrevious: null,
      sampleSetsSeen: ["typical"],
      templateName: TEMPLATE.name,
    };
  }
});

// Maker-checker reaches everyone who wrote the version, not only whoever pressed Submit. Priya holds
// Author and Approver on Coral Offers (an access request can add the role).
describe("maker-checker: nobody decides a version they wrote", () => {
  const submitAs = (draft: SubmitDraft, submittedBy: string, highestNumber: number) => {
    const result = submit({
      draft,
      seenRev: draft.rev,
      highestNumber,
      baseline: null,
      now: NOW,
      submittedBy,
      submitterName: submittedBy,
      templateId: TEMPLATE.id,
      templateName: TEMPLATE.name,
      chain: CHAIN_1,
    });
    if (!result.ok) throw new Error(result.reason);
    return reviewVersion({ ...draft, ...result.changes, id: `v_${result.changes.number}` });
  };
  const decide = (version: ReviewVersion, actorId: string) => ({
    approve: approve({
      version,
      chain: CHAIN_1,
      actorId,
      actorName: actorId,
      now: NOW,
      active: null,
      sunsetPrevious: null,
      sampleSetsSeen: [],
      templateName: TEMPLATE.name,
    }),
    requestChanges: requestChanges({
      version,
      chain: CHAIN_1,
      actorId,
      actorName: actorId,
      reason: REASON,
      now: NOW,
      templateName: TEMPLATE.name,
    }),
  });
  const wrote = { ok: false, reason: REASONS.wroteVersion };

  const starter = { key: "card_offer_terms", name: "Card offer terms", body: BODY, variables: VARIABLES, sampleSets: SAMPLE_SETS };

  it("a new template's writer is whoever made it", () => {
    expect(createDraft({ starter, createdBy: "maya", now: NOW }).changes.draft.writers).toEqual(["maya"]);
  });

  it("withWriter adds a person once, keeping the order they first wrote in", () => {
    expect(withWriter(["maya"], "priya")).toEqual(["maya", "priya"]);
    expect(withWriter(["maya", "priya"], "maya")).toEqual(["maya", "priya"]);
  });

  it("Priya edits Maya's draft and Maya submits it: Priya can neither approve nor send it back; Jordan can", () => {
    const { draft } = createDraft({ starter, createdBy: "maya", now: NOW }).changes;
    const edited = { ...draft, writers: withWriter(draft.writers, "priya") };
    const v1 = submitAs(edited, "maya", 0);
    expect(v1.writers).toEqual(["maya", "priya"]);

    expect(decide(v1, "priya")).toEqual({ approve: wrote, requestChanges: wrote });
    expect(decide(v1, "maya").approve).toEqual({ ok: false, reason: REASONS.ownVersion });
    expect(decide(v1, "jordan").approve.ok).toBe(true);
  });

  it("Priya started the draft and someone else submitted it: she can't decide it", () => {
    const active = { ...reviewVersion({ state: "active" }), writers: ["eli"] };
    const { draft } = editLatest({ from: active, createdBy: "priya", now: NOW }).changes;
    const v2 = submitAs({ ...draft, writers: withWriter(draft.writers, "maya") }, "maya", 1);
    expect(decide(v2, "priya")).toEqual({ approve: wrote, requestChanges: wrote });
  });

  it("writers carry across a change request; the approver who sent it back can approve the next round", () => {
    const { draft } = createDraft({ starter, createdBy: "maya", now: NOW }).changes;
    const v1 = submitAs({ ...draft, writers: withWriter(draft.writers, "priya") }, "maya", 0);

    const returned = decide(v1, "jordan").requestChanges;
    if (!returned.ok) throw new Error(returned.reason);
    expect(returned.newDraft.writers, "Jordan isn't a writer for asking").toEqual(["maya", "priya"]);

    // Maya fixes it alone and resubmits: Priya wrote round one, so round two isn't hers to decide either.
    const v2 = submitAs({ ...returned.newDraft, writers: withWriter(returned.newDraft.writers, "maya") }, "maya", 1);
    expect(decide(v2, "priya")).toEqual({ approve: wrote, requestChanges: wrote });
    expect(decide(v2, "jordan").approve).toMatchObject({ ok: true, wentLive: true });
  });

  it("whoever submitted round one stays barred from round two, even without editing", () => {
    const { draft } = createDraft({ starter, createdBy: "maya", now: NOW }).changes;
    const v1 = submitAs(draft, "priya", 0);
    expect(v1.writers).toEqual(["maya", "priya"]);

    const returned = decide(v1, "jordan").requestChanges;
    if (!returned.ok) throw new Error(returned.reason);
    const v2 = submitAs({ ...returned.newDraft, writers: withWriter(returned.newDraft.writers, "maya") }, "maya", 1);
    expect(v2.submittedBy).toBe("maya");
    expect(decide(v2, "priya")).toEqual({ approve: wrote, requestChanges: wrote });
  });

  it("the approver who sent it back becomes a writer only by editing the next round", () => {
    const { draft } = createDraft({ starter, createdBy: "maya", now: NOW }).changes;
    const v1 = submitAs(draft, "maya", 0);
    const returned = decide(v1, "priya").requestChanges;
    if (!returned.ok) throw new Error(returned.reason);

    const v2 = submitAs({ ...returned.newDraft, writers: withWriter(returned.newDraft.writers, "priya") }, "maya", 1);
    expect(decide(v2, "priya")).toEqual({ approve: wrote, requestChanges: wrote });
  });

  it("a draft from the Active version starts afresh: writing v1 doesn't keep anyone from deciding v2", () => {
    const active = { ...reviewVersion({ state: "active" }), writers: ["maya", "priya"] };
    const { draft } = editLatest({ from: active, createdBy: "maya", now: NOW }).changes;
    const v2 = submitAs(draft, "maya", 1);
    expect(v2.writers).toEqual(["maya"]);
    expect(decide(v2, "priya").approve.ok).toBe(true);
  });
});

describe("scenario 6: two-person revoke", () => {
  it("Jordan starts, can't confirm; Alex confirms", () => {
    const v1 = reviewVersion({ state: "superseded", submittedBy: "priya" });
    const started = tryStartRevoke(v1);
    if (!started.ok) throw new Error(started.reason);
    const pending = { ...v1, ...started.changes };

    expect(confirmRevoke({ version: pending, actorId: "jordan", actorName: "Jordan Ellis", now: NOW, activeNumber: 2, templateName: "x" })).toEqual({
      ok: false,
      reason: REASONS.ownRevoke,
    });
    const confirmed = tryConfirmRevoke(pending);
    expect(confirmed).toMatchObject({ ok: true, changes: { state: "revoked", revoke: { startedBy: "jordan", confirmedBy: "alex" } } });
  });
});
