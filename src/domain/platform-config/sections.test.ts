import { describe, expect, it } from "vitest";
import { PLATFORM_REFUSALS } from "./refusals";
import {
  conformToSections,
  describeSectionsChange,
  removeSectionRefusal,
  sectionKey,
  updateRequiredSections,
  validateRequiredSections,
} from "./sections";
import { describeConfigChange } from "./effects";
import type { JSONContent, RequiredSection } from "../types";
import { NOW, riley, SECTIONS, disclosure } from "./fixtures";

describe("sectionKey", () => {
  it.each([
    ["Rates and fees", "rates_and_fees"],
    ["  Privacy & data ", "privacy_data"],
    ["2027 changes", "section_2027_changes"],
    ["!!!", "section"],
  ])("%s → %s", (title, key) => expect(sectionKey(title)).toBe(key));
});

describe("updateRequiredSections", () => {
  const run = (next: RequiredSection[]) =>
    updateRequiredSections({
      contentType: disclosure,
      next,
      actor: riley,
      now: NOW,
    });

  it("adds a section with a key from its title, keeps renamed sections' keys, and records it", () => {
    const result = run([
      { key: "offer_details", title: "Offer summary" },
      SECTIONS[1]!,
      SECTIONS[2]!,
      { key: "", title: "Privacy" },
    ]);
    expect(result.ok && result.requiredSections).toEqual([
      { key: "offer_details", title: "Offer summary" },
      SECTIONS[1],
      SECTIONS[2],
      { key: "privacy", title: "Privacy" },
    ]);
    expect(result.ok && result.effects).toEqual([
      {
        kind: "audit",
        action: "platform.config_changed",
        teamId: null,
        details: {
          area: "content_types",
          contentTypeId: "ct_disclosure",
          contentTypeName: "Disclosure",
          added: ["Privacy"],
          removed: [],
          renamed: [{ from: "Offer details", to: "Offer summary" }],
          reordered: false,
          sections: [
            "Offer summary",
            "Rates and fees",
            "Legal notices",
            "Privacy",
          ],
        },
      },
    ]);
    // The Audit page words the row when it reads it.
    const audit = result.ok ? result.effects[0] : undefined;
    expect(audit?.kind === "audit" && describeConfigChange(audit.details)).toBe(
      "changed Disclosure required sections: added Privacy; renamed Offer details to Offer summary",
    );
  });

  it("removes a section (existing templates keep theirs; nothing at submit checks sections)", () => {
    const result = run([SECTIONS[0]!, SECTIONS[2]!]);
    expect(result.ok && result.requiredSections).toEqual([
      SECTIONS[0],
      SECTIONS[2],
    ]);
    const audit = result.ok ? result.effects[0] : undefined;
    expect(audit?.kind === "audit" && audit.details).toMatchObject({
      added: [],
      removed: ["Rates and fees"],
      renamed: [],
      reordered: false,
    });
    expect(audit?.kind === "audit" && describeConfigChange(audit.details)).toBe(
      "changed Disclosure required sections: removed Rates and fees",
    );
  });

  it("never reuses a key the type has: a new section titled like an old key gets a suffix", () => {
    const result = run([...SECTIONS, { key: "new", title: "Legal-notices" }]);
    expect(result.ok && result.requiredSections.at(-1)).toEqual({
      key: "legal_notices_2",
      title: "Legal-notices",
    });
  });

  it("records a reorder, and nothing when nothing changed", () => {
    const reordered = run([SECTIONS[1]!, SECTIONS[0]!, SECTIONS[2]!]);
    const audit = reordered.ok ? reordered.effects[0] : undefined;
    expect(audit?.kind === "audit" && audit.details).toMatchObject({
      added: [],
      removed: [],
      renamed: [],
      reordered: true,
    });
    expect(audit?.kind === "audit" && describeConfigChange(audit.details)).toBe(
      "changed Disclosure required sections: reordered the sections",
    );
    expect(run(SECTIONS.map((s) => ({ ...s, title: ` ${s.title} ` })))).toEqual(
      { ok: true, requiredSections: SECTIONS, effects: [] },
    );
  });

  it("refuses no sections, a blank, long or duplicate title", () => {
    expect(run([])).toEqual({ ok: false, ...PLATFORM_REFUSALS.oneSection });
    expect(run([{ key: "", title: " " }])).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.sectionTitle,
    });
    expect(run([{ key: "", title: "x".repeat(61) }])).toEqual({
      ok: false,
      ...PLATFORM_REFUSALS.sectionTitleTooLong,
    });
    expect(run([SECTIONS[0]!, { key: "", title: "offer DETAILS" }])).toEqual({
      ok: false,
      code: "section_duplicate",
      reason: "There are two sections called offer DETAILS.",
    });
  });
});

describe("the sections editor: validateRequiredSections, removeSectionRefusal, describeSectionsChange", () => {
  const describe_ = (next: RequiredSection[]) =>
    describeSectionsChange({
      contentTypeName: "Disclosure",
      current: SECTIONS,
      next,
    });
  const SCOPE =
    "Applies to new Disclosure templates only. Existing templates keep their sections.";

  it("validateRequiredSections is the reason updateRequiredSections refuses with", () => {
    const lists: RequiredSection[][] = [
      [],
      [{ key: "", title: " " }],
      [{ key: "", title: "x".repeat(61) }],
      [SECTIONS[0]!, { key: "n", title: "offer details" }],
    ];
    for (const next of lists) {
      const problem = validateRequiredSections(next);
      expect(problem).not.toBeNull();
      expect(
        updateRequiredSections({
          contentType: disclosure,
          next,
          actor: riley,
          now: NOW,
        }),
      ).toEqual({ ok: false, ...problem });
    }
    expect(validateRequiredSections(SECTIONS)).toBeNull();
  });

  it("removeSectionRefusal keeps the last section", () => {
    expect(removeSectionRefusal(1)).toBe(PLATFORM_REFUSALS.oneSection);
    expect(removeSectionRefusal(2)).toBeNull();
  });

  it("says the scope from the start; nothing to save until something changes", () => {
    expect(describe_(SECTIONS)).toEqual({
      problem: null,
      changed: false,
      lines: [SCOPE],
    });
    expect(
      describe_(SECTIONS.map((s) => ({ ...s, title: ` ${s.title} ` }))),
    ).toEqual({ problem: null, changed: false, lines: [SCOPE] });
  });

  it("names what new templates gain and what becomes an ordinary heading", () => {
    expect(
      describe_([
        SECTIONS[0]!,
        SECTIONS[2]!,
        { key: "new-1", title: " Privacy " },
        { key: "new-2", title: "Contact" },
      ]),
    ).toEqual({
      problem: null,
      changed: true,
      lines: [
        SCOPE,
        "New templates start with Privacy and Contact added.",
        "Rates and fees becomes an ordinary heading in new templates.",
      ],
    });
    // A rename or a move changes something but adds no line.
    expect(describe_([SECTIONS[1]!, SECTIONS[0]!, SECTIONS[2]!])).toEqual({
      problem: null,
      changed: true,
      lines: [SCOPE],
    });
  });

  it("a draft that can't be saved says why, and only the scope", () => {
    expect(describe_([...SECTIONS, { key: "new-1", title: "" }])).toEqual({
      problem: PLATFORM_REFUSALS.sectionTitle,
      changed: true,
      lines: [SCOPE],
    });
  });
});

describe("conformToSections", () => {
  const h = (id: string, key: string | null, text: string): JSONContent => ({
    type: "heading",
    attrs: { id, level: 2, requiredKey: key },
    content: [{ type: "text", text }],
  });
  const p = (id: string): JSONContent => ({
    type: "paragraph",
    attrs: { id },
    content: [{ type: "text", text: id }],
  });
  const starter: JSONContent = {
    type: "doc",
    content: [
      h("a", "offer_details", "Offer details"),
      p("a1"),
      h("b", "rates_and_fees", "Rates and fees"),
      p("b1"),
      h("c", "legal_notices", "Legal notices"),
    ],
  };

  it("leaves a starter alone when the sections match", () => {
    expect(conformToSections(starter, SECTIONS, () => "x")).toEqual(starter);
  });

  it("unmarks removed sections, retitles renamed ones and appends new ones", () => {
    const next = [
      { key: "offer_details", title: "Offer summary" },
      SECTIONS[2]!,
      { key: "privacy", title: "Privacy" },
    ];
    expect(conformToSections(starter, next, () => "new1").content).toEqual([
      h("a", "offer_details", "Offer summary"),
      p("a1"),
      h("b", null, "Rates and fees"),
      p("b1"),
      h("c", "legal_notices", "Legal notices"),
      h("new1", "privacy", "Privacy"),
    ]);
  });
});
