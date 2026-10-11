import { describe, expect, it } from "vitest";
import {
  BLANK_STARTER_KEY,
  DEFAULT_CHANNELS,
  UNTITLED_TEMPLATE_NAME,
  createDraft,
  draftChannelsRefusal,
  editLatest,
  initialTemplateName,
  planDraftStart,
  newTemplateChannels,
  newTemplateContentType,
} from "./drafts";
import { LifecycleError, type StarterContent, type VersionSnapshot } from "./types";
import { REFUSALS } from "./refusals";
import type { JSONContent, VersionState } from "../types";
import { NOW, heading, BODY, VARIABLES, SAMPLE_SETS } from "./fixtures";

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

// A template is a document or an alert for life: its content type is one family (decision 0034).
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
      round: null,
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

  it("saves a draft's channels only when one is on and its content type allows each (draftChannelsRefusal)", () => {
    expect(draftChannelsRefusal(["push"], ["push", "sms"])).toBeNull();
    expect(draftChannelsRefusal([], ["push", "sms"])).toBe(REFUSALS.noChannels);
    expect(draftChannelsRefusal(["push", "pdf"], ["push", "sms"])).toBe(REFUSALS.channelNotAllowed);
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
  const v = (id: string, state: VersionState, number: number | null, round: number | null = number === null ? null : 1) => ({
    id,
    state,
    number,
    round,
  });

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

  it("orders one number's rounds by round: the latest round decides", () => {
    // v2 round 1 was sent back, round 2 is in review: a draft now would fork it.
    expect(planDraftStart([v("v1", "active", 1), v("v2r1", "changes_requested", 2, 1), v("v2r2", "in_review", 2, 2)])).toEqual({
      kind: "blocked",
      ...REFUSALS.newerInReview,
    });
    // v2 went live on round 2: it is the one to copy.
    expect(planDraftStart([v("v1", "superseded", 1), v("v2r1", "changes_requested", 2, 1), v("v2r2", "active", 2, 2)])).toEqual({
      kind: "create",
      from: "v2r2",
    });
  });

  it("starts from the Active version when the latest round was sent back and its draft is gone", () => {
    // A sent-back round is a record, not something to edit: its submit is still v2 round 2 (`nextRound`).
    expect(planDraftStart([v("v1", "active", 1), v("v2r1", "changes_requested", 2, 1)])).toEqual({ kind: "create", from: "v1" });
  });
});

describe("editLatest", () => {
  const active: VersionSnapshot = {
    id: "v_active",
    number: 3,
    round: 1,
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
      round: null,
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
      round: null,
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
