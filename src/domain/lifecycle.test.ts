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
  reviewBaseline,
  revokePending,
  setSunset,
  startRevoke,
  submit,
  sunsetPassed,
  sweepSunsets,
  withWriter,
  newTemplateChannels,
  newTemplateContentType,
  type ReviewVersion,
  type SunsetFacts,
  type StarterContent,
  type SubmitDraft,
  type VersionSnapshot,
} from "./lifecycle";
import { REASONS } from "./permissions";
import type { MessageTypeRules } from "./platform-config";
import type { Refusal } from "./refusals";
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
/** A document's content type: no SMS footer, the default part budget (never read for a document). */
const NO_MESSAGE_RULES: MessageTypeRules = { smsFooter: null, smsMaxParts: 3 };

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

// A template is a document or an alert for life: its content type is one family (decision 0033).
describe("newTemplateContentType", () => {
  const disclosure = { id: "ct_disclosure", name: "Disclosure", allowedChannels: ["pdf", "web", "email"] as const };
  const notice = { id: "ct_notice", name: "Notice", allowedChannels: ["pdf"] as const };
  const alert = { id: "ct_alert", name: "Alert", allowedChannels: ["push", "sms"] as const };

  it("makes a document on the document content type, and an alert on the message one", () => {
    expect(newTemplateContentType("document", [disclosure, alert])).toEqual({ ok: true, contentType: disclosure });
    expect(newTemplateContentType("message", [disclosure, alert])).toEqual({ ok: true, contentType: alert });
  });

  it("takes the first by name when several content types are of the family", () => {
    expect(newTemplateContentType("document", [notice, alert, disclosure])).toEqual({ ok: true, contentType: disclosure });
  });

  it("refuses a family no content type is of, naming the kind", () => {
    expect(newTemplateContentType("message", [disclosure, notice])).toEqual({
      ok: false,
      code: "no_content_type",
      reason: "No content type makes alerts yet.",
    });
    expect(newTemplateContentType("document", [alert])).toMatchObject({ reason: "No content type makes documents yet." });
    expect(newTemplateContentType("document", [])).toMatchObject({ ok: false, code: REFUSALS.noContentType.code });
  });
});

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
      starterKey: "card_offer_terms",
      createdBy: "maya",
      createdAt: NOW,
    });
    expect(changes.draft).toMatchObject({
      state: "draft",
      number: null,
      basedOnVersionId: null,
      name: "Card offer terms",
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
    expect(changes.draft.channels).toEqual([...DEFAULT_CHANNELS.document]);
    expect(changes.draft.channels).not.toContain("email");
    expect(changes.draft.channelFields).toEqual({});

    const subject: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
    const withEmail = createDraft({
      starter: { ...EXAMPLE, channels: ["pdf", "web", "email"], channelFields: { email: { subject, preheader: subject } } },
      createdBy: "maya",
      now: NOW,
    });
    expect(withEmail.changes.draft.channels).toEqual(["pdf", "web", "email"]);
    expect(withEmail.changes.draft.channelFields).toEqual({ email: { subject, preheader: subject } });
  });

  it("fits a new template's channels to its content type's family (newTemplateChannels)", () => {
    // A document type: the wanted ones it allows, else PDF and Web, else its first.
    expect(newTemplateChannels(undefined, ["pdf", "web", "email"])).toEqual(["pdf", "web"]);
    expect(newTemplateChannels(["pdf", "web", "email"], ["pdf", "email"])).toEqual(["pdf", "email"]);
    expect(newTemplateChannels(undefined, ["email"])).toEqual(["email"]);
    // A message type (an Alert): Push and SMS, whatever a document starter wanted.
    expect(newTemplateChannels(undefined, ["push", "sms"])).toEqual(["push", "sms"]);
    expect(newTemplateChannels(["pdf", "web"], ["push", "sms"])).toEqual(["push", "sms"]);
    expect(newTemplateChannels(undefined, ["sms"])).toEqual(["sms"]);
    expect(newTemplateChannels(["sms"], ["push", "sms"])).toEqual(["sms"]);
  });

  it("makes Blank untitled, with no starter key and no variables", () => {
    const { changes, effects } = createDraft({ starter: BLANK, createdBy: "maya", now: NOW });
    expect(changes.draft.name).toBe(UNTITLED_TEMPLATE_NAME);
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
    ).toEqual({ kind: "blocked", ...REFUSALS.newerInReview });
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
      ...REFUSALS.newerInReview,
    });
  });

  it.each(["in_review", "changes_requested", "superseded"] as const)(
    "refuses when the only version is %s",
    (state) => {
      const refusal = state === "in_review" ? REFUSALS.newerInReview : REFUSALS.notEditable;
      expect(planDraftStart([v("v1", state, 1)])).toEqual({ kind: "blocked", ...refusal });
    },
  );

  it("refuses a template with no versions", () => {
    expect(planDraftStart([])).toEqual({ kind: "blocked", ...REFUSALS.notEditable });
  });
});

describe("editLatest", () => {
  const active: VersionSnapshot = {
    id: "v_active",
    number: 3,
    state: "active",
    name: "Spring Travel Rewards — Terms",
    body: BODY,
    channelFields: { email: { subject: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Subject" }] }] } } },
    channels: ["pdf", "web", "email"],
    variables: VARIABLES,
    sampleSets: SAMPLE_SETS,
  };

  it("copies the name, body, variables, channels, channel fields and sample sets into a draft", () => {
    const { changes } = editLatest({ from: active, createdBy: "priya", now: NOW });
    expect(changes.draft).toEqual({
      state: "draft",
      number: null,
      basedOnVersionId: "v_active",
      name: "Spring Travel Rewards — Terms",
      body: BODY,
      channelFields: active.channelFields,
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
      channelFields: active.channelFields,
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

describe("reviewBaseline", () => {
  const DAY = 86_400_000;
  const v = (id: string, state: VersionState, number: number | null, basedOnVersionId: string | null = null, sunsetAt: Date | null = null) => ({
    id,
    state,
    number,
    sunsetAt,
    basedOnVersionId,
  });
  const later = new Date(NOW.getTime() + 30 * DAY);
  const passed = new Date(NOW.getTime() - DAY);

  it("is the Active version when there is one, whatever the version was based on; none on the Active version itself", () => {
    const list = [v("v1", "revoked", 1), v("v2", "active", 2, "v1"), v("v3", "in_review", 3, "v1")];
    expect(reviewBaseline(list, "v3", NOW)?.id).toBe("v2");
    expect(reviewBaseline(list, "v1", NOW)?.id, "an older record is compared with the Active version, as before").toBe("v2");
    expect(reviewBaseline(list, "v2", NOW)).toBeNull();
  });

  it("after a revoke, is the revoked version the correction started from, not the newest that still renders", () => {
    const list = [v("v1", "superseded", 1, null, later), v("v2", "revoked", 2, "v1"), v("v3", "in_review", 3, "v2")];
    expect(reviewBaseline(list, "v3", NOW)).toMatchObject({ id: "v2", state: "revoked", number: 2 });
    // The same when the Active version is revoked while its correction is in review.
    expect(reviewBaseline([v("v1", "revoked", 1), v("v2", "in_review", 2, "v1")], "v2", NOW)?.id).toBe("v1");
  });

  it("walks back through change-request rounds to the revoked version they all correct", () => {
    const list = [
      v("v2", "revoked", 2),
      v("v3", "changes_requested", 3, "v2"),
      v("v4", "changes_requested", 4, "v3"),
      v("v5", "in_review", 5, "v4"),
    ];
    expect(reviewBaseline(list, "v5", NOW)?.id).toBe("v2");
  });

  it("falls back to the newest version that still renders when the based-on version is missing", () => {
    const superseded = v("v1", "superseded", 1, null, later);
    expect(reviewBaseline([superseded, v("v2", "revoked", 2), v("v3", "in_review", 3)], "v3", NOW)?.id, "no based-on version").toBe("v1");
    expect(reviewBaseline([superseded, v("v3", "in_review", 3, "v_gone")], "v3", NOW)?.id, "a based-on row that's gone").toBe("v1");
    expect(reviewBaseline([superseded, v("v3", "in_review", 3, "v3")], "v3", NOW)?.id, "never the version itself").toBe("v1");
  });

  it("is null for a first version, a change-request round of one, or when nothing renders", () => {
    expect(reviewBaseline([v("v1", "in_review", 1)], "v1", NOW)).toBeNull();
    expect(reviewBaseline([v("v1", "changes_requested", 1), v("v2", "in_review", 2, "v1")], "v2", NOW), "nothing was ever released").toBeNull();
    expect(reviewBaseline([v("v1", "superseded", 1, null, passed), v("v2", "revoked", 2), v("v3", "in_review", 3)], "v3", NOW)).toBeNull();
    // The version is itself the newest that still renders: nothing to compare it with.
    expect(reviewBaseline([v("v1", "superseded", 1, null, later), v("v2", "revoked", 2)], "v1", NOW)).toBeNull();
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
    channelFields: {},
    channels: ["pdf", "web"],
    sampleSets: SAMPLE_SETS,
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
      messageRules?: MessageTypeRules;
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
      messageRules: extra.messageRules ?? NO_MESSAGE_RULES,
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

  it("records a renamed variable as one key_renamed, from the identity it keeps as its id (D8)", () => {
    const apr: Variable = { ...VARIABLES[1]!, id: "purchase_apr", key: "apr" };
    const result = run({ variables: [VARIABLES[0]!, apr] }, { baseline: VARIABLES });
    expect(result.ok && result.changes.contractChanges).toEqual([
      { kind: "key_renamed", key: "apr", breaking: true, from: "purchase_apr", to: "apr" },
    ]);
    expect(result.ok && result.effects[0]).toEqual(submitted(1, { contractChanges: 1, breaking: true }));
  });

  it("refuses a draft that changed after the summary was read, before anything else", () => {
    expect(run({}, { seenRev: 6 })).toEqual({ ok: false, ...REFUSALS.summaryStale });
    // Even when its content would be refused too: the author sees what changed first.
    const body: JSONContent = { type: "doc", content: [{ type: "paragraph", attrs: { id: "b_one" }, content: [chip("gift_name")] }] };
    expect(run({ body })).toEqual({ ok: false, code: "undefined_variables", reason: "Define or remove {{gift_name}} before submitting." });
    expect(run({ body }, { seenRev: 6 })).toEqual({ ok: false, ...REFUSALS.summaryStale });
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
    expect(run({ body })).toEqual({ ok: false, code: "undefined_variables", reason: "Define or remove {{promo_code}} before submitting." });
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
      code: "undefined_variables",
      reason: "Define or remove {{promo_code}} and {{gift_name}} before submitting.",
    });

    const more: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "b_one" }, content: [chip("a_one"), chip("b_two"), chip("c_three")] }],
    };
    expect(run({ body: more })).toEqual({
      ok: false,
      code: "undefined_variables",
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
    expect(run({ body: nested })).toEqual({ ok: false, code: "undefined_variables", reason: "Define or remove {{in_table}} before submitting." });
  });

  it("checks the email subject and preheader while Email is on", () => {
    const channels = ["pdf", "web", "email"] as const;
    const subject = oneLine(text("Hi "), chip("first_name"));

    expect(run({ channels: [...channels], channelFields: { email: { subject: oneLine(text("Offer "), chip("promo_code")) } } })).toEqual({
      ok: false,
      code: "undefined_variables",
      reason: "Define or remove {{promo_code}} before submitting.",
    });
    expect(run({ channels: [...channels], channelFields: { email: { subject, preheader: oneLine(chip("gift_name")) } } })).toEqual({
      ok: false,
      code: "undefined_variables",
      reason: "Define or remove {{gift_name}} before submitting.",
    });
    expect(run({ channels: [...channels], channelFields: { email: { subject, preheader: oneLine(chip("purchase_apr")) } } }).ok).toBe(true);
  });

  it("ignores the email fields while Email is off: they are not part of the output", () => {
    const result = run({ channels: ["pdf", "web"], channelFields: { email: { subject: oneLine(chip("promo_code")) } } });
    expect(result.ok).toBe(true);
  });

  it("asks for an email subject when Email is on and the subject is empty", () => {
    const reason = "Add an email subject before submitting.";
    const email = ["pdf", "web", "email"] as const;
    expect(run({ channels: [...email], channelFields: {} })).toEqual({ ok: false, code: "field_missing", reason });
    expect(run({ channels: [...email], channelFields: { email: { preheader: oneLine(text("Pre")) } } })).toEqual({ ok: false, code: "field_missing", reason });
    expect(run({ channels: [...email], channelFields: { email: { subject: oneLine() } } })).toEqual({ ok: false, code: "field_missing", reason });
    expect(run({ channels: [...email], channelFields: { email: { subject: { type: "doc", content: [{ type: "paragraph" }] } } } })).toEqual({
      ok: false,
      code: "field_missing",
      reason,
    });
    expect(run({ channels: [...email], channelFields: { email: { subject: oneLine(text("   ")) } } })).toEqual({ ok: false, code: "field_missing", reason });
  });

  it("accepts an email subject that is only a chip, and needs no preheader", () => {
    const result = run({ channels: ["email"], channelFields: { email: { subject: oneLine(chip("first_name")) } } });
    expect(result.ok).toBe(true);
  });

  it("doesn't need a subject when Email is off", () => {
    expect(run({ channels: ["pdf"], channelFields: {} }).ok).toBe(true);
  });

  // ── A message (an Alert): Push and SMS (decisions 0033 and 0034) ──
  describe("a message", () => {
    const ALERT: MessageTypeRules = { smsFooter: "Coral Offers: Reply STOP to opt out, HELP for help.", smsMaxParts: 3 };
    const lines = (...inline: JSONContent[]): JSONContent => oneLine(...inline);
    const push = {
      title: oneLine(text("Your APR changes soon")),
      body: oneLine(text("Hi "), chip("first_name"), text(", your purchase APR becomes "), chip("purchase_apr"), text(".")),
    };
    const sms = { text: lines(text("Coral Offers: your APR becomes "), chip("purchase_apr"), text("."), { type: "hardBreak" }, text("coral.example/apr")) };
    const alert = (over: Partial<SubmitDraft> = {}, rules: MessageTypeRules = ALERT) =>
      run({ body: { type: "doc", content: [{ type: "paragraph" }] }, channels: ["push", "sms"], channelFields: { push, sms }, ...over }, { messageRules: rules });

    it("submits a push and an SMS that keep every rule", () => {
      expect(alert().ok).toBe(true);
    });

    it("needs every required field of each channel that is on, from the registry", () => {
      expect(alert({ channelFields: { push: { body: push.body }, sms } })).toEqual({
        ok: false,
        code: "field_missing",
        reason: "Add a push title before submitting.",
      });
      expect(alert({ channelFields: { push } })).toEqual({ ok: false, code: "field_missing", reason: "Add an SMS message before submitting." });
      // The subtitle is optional, and SMS's fields don't matter while SMS is off.
      expect(alert({ channels: ["push"], channelFields: { push } }).ok).toBe(true);
    });

    it("counts a field of only invisible characters as blank: the phone shows nothing for it", () => {
      // A message's field keeps its invisible characters (an emoji's joiner), so one can hold only those.
      const invisible = oneLine(text(" ​⁠ "));
      expect(alert({ channelFields: { push: { ...push, title: invisible }, sms } })).toEqual({
        ok: false,
        code: "field_missing",
        reason: "Add a push title before submitting.",
      });
      expect(alert({ channelFields: { push: { ...push, title: oneLine(text("❤️")) }, sms } }).ok).toBe(true);
    });

    it("refuses a zero-width space or a joiner the author typed in an SMS: they aren't GSM-7", () => {
      expect(alert({ channelFields: { push, sms: { text: lines(text("Pay​ now")) } } })).toEqual({
        ok: false,
        code: "sms_characters",
        reason: "Replace U+200B in the SMS message before submitting. It isn't in the SMS character set.",
      });
    });

    it("refuses characters the author typed outside GSM-7, naming each once", () => {
      const typed = { text: lines(text("Your card’s APR – it’s changing. Reply"), chip("first_name")) };
      expect(alert({ channelFields: { push, sms: typed } })).toEqual({
        ok: false,
        code: "sms_characters",
        reason: "Replace ’, – and U+00A0 in the SMS message before submitting. They aren't in the SMS character set.",
      });
      expect(alert({ channelFields: { push, sms: { text: lines(text("Façade")) } } })).toEqual({
        ok: false,
        code: "sms_characters",
        reason: "Replace ç in the SMS message before submitting. It isn't in the SMS character set.",
      });
      // Ç is GSM-7, and so is é; a value is never checked (it can switch a message to UCS-2).
      expect(alert({ channelFields: { push, sms: { text: lines(text("Ç é "), chip("first_name")) } } }).ok).toBe(true);
    });

    it("refuses an SMS over the content type's parts with the long sample values, footer included", () => {
      const long = { text: lines(text("x".repeat(120)), chip("first_name")) };
      // 120 + 21 (the long first name) + a line break + the footer's 51: 193 septets, 2 parts.
      expect(alert({ channelFields: { push, sms: long } }).ok).toBe(true);
      expect(alert({ channelFields: { push, sms: long } }, { ...ALERT, smsMaxParts: 1 })).toEqual({
        ok: false,
        code: "sms_too_many_parts",
        reason: "With the long sample values, the SMS is 2 parts. Keep it to 1 part or fewer.",
      });
      // Without the long set, its defaults stand in.
      expect(alert({ channelFields: { push, sms: long }, sampleSets: [] }, { ...ALERT, smsMaxParts: 1 }).ok).toBe(false);
    });

    it("refuses a public link shortener in an SMS or a push body", () => {
      const shortened = { text: lines(text("Pay at https://bit.ly/3xYz or tinyurl.com/a")) };
      expect(alert({ channelFields: { push, sms: shortened } })).toEqual({
        ok: false,
        code: "public_shortener",
        reason: "The SMS message links through bit.ly and tinyurl.com, public link shorteners carriers filter. Use a link on your own domain.",
      });
      const body = oneLine(text("See bit.ly/"), chip("first_name"));
      expect(alert({ channelFields: { push: { ...push, body }, sms } })).toEqual({
        ok: false,
        code: "public_shortener",
        reason: "The push body links through bit.ly, a public link shortener carriers filter. Use a link on your own domain.",
      });
      // A branded domain is fine; a title isn't checked.
      expect(alert({ channelFields: { push: { ...push, title: oneLine(text("bit.ly/x")) }, sms } }).ok).toBe(true);
    });

    it("refuses a push over 4,096 bytes on either platform with the long sample values", () => {
      const huge = oneLine(text("é".repeat(2100)));
      expect(alert({ channelFields: { push: { ...push, body: huge }, sms } })).toEqual({
        ok: false,
        code: "push_too_large",
        reason: "With the long sample values, the push is 4,261 bytes on iPhone. It can be at most 4,096 bytes.",
      });
      // The subtitle is iPhone's alone: it can tip iPhone over while Android fits.
      const subtitle = oneLine(text("é".repeat(100)));
      const near = oneLine(text("é".repeat(1950)));
      const result = alert({ channels: ["push"], channelFields: { push: { ...push, body: near, subtitle } } });
      expect(result).toMatchObject({ ok: false, code: "push_too_large" });
      expect(result.ok || result.reason).toContain("on iPhone");
    });

    it("never runs the message rules on a document", () => {
      const typed = { text: lines(text("’")) };
      expect(run({ channels: ["pdf"], channelFields: { sms: typed } }, { messageRules: ALERT }).ok).toBe(true);
    });
  });

  it("reports an unknown key before the missing subject", () => {
    const body: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "b_one" }, content: [chip("promo_code")] }],
    };
    expect(run({ body, channels: ["email"], channelFields: {} })).toEqual({
      ok: false,
      code: "undefined_variables",
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
// A sunset date is a calendar day that ends at 00:00 in the business time zone (decision 0017): the
// days as the picker sends them, and the instants they end at in New York.
const ZONE = "America/New_York";
const TOMORROW_DAY = "2026-10-05";
const TOMORROW = new Date("2026-10-05T04:00:00.000Z"); // 00:00 EDT
const MARCH_1_DAY = "2027-03-01";
const MARCH_1 = new Date("2027-03-01T05:00:00.000Z"); // 00:00 EST
/** 23:30 Eastern on October 4, when it is already October 5 in UTC. */
const LATE_EVENING = new Date("2026-10-05T03:30:00.000Z");
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
    name: TEMPLATE.name,
    body: BODY,
    channelFields: { email: { subject: EMAIL_SUBJECT } },
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
    zone: ZONE,
    sampleSetsSeen: ["typical"],
    templateName: TEMPLATE.name,
  });
const trySetSunset = (version: ReviewVersion) =>
  setSunset({ version, actorId: "jordan", now: NOW, sunsetDay: MARCH_1_DAY, zone: ZONE, activeNumber: 2, templateName: TEMPLATE.name });
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
  const TABLE: Record<string, { attempt: (v: ReviewVersion) => { ok: boolean }; pending?: true; to: Record<VersionState, true | Refusal> }> = {
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
    else expect(result).toEqual({ ok: false, ...expected });
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
        name: TEMPLATE.name,
        body: BODY,
        channelFields: { email: { subject: EMAIL_SUBJECT } },
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

  it("carries the version's name into the new draft, a rename included", () => {
    const result = run({ version: reviewVersion({ name: "Spring Travel Rewards — Card Terms" }) });
    expect(result.ok && result.newDraft.name).toBe("Spring Travel Rewards — Card Terms");
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
    result.newDraft.channelFields.email!.subject!.content![0]!.content![0]!.text = "Changed";
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
    expect(run({ reason })).toEqual({ ok: false, code: "reason_missing", reason: "Give a reason." });
  });

  it("refuses the submitter: nobody decides their own version", () => {
    expect(run({ actorId: "maya", actorName: "Maya Chen" })).toEqual({ ok: false, ...REASONS.ownVersion });
  });

  it("refuses anyone else who wrote it: Priya edited Maya's draft, so she can't send it back", () => {
    const version = reviewVersion({ writers: ["maya", "priya"] });
    expect(run({ version, actorId: "priya", actorName: "Priya Raman" })).toEqual({
      ok: false,
      ...REASONS.wroteVersion,
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
      code: "not_in_review",
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
    expect(run({ chain: [] })).toEqual({ ok: false, code: "stage_missing", reason: "This version's approval stage no longer exists." });
    expect(run({ version: reviewVersion({ currentStage: 1 }) })).toEqual({
      ok: false,
      code: "stage_missing",
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
      zone: ZONE,
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

  it("sets the previous version's sunset in the same step, at 00:00 Eastern that day, and tells its consumers", () => {
    const result = run({ sunsetPrevious: MARCH_1_DAY });
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
        details: { number: 1, sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01", zone: ZONE, previousSunsetAt: null },
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
          sunsetAt: "2027-03-01T05:00:00.000Z",
          sunsetDay: "2027-03-01",
          zone: ZONE,
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
    const result = run({ active: null, sunsetPrevious: MARCH_1_DAY });
    expect(result.ok && "previous" in result).toBe(false);
    expect(result.ok && result.effects.map((e) => (e.kind === "audit" ? e.action : e.kind))).toEqual([
      "version.activated",
      "notification",
      "consumer_notice",
    ]);
  });

  it.each([
    ["today", "2026-10-04"],
    ["in the past", "2026-09-01"],
  ])("refuses a sunset date %s", (_, day) => {
    expect(run({ sunsetPrevious: day })).toEqual({ ok: false, code: "sunset_not_after_today", reason: "Pick a date after today." });
  });

  it("accepts a sunset date of tomorrow", () => {
    expect(run({ sunsetPrevious: TOMORROW_DAY }).ok).toBe(true);
  });

  it("reads today in the business time zone: at 23:30 Eastern, tomorrow is still tomorrow", () => {
    expect(run({ now: LATE_EVENING, sunsetPrevious: TOMORROW_DAY }).ok).toBe(true);
    expect(run({ now: LATE_EVENING, sunsetPrevious: "2026-10-04" })).toEqual({ ok: false, code: "sunset_not_after_today", reason: "Pick a date after today." });
    // In UTC it is already the 5th there, so the 5th isn't after today.
    expect(run({ now: LATE_EVENING, sunsetPrevious: TOMORROW_DAY, zone: "UTC" })).toEqual({
      ok: false,
      code: "sunset_not_after_today",
      reason: "Pick a date after today.",
    });
  });

  it("refuses the submitter: nobody approves their own version", () => {
    expect(run({ actorId: "maya", actorName: "Maya Chen" })).toEqual({ ok: false, code: "submitted_version", reason: "You submitted this version." });
  });

  it("refuses anyone else who wrote it, even when someone else submitted it", () => {
    const version = { ...v2, writers: ["priya", "maya"] };
    expect(run({ version, actorId: "priya", actorName: "Priya Raman" })).toEqual({
      ok: false,
      code: "wrote_version",
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
      const result = run({ chain: CHAIN_2, sunsetPrevious: MARCH_1_DAY });
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
        code: "approved_earlier_stage",
        reason: "You approved an earlier stage.",
      });
      expect(REFUSALS.approvedEarlierStage.reason).toBe("You approved an earlier stage.");
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
      expect(run({ chain: [team2], version, decisions })).toEqual({ ok: false, ...REFUSALS.approvedEarlierStage });
      expect(run({ chain: [team2], version, decisions, actorId: "alex", actorName: "Alex Kim" }).ok).toBe(true);
    });

    it("a version that recorded Release 1's default stage stays decidable once the content type has a chain", () => {
      const version = { ...v2, stages: [{ id: "default", name: "Team approver" }], currentStage: 0 };
      const result = run({ chain: CHAIN_2, version });
      expect(result.ok && result.wentLive).toBe(true);
      expect(result.ok && result.approval).toMatchObject({ stageId: "default", stageName: "Team approver" });
    });

    it("refuses when the stage it waits on, or the next one, has left the chain", () => {
      const missing = { ok: false, code: "stage_missing", reason: "This version's approval stage no longer exists." };
      expect(run({ chain: [CHAIN_2[1]!], version: { ...v2, stages: STAGES_2 } })).toEqual(missing);
      expect(run({ chain: CHAIN_1, version: { ...v2, stages: STAGES_2 } })).toEqual(missing);
    });
  });

  it("refuses when the chain has no stage for the version", () => {
    expect(run({ version: { ...v2, currentStage: 1 } })).toEqual({
      ok: false,
      code: "stage_missing",
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
      sunsetDay: MARCH_1_DAY,
      zone: ZONE,
      activeNumber: 2,
      templateName: "Balance Transfer Intro",
      ...over,
    });

  it("schedules the sunset at 00:00 Eastern on the day, and tells the consumers and the version's author", () => {
    expect(run()).toEqual({
      ok: true,
      changes: { sunsetAt: MARCH_1, sunsetSetBy: "jordan" },
      effects: [
        {
          kind: "audit",
          action: "version.sunset_set",
          details: { number: 1, sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01", zone: ZONE, previousSunsetAt: null },
        },
        {
          kind: "consumer_notice",
          notice: "sunset_scheduled",
          versionId: "v_1",
          payload: { versionNumber: 1, activeVersion: 2, sunsetAt: "2027-03-01T05:00:00.000Z", sunsetDay: "2027-03-01", zone: ZONE },
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
    const scheduled = { ...v1, sunsetAt: new Date("2026-10-25T04:00:00.000Z") };
    for (const [sunsetDay, sunsetAt] of [
      [TOMORROW_DAY, TOMORROW],
      [MARCH_1_DAY, MARCH_1],
    ] as const) {
      const result = run({ version: scheduled, sunsetDay });
      expect(result.ok && result.changes.sunsetAt).toEqual(sunsetAt);
      expect(result.ok && result.effects[0]).toEqual({
        kind: "audit",
        action: "version.sunset_set",
        details: { number: 1, sunsetAt: sunsetAt.toISOString(), sunsetDay, zone: ZONE, previousSunsetAt: "2026-10-25T04:00:00.000Z" },
      });
    }
  });

  it("ends the day at 00:00 in the zone, across a DST change", () => {
    // 2026-11-01: clocks go back at 02:00, so its midnight is still EDT; the next day's is EST.
    expect(run({ sunsetDay: "2026-11-01" })).toMatchObject({ changes: { sunsetAt: new Date("2026-11-01T04:00:00.000Z") } });
    expect(run({ sunsetDay: "2026-11-02" })).toMatchObject({ changes: { sunsetAt: new Date("2026-11-02T05:00:00.000Z") } });
    expect(run({ sunsetDay: "2026-11-02", zone: "UTC" })).toMatchObject({ changes: { sunsetAt: new Date("2026-11-02T00:00:00.000Z") } });
  });

  it.each([
    ["today", "2026-10-04"],
    ["in the past", "2026-01-01"],
  ])("refuses a date %s", (_, sunsetDay) => {
    expect(run({ sunsetDay })).toEqual({ ok: false, code: "sunset_not_after_today", reason: "Pick a date after today." });
  });

  it("reads today in the business time zone: at 23:30 Eastern, tomorrow is still tomorrow", () => {
    expect(run({ now: LATE_EVENING, sunsetDay: TOMORROW_DAY })).toMatchObject({ ok: true, changes: { sunsetAt: TOMORROW } });
    expect(run({ now: LATE_EVENING, sunsetDay: "2026-10-04" })).toEqual({ ok: false, code: "sunset_not_after_today", reason: "Pick a date after today." });
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
        sunsetAt: "2027-03-01T05:00:00.000Z",
        sunsetDay: "2027-03-01",
        zone: ZONE,
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
    const result = run({ version: scheduled, sunsetDay: MARCH_1_DAY });
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
    for (const sunsetDay of [TOMORROW_DAY, MARCH_1_DAY]) {
      expect(run({ version: sunset, sunsetDay })).toEqual({
        ok: false,
        code: "sunset_passed",
        reason: "This version's sunset has passed. It can't render again.",
      });
    }
  });

  it("says the version isn't Superseded before it says the sunset passed", () => {
    const revoked = { ...v1, state: "revoked" as const, sunsetAt: new Date("2026-10-03T00:00:00.000Z") };
    expect(run({ version: revoked })).toEqual({ ok: false, ...REFUSALS.sunsetNotSuperseded });
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
      code: "revoke_pending",
      reason: "A revoke is already waiting for confirmation.",
    });
  });

  it.each(["", "  ", "\n"])("refuses an empty reason (%j)", (reason) => {
    expect(run({ reason })).toEqual({ ok: false, code: "reason_missing", reason: "Give a reason." });
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
      code: "own_revoke",
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
      code: "no_revoke_pending",
      reason: "There's no revoke waiting for confirmation.",
    });
    expect(run({ version: { ...superseded, state: "revoked", revoke: CONFIRMED } })).toEqual({
      ok: false,
      code: "already_revoked",
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
      code: "no_revoke_pending",
      reason: "There's no revoke waiting for confirmation.",
    });
    expect(cancelRevoke({ version: { ...pending, state: "revoked", revoke: CONFIRMED }, actorId: "alex", now: NOW })).toEqual({
      ok: false,
      code: "already_revoked",
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

  it("isAfterToday: a later day than today in the business time zone", () => {
    expect(isAfterToday(TOMORROW_DAY, NOW, ZONE)).toBe(true);
    expect(isAfterToday("2026-10-04", NOW, ZONE)).toBe(false);
    expect(isAfterToday("2026-10-03", NOW, ZONE)).toBe(false);
    // 23:30 Eastern on October 4 (03:30 UTC on the 5th): the 5th is after today in New York, not in UTC.
    expect(isAfterToday(TOMORROW_DAY, LATE_EVENING, ZONE)).toBe(true);
    expect(isAfterToday(TOMORROW_DAY, LATE_EVENING, "UTC")).toBe(false);
  });

  it("throws, rather than refuses, on a reviewed version with no number (a data bug)", () => {
    expect(() => tryApprove(reviewVersion({ number: null }))).toThrow(LifecycleError);
  });
});

describe("sweepSunsets", () => {
  // 00:00 Eastern on October 4 (EDT): eight hours before NOW. 21:00 on October 3 in Pacific.
  const SUNSET = new Date("2026-10-04T04:00:00.000Z");
  const MS_PER_DAY = 86_400_000;
  const facts = (over: Partial<SunsetFacts> = {}): SunsetFacts => ({
    id: "v_bt1",
    templateId: "UC-4F7K2Q",
    teamId: "coral-offers",
    number: 1,
    state: "superseded",
    sunsetAt: SUNSET,
    revokedAt: null,
    passedRecorded: false,
    activeNumber: 2,
    ...over,
  });
  const sweep = (versions: SunsetFacts[], now = NOW, zone = ZONE) => sweepSunsets({ versions, now, zone });

  it("records a passed sunset as the system, dated at the sunset, with its day and the zone, and tells consumers", () => {
    expect(sweep([facts()])).toEqual([
      {
        versionId: "v_bt1",
        templateId: "UC-4F7K2Q",
        teamId: "coral-offers",
        at: SUNSET,
        effects: [
          {
            kind: "audit",
            action: "version.sunset_passed",
            details: { number: 1, sunsetAt: "2026-10-04T04:00:00.000Z", sunsetDay: "2026-10-04", zone: ZONE },
          },
          {
            kind: "consumer_notice",
            notice: "sunset_passed",
            versionId: "v_bt1",
            payload: { versionNumber: 1, activeVersion: 2, sunsetAt: "2026-10-04T04:00:00.000Z", sunsetDay: "2026-10-04", zone: ZONE },
          },
        ],
      },
    ]);
  });

  it("one audit row and one notice per passed sunset, nothing else: no notification", () => {
    const passed = sweep([facts({ id: "v_a" }), facts({ id: "v_b", templateId: "UC-OTHER1", activeNumber: 5 })]);
    expect(passed.map((p) => p.effects.map((e) => e.kind))).toEqual([
      ["audit", "consumer_notice"],
      ["audit", "consumer_notice"],
    ]);
    expect(passed.map((p) => p.effects[1])).toMatchObject([
      { notice: "sunset_passed", versionId: "v_a", payload: { activeVersion: 2 } },
      { notice: "sunset_passed", versionId: "v_b", payload: { activeVersion: 5 } },
    ]);
  });

  it("the notice names the Active version to move to, or none when nothing is Active", () => {
    const [passed] = sweep([facts({ state: "revoked", revokedAt: new Date(SUNSET.getTime() + 1), activeNumber: null })]);
    expect(passed!.effects[1]).toMatchObject({ kind: "consumer_notice", payload: { versionNumber: 1, activeVersion: null } });
  });

  it("passed is sunsetPassed: from the sunset's instant, not a millisecond before", () => {
    expect(sweep([facts()], SUNSET)).toHaveLength(1);
    expect(sweep([facts()], new Date(SUNSET.getTime() - 1))).toEqual([]);
    expect(sweep([facts({ sunsetAt: TOMORROW })])).toEqual([]);
    expect(sweep([facts({ sunsetAt: null })])).toEqual([]);
  });

  it("finds exactly the passed sunsets nothing records yet, oldest first", () => {
    const versions = [
      facts({ id: "v_later", sunsetAt: new Date(SUNSET.getTime() - MS_PER_DAY) }),
      facts({ id: "v_recorded", passedRecorded: true }),
      facts({ id: "v_ahead", sunsetAt: TOMORROW }),
      facts({ id: "v_none", sunsetAt: null }),
      facts({ id: "v_earlier", sunsetAt: new Date(SUNSET.getTime() - 3 * MS_PER_DAY) }),
      facts({ id: "v_same_b" }),
      facts({ id: "v_same_a" }),
    ];
    // Same instant: by id.
    expect(sweep(versions).map((p) => p.versionId)).toEqual(["v_earlier", "v_later", "v_same_a", "v_same_b"]);
  });

  it("is idempotent: once its row is written, the next sweep, now or later, finds nothing, so no second notice", () => {
    expect(sweep([facts()]).map((p) => p.versionId)).toEqual(["v_bt1"]);
    const recorded = facts({ passedRecorded: true });
    expect(sweep([recorded])).toEqual([]);
    expect(sweep([recorded], new Date(NOW.getTime() + 30 * MS_PER_DAY))).toEqual([]);
  });

  it("names the day in the business time zone it reads at the sweep, in the row and the notice", () => {
    const [passed] = sweep([facts()], NOW, "America/Los_Angeles");
    expect(passed!.effects[0]).toMatchObject({ details: { sunsetDay: "2026-10-03", zone: "America/Los_Angeles" } });
    expect(passed!.effects[1]).toMatchObject({ payload: { sunsetDay: "2026-10-03", zone: "America/Los_Angeles" } });
  });

  it("skips a version revoked at or before its sunset (its renders had already stopped); records one revoked after", () => {
    expect(sweep([facts({ state: "revoked", revokedAt: new Date(SUNSET.getTime() - MS_PER_DAY) })])).toEqual([]);
    expect(sweep([facts({ state: "revoked", revokedAt: SUNSET })])).toEqual([]);
    expect(sweep([facts({ state: "revoked", revokedAt: null })])).toEqual([]);
    expect(sweep([facts({ state: "revoked", revokedAt: new Date(SUNSET.getTime() + 1) })]).map((p) => p.at)).toEqual([SUNSET]);
  });

  it("records nothing for a state that never carries a sunset, or an unnumbered version", () => {
    for (const state of VERSION_STATES.filter((x) => x !== "superseded" && x !== "revoked")) {
      expect(sweep([facts({ state })]), state).toEqual([]);
    }
    expect(sweep([facts({ number: null })])).toEqual([]);
  });
});

// ── The demo scenarios, end to end through the rules ─────────

describe("scenario 3: the review loop", () => {
  it("submit v1, changes requested, resubmit as v2, approve: v2 is Active", () => {
    const draft: SubmitDraft = {
      state: "draft",
      variables: VARIABLES,
      body: BODY,
      channelFields: {},
      channels: ["pdf", "web"],
      sampleSets: SAMPLE_SETS,
      writers: ["maya"],
      rev: 3,
    };
    const base = {
      now: NOW,
      submittedBy: "maya",
      submitterName: "Maya Chen",
      templateId: TEMPLATE.id,
      templateName: TEMPLATE.name,
      chain: CHAIN_1,
      messageRules: NO_MESSAGE_RULES,
    };

    const first = submit({ ...base, draft, seenRev: 3, highestNumber: 0, baseline: null });
    if (!first.ok) throw new Error(first.reason);
    const v1 = reviewVersion({ ...first.changes, id: "v_1" });

    // Maya can't approve her own version; Jordan sends it back.
    expect(approve({ ...approveArgs(v1), actorId: "maya" })).toEqual({ ok: false, ...REASONS.ownVersion });
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
      zone: ZONE,
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
      messageRules: NO_MESSAGE_RULES,
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
      zone: ZONE,
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
  const wrote = { ok: false, ...REASONS.wroteVersion };

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
    expect(decide(v1, "maya").approve).toEqual({ ok: false, ...REASONS.ownVersion });
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
      ...REASONS.ownRevoke,
    });
    const confirmed = tryConfirmRevoke(pending);
    expect(confirmed).toMatchObject({ ok: true, changes: { state: "revoked", revoke: { startedBy: "jordan", confirmedBy: "alex" } } });
  });
});
