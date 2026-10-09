import { describe, expect, it } from "vitest";
import type { PaletteContext } from "@/domain/import-types";
import type { PaletteTemplate } from "@/server/queries/palette";
import { paletteGroups, templateIdFromPath, type PaletteInput } from "./commands";

// The palette as the personas see it. Spaces mirror what `getShell` builds for them.

const coral = { slug: "coral-offers", name: "Coral Offers" };
const deposits = { slug: "deposits", name: "Deposits" };
const statements = { slug: "card-statements", name: "Card Statements" };
const all = { slug: "all", name: "All teams" };

const NONE = { team: false, platform: false };

const templates: PaletteTemplate[] = [
  { id: "UC-AAAAAA", name: "Cash Back", teamSlug: "coral-offers", teamName: "Coral Offers", status: "in_review" },
  { id: "UC-BBBBBB", name: "Balance Transfer", teamSlug: "coral-offers", teamName: "Coral Offers", status: "active" },
  { id: "UC-CCCCCC", name: "Holiday Points", teamSlug: "coral-offers", teamName: "Coral Offers", status: "revoked" },
  { id: "UC-DDDDDD", name: "Savings Rate", teamSlug: "deposits", teamName: "Deposits", status: "draft" },
];

function ctx(space: string, over: Partial<PaletteContext> = {}): PaletteContext {
  return { space, canCreate: false, recent: [], ...over };
}

// Maya: Author in Coral Offers.
const maya: PaletteInput = {
  space: { ...coral, kind: "team", showAudit: false, settings: NONE },
  spaces: [coral],
  templates: templates.filter((t) => t.teamSlug === "coral-offers"),
  context: ctx("coral-offers", { canCreate: true, recent: ["UC-BBBBBB", "UC-AAAAAA"] }),
  pathname: "/coral-offers/library",
};
// Riley: Platform Admin, in All teams.
const riley: PaletteInput = {
  space: { ...all, kind: "all", showAudit: true, settings: { team: false, platform: true } },
  spaces: [all, coral, deposits, statements],
  templates,
  context: ctx("all", { recent: ["UC-DDDDDD"] }),
  pathname: "/all/library",
};
// Taylor: Auditor, in All teams. Reads everything, changes nothing.
const taylor: PaletteInput = {
  space: { ...all, kind: "all", showAudit: true, settings: NONE },
  spaces: [all, coral, deposits, statements],
  templates,
  context: ctx("all"),
  pathname: "/all/audit",
};
// Morgan: a viewer in one team.
const morgan: PaletteInput = {
  space: { ...coral, kind: "team", showAudit: false, settings: NONE },
  spaces: [coral],
  templates: templates.filter((t) => t.teamSlug === "coral-offers"),
  context: ctx("coral-offers"),
  pathname: "/coral-offers/library",
};

const keys = (input: PaletteInput) => paletteGroups(input).map((g) => g.key);
const labels = (input: PaletteInput, group: string) =>
  paletteGroups(input)
    .find((g) => g.key === group)
    ?.items.map((i) => ("label" in i ? i.label : i.name));

describe("paletteGroups", () => {
  it("Maya: Recent, Actions, Templates, Pages; no Settings, Audit or Teams", () => {
    expect(keys(maya)).toEqual(["recent", "actions", "templates", "pages"]);
    expect(labels(maya, "pages")).toEqual(["Library", "Review", "Usage"]);
    expect(labels(maya, "actions")).toEqual(["New template", "Import a file"]);
  });

  it("Recent keeps the audit order, shows status and links to the template", () => {
    const recent = paletteGroups(maya)[0]!;
    expect(recent.heading).toBe("Recent");
    expect(recent.items).toEqual([
      { kind: "template", id: "UC-BBBBBB", name: "Balance Transfer", teamName: "Coral Offers", status: "active", href: "/coral-offers/templates/UC-BBBBBB" },
      { kind: "template", id: "UC-AAAAAA", name: "Cash Back", teamName: "Coral Offers", status: "in_review", href: "/coral-offers/templates/UC-AAAAAA" },
    ]);
  });

  it("Recent leaves out the template being viewed, and Templates doesn't repeat what Recent shows", () => {
    const onBalance = { ...maya, pathname: "/coral-offers/templates/UC-BBBBBB" };
    const groups = paletteGroups(onBalance);
    const ids = (key: string) => groups.find((g) => g.key === key)!.items.map((i) => (i.kind === "template" ? i.id : ""));
    expect(ids("recent")).toEqual(["UC-AAAAAA"]);
    expect(ids("templates")).toEqual(["UC-BBBBBB", "UC-CCCCCC"]);
    // Nothing recent but the current template: no Recent group.
    expect(keys({ ...onBalance, context: ctx("coral-offers", { recent: ["UC-BBBBBB"] }) })).not.toContain("recent");
  });

  it("Actions go to the space's Library, and only when the viewer can create", () => {
    const actions = paletteGroups(maya).find((g) => g.key === "actions")!;
    expect(actions.items.map((i) => i.href)).toEqual(["/coral-offers/library", "/coral-offers/library"]);
    expect(keys(morgan)).not.toContain("actions");
    expect(keys(riley)).not.toContain("actions");
    // Until the context has loaded, nothing is offered that it would decide.
    expect(keys({ ...maya, context: null })).toEqual(["templates", "pages"]);
    // A context fetched for another space is not trusted.
    expect(keys({ ...maya, context: ctx("deposits", { canCreate: true, recent: ["UC-DDDDDD"] }) })).toEqual(["templates", "pages"]);
  });

  it("Riley: every team's templates, the platform settings, Audit and the other spaces", () => {
    expect(keys(riley)).toEqual(["recent", "templates", "pages", "settings", "teams"]);
    expect(paletteGroups(riley).find((g) => g.key === "templates")!.items).toHaveLength(3); // the fourth is in Recent
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

  it("a team space lists only its own templates", () => {
    const group = paletteGroups({ ...maya, templates })[0]!;
    expect(group.items.every((i) => i.kind === "template")).toBe(true);
    const names = paletteGroups({ ...maya, templates }).find((g) => g.key === "templates")!.items.map((i) => (i.kind === "template" ? i.name : ""));
    expect(names).not.toContain("Savings Rate");
  });

  it("This template appears on a template's pages, linking its tabs", () => {
    const onTemplate = { ...maya, pathname: "/coral-offers/templates/UC-AAAAAA/versions" };
    expect(keys(onTemplate)).toEqual(["recent", "actions", "this_template", "templates", "pages"]);
    const group = paletteGroups(onTemplate).find((g) => g.key === "this_template")!;
    expect(group.heading).toBe("This template");
    expect(group.items.map((i) => [i.kind === "template_tab" ? i.key : "", i.href])).toEqual([
      ["content", "/coral-offers/templates/UC-AAAAAA"],
      ["versions", "/coral-offers/templates/UC-AAAAAA/versions"],
      ["usage", "/coral-offers/templates/UC-AAAAAA/usage"],
      ["activity", "/coral-offers/templates/UC-AAAAAA/activity"],
    ]);
    // A template the viewer can't see gets no tabs.
    expect(keys({ ...maya, pathname: "/coral-offers/templates/UC-ZZZZZZ" })).not.toContain("this_template");
  });

  describe("with a query", () => {
    it("hides Recent and ranks recent templates first in Templates", () => {
      const groups = paletteGroups({ ...maya, query: "a" });
      expect(groups.map((g) => g.key)).not.toContain("recent");
      const names = groups.find((g) => g.key === "templates")!.items.map((i) => (i.kind === "template" ? i.name : ""));
      // Balance Transfer and Cash Back are recent, in that order; both start with a letter other than "a",
      // so they rank by where "a" falls in the name, then by recency.
      expect(names[0]).toBe("Balance Transfer");
    });

    it("matches every word, in the label or the team and id", () => {
      const names = (query: string, input = riley) =>
        paletteGroups({ ...input, query })
          .find((g) => g.key === "templates")
          ?.items.map((i) => (i.kind === "template" ? i.name : ""));
      expect(names("cash back")).toEqual(["Cash Back"]);
      expect(names("deposits")).toEqual(["Savings Rate"]);
      expect(names("uc-cc")).toEqual(["Holiday Points"]);
      expect(names("cash zzz")).toBeUndefined();
    });

    it("matches a template's status label too", () => {
      const names = (query: string) =>
        paletteGroups({ ...riley, query })
          .find((g) => g.key === "templates")
          ?.items.map((i) => (i.kind === "template" ? i.name : ""));
      expect(names("draft")).toEqual(["Savings Rate"]);
      expect(names("active")).toEqual(["Balance Transfer"]);
      expect(names("in review")).toEqual(["Cash Back"]);
    });

    it("finds pages, settings by group, and spaces", () => {
      expect(keys({ ...riley, query: "audit" })).toEqual(["pages"]);
      expect(labels({ ...riley, query: "platform" }, "settings")).toHaveLength(5);
      expect(keys({ ...riley, query: "deposits" })).toEqual(["templates", "teams"]);
      expect(keys({ ...maya, query: "import" })).toEqual(["actions"]);
    });

    it("an unmatched query leaves no groups", () => {
      expect(paletteGroups({ ...riley, query: "qqqq" })).toEqual([]);
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
