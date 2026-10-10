import { describe, expect, it } from "vitest";
import { ALL_CHANNEL_FIELDS, channelFieldValue, normalizeAndCheckChannelField } from "@/domain/channel-fields";
import { createDraft } from "@/domain/lifecycle";
import { DEFAULT_SMS_MAX_PARTS } from "@/domain/platform-config";
import { resolveMessage } from "@/domain/render/message";
import { validateValues } from "@/domain/render/validate";
import { smsLength } from "@/domain/messages/gsm7";
import type { JSONContent } from "@/domain/types";
import { formatValue, validateValue } from "@/editor/model/variables";
import { REQUIRED_SECTIONS, variableKeys } from "../seed/content";
import { ALERT_SMS_FOOTER } from "../seed/platform";
import { trySubmit } from "../testing/submit-check";
import { STARTERS, STARTER_KEYS, buildStarter, isStarterKey, type StarterChoice, type StarterKey } from "./index";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const ALERT_RULES = { smsFooter: ALERT_SMS_FOOTER, smsMaxParts: DEFAULT_SMS_MAX_PARTS };

const doc = (key: StarterKey<"document">, scope = "UC-TEST01") =>
  buildStarter({ family: "document", starterKey: key }, { scope, now: NOW });
const alert = (key: StarterKey<"message">, scope = "UC-TEST01") =>
  buildStarter({ family: "message", starterKey: key }, { scope, now: NOW });

/** Every node in a document, depth first. */
function walk(node: JSONContent, visit: (n: JSONContent) => void) {
  visit(node);
  node.content?.forEach((c) => walk(c, visit));
}

/** Every variable the body and the channel fields use. */
function usedKeys(starter: ReturnType<typeof doc>) {
  const used = variableKeys(starter.body);
  for (const field of ALL_CHANNEL_FIELDS) variableKeys(channelFieldValue(starter.channelFields ?? {}, field), used);
  return used;
}

describe("the catalog", () => {
  it("lists Blank first, then three examples, for each kind of template", () => {
    expect(STARTERS.document.map((s) => s.name)).toEqual(["Blank", "Card offer terms", "Rate change notice", "Fee schedule"]);
    expect(STARTERS.message.map((s) => s.name)).toEqual(["Blank", "Payment reminder", "Card activity", "Statement ready"]);
    for (const family of ["document", "message"] as const) {
      expect(STARTERS[family].map((s) => s.key)).toEqual([...STARTER_KEYS[family]]);
    }
  });

  it("describes each starter on one line", () => {
    for (const s of [...STARTERS.document, ...STARTERS.message]) expect(s.description).toMatch(/^[^\n]+$/);
  });

  it("recognizes only a kind's own keys", () => {
    expect(isStarterKey("document", "fee_schedule")).toBe(true);
    expect(isStarterKey("message", "fee_schedule")).toBe(false);
    expect(isStarterKey("message", "payment_reminder")).toBe(true);
    expect(isStarterKey("message", "blank")).toBe(true);
    expect(isStarterKey("document", "nope")).toBe(false);
    expect(isStarterKey("document", undefined)).toBe(false);
  });
});

const EVERY: StarterChoice[] = [
  ...STARTER_KEYS.document.map((starterKey) => ({ family: "document" as const, starterKey })),
  ...STARTER_KEYS.message.map((starterKey) => ({ family: "message" as const, starterKey })),
];

describe.each(EVERY)("starter $family/$starterKey", (choice) => {
  const starter = buildStarter(choice, { scope: "UC-TEST01", now: NOW });

  it("gives every top-level block a unique id, and every list item and paragraph too", () => {
    const top = (starter.body.content ?? []).map((b) => b.attrs?.id);
    expect(top.length).toBeGreaterThan(0);
    expect(top.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(top).size).toBe(top.length);

    const all: string[] = [];
    walk(starter.body, (n) => {
      if (["paragraph", "listItem", "heading", "bulletList", "orderedList", "table", "callout"].includes(n.type ?? "")) {
        expect(typeof n.attrs?.id, `${n.type} has an id`).toBe("string");
        all.push(n.attrs!.id as string);
      }
    });
    expect(new Set(all).size).toBe(all.length);
  });

  it("only uses variables it declares", () => {
    const declared = new Set(starter.variables.map((v) => v.key));
    for (const k of usedKeys(starter)) expect(declared.has(k), `${k} is declared`).toBe(true);
  });

  it("has the three standard sample sets covering exactly its variables, in canonical form", () => {
    expect(starter.sampleSets.map((s) => s.id)).toEqual(["typical", "long", "minimum"]);
    const keys = starter.variables.map((v) => v.key).sort();
    for (const set of starter.sampleSets) {
      expect(Object.keys(set.values).sort()).toEqual(keys);
      for (const v of starter.variables) {
        const value = set.values[v.key]!;
        expect(validateValue(v.type, value).ok, `${set.id}.${v.key} = ${value}`).toBe(true);
        expect(formatValue(v.type, value)).toBeTruthy();
      }
    }
    for (const v of starter.variables) {
      expect(validateValue(v.type, v.sample).ok, `${v.key} sample`).toBe(true);
    }
  });

  it("stores each channel field as a save would: normalized for its shape, nothing to refuse", () => {
    for (const field of ALL_CHANNEL_FIELDS) {
      const value = channelFieldValue(starter.channelFields ?? {}, field);
      if (!value) continue;
      expect(value && starter.channels, `${field.id} is on a channel the starter has`).toContain(field.channel);
      const checked = normalizeAndCheckChannelField(field, value);
      expect(checked.problem, field.id).toBeNull();
      expect(checked.doc, field.id).toEqual(value);
    }
  });

  it("makes a valid first draft", () => {
    const { changes } = createDraft({ starter, createdBy: "maya", now: NOW });
    expect(changes.draft.state).toBe("draft");
    expect(changes.draft.rev).toBe(0);
    expect(changes.draft.number).toBeNull();
  });

  it("derives block ids from the scope, so two templates never share them", () => {
    const other = buildStarter(choice, { scope: "UC-TEST02", now: NOW });
    const ids = (s: typeof starter) => (s.body.content ?? []).map((b) => b.attrs?.id);
    expect(ids(other)).not.toEqual(ids(starter));
    expect(ids(buildStarter(choice, { scope: "UC-TEST01", now: NOW }))).toEqual(ids(starter));
  });
});

describe.each(STARTER_KEYS.document)("document starter %s", (key) => {
  const starter = doc(key);

  it("opens with the three required H2 sections, in order, carrying their requiredKey", () => {
    const headings = (starter.body.content ?? []).filter((b) => b.type === "heading" && b.attrs?.requiredKey);
    expect(headings.map((h) => h.attrs?.requiredKey)).toEqual(REQUIRED_SECTIONS.map((s) => s.key));
    expect(headings.map((h) => h.attrs?.level)).toEqual([2, 2, 2]);
    expect(headings.map((h) => h.content?.[0]?.text)).toEqual(REQUIRED_SECTIONS.map((s) => s.title));
  });

  it("renders documents: PDF and Web on, never Push or SMS", () => {
    const { changes } = createDraft({ starter, createdBy: "maya", now: NOW });
    expect(changes.draft.channels).toContain("pdf");
    expect(changes.draft.channels).toContain("web");
    expect(changes.draft.channels).not.toContain("push");
    expect(changes.draft.channels).not.toContain("sms");
  });
});

// The Alert starters must be submittable as they come: an author who starts from one and changes only
// the words never meets a refusal they didn't cause (decisions 0033 and 0034).
describe.each(STARTER_KEYS.message)("alert starter %s", (key) => {
  const starter = alert(key);

  it("is a message: Push and SMS on, and a body of one empty paragraph", () => {
    expect(starter.channels).toEqual(["push", "sms"]);
    expect(starter.body.content).toHaveLength(1);
    expect(starter.body.content?.[0]).toMatchObject({ type: "paragraph" });
    expect(starter.body.content?.[0]?.content ?? []).toEqual([]);
  });

  it("uses every variable it declares", () => {
    expect([...usedKeys(starter)].sort()).toEqual(starter.variables.map((v) => v.key).sort());
  });

  it.runIf(key !== "blank")("passes every submit rule, the SMS in GSM-7 and within the Alert's parts with the long values", () => {
    expect(trySubmit(starter, ALERT_RULES, NOW)).toMatchObject({ ok: true });
    const long = validateValues(starter.variables, starter.sampleSets.find((s) => s.id === "long")!.values);
    expect(long.ok).toBe(true);
    if (!long.ok) return;
    const sms = smsLength(resolveMessage({ channel: "sms" }, { fields: starter.channelFields ?? {}, variables: starter.variables, values: long.values, rules: ALERT_RULES }));
    expect(sms.encoding).toBe("GSM-7");
    expect(sms.parts).toBeLessThanOrEqual(DEFAULT_SMS_MAX_PARTS);
  });
});

describe("Blank", () => {
  it("is just the three headings, for a document", () => {
    const blank = doc("blank");
    expect((blank.body.content ?? []).map((b) => b.type)).toEqual(["heading", "heading", "heading"]);
    expect(blank.variables).toEqual([]);
  });

  it("is a push and an SMS with nothing written, for an alert", () => {
    const blank = alert("blank");
    expect(blank.channelFields).toEqual({});
    expect(blank.variables).toEqual([]);
    expect(createDraft({ starter: blank, createdBy: "maya", now: NOW }).changes.template.starterKey).toBeNull();
  });

  it("still has the three sample sets, empty", () => {
    expect(doc("blank").sampleSets.map((s) => s.values)).toEqual([{}, {}, {}]);
    expect(alert("blank").sampleSets.map((s) => s.values)).toEqual([{}, {}, {}]);
  });
});

describe("Card offer terms", () => {
  const card = doc("card_offer_terms");
  const used = variableKeys(card.body);

  it("declares first_name as required Text and purchase_apr as required Percent, both unused", () => {
    const byKey = new Map(card.variables.map((v) => [v.key, v]));
    expect(byKey.get("first_name")).toMatchObject({ type: "text", required: true });
    expect(byKey.get("purchase_apr")).toMatchObject({ type: "percent", required: true });
    expect(used.has("first_name")).toBe(false);
    expect(used.has("purchase_apr")).toBe(false);
  });

  it("uses at least one other variable in the body", () => {
    expect([...used].length).toBeGreaterThanOrEqual(1);
  });

  it("leaves offer_end_date and annual_fee for the author to create", () => {
    expect(card.variables.map((v) => v.key)).not.toContain("offer_end_date");
    expect(card.variables.map((v) => v.key)).not.toContain("annual_fee");
  });

  it("renders to PDF and Web, with email off", () => {
    expect(card.channels ?? ["pdf", "web"]).toEqual(["pdf", "web"]);
    expect(card.channelFields ?? {}).toEqual({});
  });
});

describe("Rate change notice", () => {
  const notice = doc("rate_change_notice");

  it("is also an email, with a subject and preheader that use declared variables", () => {
    expect(notice.channels).toEqual(["pdf", "web", "email"]);
    expect(variableKeys(notice.channelFields?.email?.subject).has("effective_date")).toBe(true);
    expect(variableKeys(notice.channelFields?.email?.preheader).has("first_name")).toBe(true);
  });

  it("uses every variable it declares", () => {
    expect([...usedKeys(notice)].sort()).toEqual(notice.variables.map((v) => v.key).sort());
  });
});

describe("Fee schedule", () => {
  const fees = doc("fee_schedule");

  it("has a fee table", () => {
    let tables = 0;
    walk(fees.body, (n) => {
      if (n.type === "table") tables += 1;
    });
    expect(tables).toBe(1);
  });

  it("uses every variable it declares", () => {
    expect([...variableKeys(fees.body)].sort()).toEqual(fees.variables.map((v) => v.key).sort());
  });
});

describe("Card activity", () => {
  it("keeps the card's last 4 digits out of the push title: they go in the iPhone-only subtitle", () => {
    const card = alert("card_activity");
    expect(variableKeys(card.channelFields?.push?.title).size).toBe(0);
    expect(variableKeys(card.channelFields?.push?.subtitle).has("card_last4")).toBe(true);
  });
});
