import { describe, expect, it } from "vitest";
import { createDraft } from "@/domain/lifecycle";
import type { JSONContent } from "@/domain/types";
import { formatValue, validateValue } from "@/editor";
import { REQUIRED_SECTIONS, variableKeys } from "../seed/content";
import { STARTERS, STARTER_KEYS, buildStarter, isStarterKey } from "./index";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const build = (key: (typeof STARTER_KEYS)[number], scope = "UC-TEST01") => buildStarter(key, { scope, now: NOW });

/** Every node in a document, depth first. */
function walk(node: JSONContent, visit: (n: JSONContent) => void) {
  visit(node);
  node.content?.forEach((c) => walk(c, visit));
}

describe("the catalog", () => {
  it("lists Blank first, then the three examples", () => {
    expect(STARTERS.map((s) => s.name)).toEqual(["Blank", "Card offer terms", "Rate change notice", "Fee schedule"]);
    expect(STARTERS.map((s) => s.key)).toEqual([...STARTER_KEYS]);
  });

  it("describes each starter on one line", () => {
    for (const s of STARTERS) expect(s.description).toMatch(/^[^\n]+$/);
  });

  it("recognizes only its own keys", () => {
    expect(isStarterKey("fee_schedule")).toBe(true);
    expect(isStarterKey("nope")).toBe(false);
    expect(isStarterKey(undefined)).toBe(false);
  });
});

describe.each(STARTER_KEYS)("starter %s", (key) => {
  const starter = build(key);

  it("opens with the three required H2 sections, in order, carrying their requiredKey", () => {
    const headings = (starter.body.content ?? []).filter((b) => b.type === "heading" && b.attrs?.requiredKey);
    expect(headings.map((h) => h.attrs?.requiredKey)).toEqual(REQUIRED_SECTIONS.map((s) => s.key));
    expect(headings.map((h) => h.attrs?.level)).toEqual([2, 2, 2]);
    expect(headings.map((h) => h.content?.[0]?.text)).toEqual(REQUIRED_SECTIONS.map((s) => s.title));
  });

  it("gives every top-level block a unique id, and every list item and paragraph too", () => {
    const top = (starter.body.content ?? []).map((b) => b.attrs?.id);
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
    const used = variableKeys(starter.body);
    variableKeys(starter.emailSubject, used);
    variableKeys(starter.emailPreheader, used);
    for (const k of used) expect(declared.has(k), `${k} is declared`).toBe(true);
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

  it("makes a valid first draft", () => {
    const { changes } = createDraft({ starter, createdBy: "maya", now: NOW });
    expect(changes.draft.state).toBe("draft");
    expect(changes.draft.rev).toBe(0);
    expect(changes.draft.number).toBeNull();
    expect(changes.draft.channels).toContain("pdf");
    expect(changes.draft.channels).toContain("web");
  });

  it("derives block ids from the scope, so two templates never share them", () => {
    const other = build(key, "UC-TEST02");
    const ids = (s: typeof starter) => (s.body.content ?? []).map((b) => b.attrs?.id);
    expect(ids(other)).not.toEqual(ids(starter));
    expect(ids(build(key, "UC-TEST01"))).toEqual(ids(starter));
  });
});

describe("Blank", () => {
  const blank = build("blank");

  it("is just the three headings", () => {
    expect((blank.body.content ?? []).map((b) => b.type)).toEqual(["heading", "heading", "heading"]);
    expect(blank.variables).toEqual([]);
  });

  it("still has the three sample sets, empty", () => {
    expect(blank.sampleSets.map((s) => s.values)).toEqual([{}, {}, {}]);
  });
});

describe("Card offer terms", () => {
  const card = build("card_offer_terms");
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
    expect(card.emailSubject ?? null).toBeNull();
  });
});

describe("Rate change notice", () => {
  const notice = build("rate_change_notice");

  it("is also an email, with a subject and preheader that use declared variables", () => {
    expect(notice.channels).toEqual(["pdf", "web", "email"]);
    expect(variableKeys(notice.emailSubject).has("effective_date")).toBe(true);
    expect(variableKeys(notice.emailPreheader).has("first_name")).toBe(true);
  });

  it("uses every variable it declares", () => {
    const used = variableKeys(notice.body);
    variableKeys(notice.emailSubject, used);
    variableKeys(notice.emailPreheader, used);
    expect([...used].sort()).toEqual(notice.variables.map((v) => v.key).sort());
  });
});

describe("Fee schedule", () => {
  const fees = build("fee_schedule");

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
