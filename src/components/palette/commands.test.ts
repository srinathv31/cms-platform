import { describe, expect, it } from "vitest";
import type { PaletteResults, PaletteTemplateRow } from "@/domain/import-types";
import { paletteGroups, templateIdFromPath, type PaletteInput } from "./commands";

// The palette as the personas see it. Spaces mirror what `getShell` builds for them; `results` is what
// GET /api/palette/{space} answers (which templates it lists is pinned in src/domain/palette.test.ts).

const coral = { slug: "coral-offers", name: "Coral Offers" };
const deposits = { slug: "deposits", name: "Deposits" };
const statements = { slug: "card-statements", name: "Card Statements" };
const all = { slug: "all", name: "All teams" };

const NONE = { team: false, platform: false };

const cashBack: PaletteTemplateRow = { id: "UC-AAAAAA", name: "Cash Back", teamSlug: "coral-offers", teamName: "Coral Offers", status: "in_review" };
const balance: PaletteTemplateRow = { id: "UC-BBBBBB", name: "Balance Transfer", teamSlug: "coral-offers", teamName: "Coral Offers", status: "active" };
const holiday: PaletteTemplateRow = { id: "UC-CCCCCC", name: "Holiday Points", teamSlug: "coral-offers", teamName: "Coral Offers", status: "revoked" };
const savings: PaletteTemplateRow = { id: "UC-DDDDDD", name: "Savings Rate", teamSlug: "deposits", teamName: "Deposits", status: "draft" };

function answer(space: string, over: Partial<PaletteResults> = {}): PaletteResults {
  return { viewerId: "maya", space, query: "", canCreate: false, current: false, recent: [], templates: [], ...over };
}

// Maya: Author in Coral Offers. Balance Transfer and Cash Back are her latest.
const maya: PaletteInput = {
  space: { ...coral, kind: "team", showAudit: false, settings: NONE },
  spaces: [coral],
  results: answer("coral-offers", { canCreate: true, recent: [balance, cashBack], templates: [holiday] }),
  pathname: "/coral-offers/library",
};
// Riley: Platform Admin, in All teams.
const riley: PaletteInput = {
  space: { ...all, kind: "all", showAudit: true, settings: { team: false, platform: true } },
  spaces: [all, coral, deposits, statements],
  results: answer("all", { viewerId: "riley", recent: [savings], templates: [balance, cashBack, holiday] }),
  pathname: "/all/library",
};
// Taylor: Auditor, in All teams. Reads everything, changes nothing.
const taylor: PaletteInput = {
  space: { ...all, kind: "all", showAudit: true, settings: NONE },
  spaces: [all, coral, deposits, statements],
  results: answer("all", { viewerId: "taylor", templates: [balance, cashBack, holiday, savings] }),
  pathname: "/all/audit",
};
// Morgan: a viewer in one team.
const morgan: PaletteInput = {
  space: { ...coral, kind: "team", showAudit: false, settings: NONE },
  spaces: [coral],
  results: answer("coral-offers", { viewerId: "morgan", templates: [balance, cashBack, holiday] }),
  pathname: "/coral-offers/library",
};

const keys = (input: PaletteInput) => paletteGroups(input).map((g) => g.key);
const labels = (input: PaletteInput, group: string) =>
  paletteGroups(input)
    .find((g) => g.key === group)
    ?.items.map((i) => ("label" in i ? i.label : i.name));
const templateNames = (input: PaletteInput) =>
  paletteGroups(input)
    .find((g) => g.key === "templates")
    ?.items.map((i) => (i.kind === "template" ? i.name : ""));

describe("paletteGroups", () => {
  it("Maya: Recent, Actions, Templates, Pages; no Settings, Audit or Teams", () => {
    expect(keys(maya)).toEqual(["recent", "actions", "templates", "pages"]);
    expect(labels(maya, "pages")).toEqual(["Library", "Review", "Usage"]);
    expect(labels(maya, "actions")).toEqual(["New template", "Import a file"]);
  });

  it("Recent keeps the server's order, shows status and links to the template in this space", () => {
    const recent = paletteGroups(maya)[0]!;
    expect(recent.heading).toBe("Recent");
    expect(recent.items).toEqual([
      { kind: "template", id: "UC-BBBBBB", name: "Balance Transfer", teamName: "Coral Offers", status: "active", href: "/coral-offers/templates/UC-BBBBBB" },
      { kind: "template", id: "UC-AAAAAA", name: "Cash Back", teamName: "Coral Offers", status: "in_review", href: "/coral-offers/templates/UC-AAAAAA" },
    ]);
  });

  it("Actions go to the space's Library, and only when the viewer can create", () => {
    const actions = paletteGroups(maya).find((g) => g.key === "actions")!;
    expect(actions.items.map((i) => i.href)).toEqual(["/coral-offers/library", "/coral-offers/library"]);
    expect(keys(morgan)).not.toContain("actions");
    expect(keys(riley)).not.toContain("actions");
  });

  it("until an answer has come, only the palette's own rows are listed", () => {
    expect(keys({ ...maya, results: null })).toEqual(["pages"]);
    expect(keys({ ...riley, results: null })).toEqual(["pages", "settings", "teams"]);
  });

  it("an answer for another space is not trusted", () => {
    expect(keys({ ...maya, results: answer("deposits", { canCreate: true, recent: [savings], templates: [savings] }) })).toEqual(["pages"]);
  });

  it("Riley: the answer's templates, the platform settings, Audit and the other spaces", () => {
    expect(keys(riley)).toEqual(["recent", "templates", "pages", "settings", "teams"]);
    expect(templateNames(riley)).toEqual(["Balance Transfer", "Cash Back", "Holiday Points"]);
    expect(labels(riley, "pages")).toEqual(["Library", "Review", "Usage", "Audit"]);
    expect(labels(riley, "settings")).toEqual(["Teams", "Content types", "Channel rules", "Approval chains", "Time zone"]);
    expect(labels(riley, "teams")).toEqual(["Coral Offers", "Deposits", "Card Statements"]);
    expect(paletteGroups(riley).find((g) => g.key === "teams")!.items.map((i) => i.href)).toEqual([
      "/coral-offers/library",
      "/deposits/library",
      "/card-statements/library",
    ]);
  });

  it("Taylor: Audit, no Settings, no Actions", () => {
    expect(keys(taylor)).toEqual(["templates", "pages", "teams"]);
    expect(labels(taylor, "pages")).toContain("Audit");
  });

  it("Morgan: only what a viewer can open", () => {
    expect(keys(morgan)).toEqual(["templates", "pages"]);
    expect(labels(morgan, "pages")).not.toContain("Audit");
  });

  it("a team admin's settings are the team group", () => {
    const admin: PaletteInput = { ...maya, space: { ...maya.space, settings: { team: true, platform: false } } };
    const settings = paletteGroups(admin).find((g) => g.key === "settings")!;
    expect(settings.items.map((i) => i.href)).toEqual([
      "/coral-offers/settings/members",
      "/coral-offers/settings/access-requests",
      "/coral-offers/settings/recertification",
      "/coral-offers/settings/inactivity",
    ]);
  });

  it("This template appears on a template's pages the server says the viewer can see, linking its tabs", () => {
    const onTemplate = { ...maya, pathname: "/coral-offers/templates/UC-AAAAAA/versions", results: { ...maya.results!, current: true } };
    expect(keys(onTemplate)).toEqual(["recent", "actions", "this_template", "templates", "pages"]);
    const group = paletteGroups(onTemplate).find((g) => g.key === "this_template")!;
    expect(group.heading).toBe("This template");
    expect(group.items.map((i) => [i.kind === "template_tab" ? i.key : "", i.href])).toEqual([
      ["content", "/coral-offers/templates/UC-AAAAAA"],
      ["versions", "/coral-offers/templates/UC-AAAAAA/versions"],
      ["usage", "/coral-offers/templates/UC-AAAAAA/usage"],
      ["activity", "/coral-offers/templates/UC-AAAAAA/activity"],
    ]);
    // A template the viewer can't see here gets no tabs.
    expect(keys({ ...maya, pathname: "/coral-offers/templates/UC-ZZZZZZ" })).not.toContain("this_template");
  });

  describe("with a query", () => {
    it("lists the answer to it as the server ranked it, without Recent", () => {
      const searching = { ...maya, query: "A", results: answer("coral-offers", { query: "a", canCreate: true, templates: [cashBack, balance, holiday] }) };
      expect(keys(searching)).toEqual(["actions", "templates", "pages"]);
      expect(templateNames(searching)).toEqual(["Cash Back", "Balance Transfer", "Holiday Points"]);
    });

    it("narrows an earlier answer to what was typed while the next is on its way, recent templates first", () => {
      // The resting answer is in; "a" has been typed and its answer hasn't come yet.
      expect(templateNames({ ...maya, query: "a" })).toEqual(["Balance Transfer", "Cash Back", "Holiday Points"]);
      expect(templateNames({ ...maya, query: "cash back" })).toEqual(["Cash Back"]);
      expect(templateNames({ ...maya, query: "revoked" })).toEqual(["Holiday Points"]);
      expect(keys({ ...maya, query: "zzz" })).toEqual([]);
    });

    it("finds pages, settings by group, and spaces", () => {
      expect(keys({ ...riley, query: "audit", results: answer("all", { viewerId: "riley", query: "audit" }) })).toEqual(["pages"]);
      expect(labels({ ...riley, query: "platform" }, "settings")).toHaveLength(5);
      expect(labels({ ...riley, query: "deposits" }, "teams")).toEqual(["Deposits"]);
      expect(keys({ ...maya, query: "import" })).toEqual(["actions"]);
    });

    it("an unmatched query leaves no groups", () => {
      expect(paletteGroups({ ...riley, query: "qqqq", results: answer("all", { viewerId: "riley", query: "qqqq" }) })).toEqual([]);
    });
  });
});

describe("templateIdFromPath", () => {
  it("reads the template from its workspace and review routes", () => {
    expect(templateIdFromPath("/coral-offers/templates/UC-AAAAAA")).toBe("UC-AAAAAA");
    expect(templateIdFromPath("/coral-offers/templates/UC-AAAAAA/activity")).toBe("UC-AAAAAA");
    expect(templateIdFromPath("/coral-offers/review/UC-AAAAAA/2")).toBe("UC-AAAAAA");
    expect(templateIdFromPath("/coral-offers/library")).toBeNull();
    expect(templateIdFromPath("/coral-offers/templates")).toBeNull();
  });
});
