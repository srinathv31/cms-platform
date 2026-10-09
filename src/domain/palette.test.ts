import { describe, expect, it } from "vitest";
import type { PaletteTemplateRow } from "./import-types";
import {
  normalizePaletteQuery,
  PALETTE_MATCH_LIMIT,
  PALETTE_REST_LIMIT,
  paletteTemplates,
  paletteTokens,
  rankByQuery,
} from "./palette";

// The palette's search, as the server runs it for templates and the browser for its own rows.

const row = (id: string, name: string, status: PaletteTemplateRow["status"] = "active", team = "Coral Offers"): PaletteTemplateRow => ({
  id,
  name,
  teamSlug: team.toLowerCase().replace(/ /g, "-"),
  teamName: team,
  status,
});

// A space's templates as the server reads them: in name order.
const CORAL = [
  row("UC-AAAAAA", "Annual Fee Waiver", "changes_requested"),
  row("UC-BBBBBB", "Balance Transfer", "active"),
  row("UC-CCCCCC", "Cash Back", "in_review"),
  row("UC-DDDDDD", "Holiday Points", "revoked"),
];
const SAVINGS = row("UC-EEEEEE", "Savings Rate", "draft", "Deposits");

const ids = (rows: PaletteTemplateRow[]) => rows.map((t) => t.id);
const names = (rows: PaletteTemplateRow[]) => rows.map((t) => t.name);

describe("paletteTemplates at rest", () => {
  it("Recent is the viewer's latest templates, newest first; Templates the rest by name", () => {
    const listed = paletteTemplates({ templates: CORAL, query: "", recentIds: ["UC-CCCCCC", "UC-AAAAAA"], currentId: null });
    expect(ids(listed.recent)).toEqual(["UC-CCCCCC", "UC-AAAAAA"]);
    expect(ids(listed.templates)).toEqual(["UC-BBBBBB", "UC-DDDDDD"]);
  });

  it("Recent leaves out the template being viewed, which stays in Templates", () => {
    const listed = paletteTemplates({ templates: CORAL, query: "", recentIds: ["UC-BBBBBB", "UC-AAAAAA"], currentId: "UC-BBBBBB" });
    expect(ids(listed.recent)).toEqual(["UC-AAAAAA"]);
    expect(ids(listed.templates)).toEqual(["UC-BBBBBB", "UC-CCCCCC", "UC-DDDDDD"]);
  });

  it("Recent skips templates the viewer can't see in the space, and keeps five", () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`UC-00000${i}`, `Template ${i}`));
    const recentIds = ["UC-ZZZZZZ", ...many.map((t) => t.id).reverse()];
    const listed = paletteTemplates({ templates: many, query: "", recentIds, currentId: null });
    expect(ids(listed.recent)).toEqual(["UC-000008", "UC-000007", "UC-000006", "UC-000005", "UC-000004"]);
  });

  it("Templates is a first page; typing finds the rest", () => {
    const many = Array.from({ length: PALETTE_REST_LIMIT + 4 }, (_, i) => row(`UC-1000${String(i).padStart(2, "0")}`, `Notice ${String(i).padStart(2, "0")}`));
    const listed = paletteTemplates({ templates: many, query: "", recentIds: [], currentId: null });
    expect(listed.templates).toHaveLength(PALETTE_REST_LIMIT);
    expect(names(listed.templates)[0]).toBe("Notice 00");
    const found = paletteTemplates({ templates: many, query: "notice 11", recentIds: [], currentId: null });
    expect(names(found.templates)).toEqual(["Notice 11"]);
  });
});

describe("paletteTemplates while searching", () => {
  const search = (query: string, templates = [...CORAL, SAVINGS], recentIds: string[] = []) =>
    paletteTemplates({ templates, query, recentIds, currentId: null });

  it("has no Recent, and every word must match the name, the team, the id or the status", () => {
    expect(search("a", CORAL, ["UC-BBBBBB"]).recent).toEqual([]);
    expect(names(search("cash back").templates)).toEqual(["Cash Back"]);
    expect(names(search("deposits").templates)).toEqual(["Savings Rate"]);
    expect(names(search("uc-cc").templates)).toEqual(["Cash Back"]);
    expect(names(search("cash zzz").templates)).toEqual([]);
  });

  it("matches the status as the badge words it", () => {
    expect(names(search("draft").templates)).toEqual(["Savings Rate"]);
    expect(names(search("active").templates)).toEqual(["Balance Transfer"]);
    expect(names(search("in review").templates)).toEqual(["Cash Back"]);
    expect(names(search("changes requested").templates)).toEqual(["Annual Fee Waiver"]);
  });

  it("ranks a name that starts with the word, then a word of the name, then the rest", () => {
    const templates = [row("UC-1", "Annual Points"), row("UC-2", "Holiday Points"), row("UC-3", "Pointsplus"), row("UC-4", "Checkpoint")];
    expect(names(search("point", templates).templates)).toEqual(["Pointsplus", "Annual Points", "Holiday Points", "Checkpoint"]);
  });

  it("recent templates win ties, newest first", () => {
    const listed = search("a", CORAL, ["UC-CCCCCC", "UC-BBBBBB"]);
    // Annual Fee Waiver starts with "a"; the other three have it inside a word.
    expect(names(listed.templates)).toEqual(["Annual Fee Waiver", "Cash Back", "Balance Transfer", "Holiday Points"]);
  });

  it("answers at most a page of matches", () => {
    const many = Array.from({ length: PALETTE_MATCH_LIMIT + 5 }, (_, i) => row(`UC-2000${String(i).padStart(2, "0")}`, `Notice ${i}`));
    expect(search("notice", many).templates).toHaveLength(PALETTE_MATCH_LIMIT);
  });
});

describe("the matching rule", () => {
  it("reads a search as lowercased words", () => {
    expect(paletteTokens("  Cash   BACK ")).toEqual(["cash", "back"]);
    expect(normalizePaletteQuery("  Cash   BACK ")).toBe("cash back");
    expect(normalizePaletteQuery("   ")).toBe("");
  });

  it("ranks any list by a label and extra words, and keeps everything in order with no words", () => {
    const rows = [{ label: "Settings", extra: "platform" }, { label: "Teams", extra: "" }, { label: "Library", extra: "" }];
    const text = (r: (typeof rows)[number]): [string, string] => [r.label, r.extra];
    expect(rankByQuery(rows, [], text)).toEqual(rows);
    expect(rankByQuery(rows, paletteTokens("platform"), text).map((r) => r.label)).toEqual(["Settings"]);
    expect(rankByQuery(rows, paletteTokens("t"), text).map((r) => r.label)).toEqual(["Teams", "Settings"]);
  });
});
