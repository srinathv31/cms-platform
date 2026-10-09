import { describe, expect, it } from "vitest";
import {
  compareCodePoints,
  compareSearchKeys,
  cutPage,
  noticeCursor,
  readNoticeCursor,
  readSearchCursor,
  searchCursor,
  type SearchKey,
} from "./cursor";

const BAD = { ok: false, error: { code: "bad_request", message: "after must be the nextCursor of an earlier page of this list." } };
const STALE = { ok: false, error: { code: "bad_request", message: "after is from before the notices were reset. Start again without after." } };
const EPOCH = "2026-10-04T12:00:00.000Z";
const CORAL = { consumerId: "coral", templateId: null, epoch: EPOCH };
const ONE = { consumerId: "coral", templateId: "UC-4F7K2Q", epoch: EPOCH };

/** A cursor-shaped string with any JSON inside. */
const forge = (body: unknown) => Buffer.from(JSON.stringify(body)).toString("base64url");
const notices = (over: Record<string, unknown>) => forge({ v: 1, list: "notices", consumer: "coral", template: null, epoch: EPOCH, seq: 3, ...over });

describe("notice cursors", () => {
  it("round-trip the seq for the same consumer, filter and epoch; no after is the start", () => {
    expect(readNoticeCursor(noticeCursor(CORAL, 42), CORAL)).toEqual({ ok: true, value: 42 });
    expect(readNoticeCursor(noticeCursor(CORAL, 0), CORAL)).toEqual({ ok: true, value: 0 });
    expect(readNoticeCursor(` ${noticeCursor(ONE, 7)} `, ONE)).toEqual({ ok: true, value: 7 });
    expect(readNoticeCursor(null, CORAL)).toEqual({ ok: true, value: 0 });
    expect(readNoticeCursor("  ", CORAL)).toEqual({ ok: true, value: 0 });
    const unseeded = { ...CORAL, epoch: null };
    expect(readNoticeCursor(noticeCursor(unseeded, 5), unseeded)).toEqual({ ok: true, value: 5 });
  });

  it("are base64url, with no characters a URL would need to escape", () => {
    expect(noticeCursor({ consumerId: "deposits-online", templateId: "UC-4F7K2Q", epoch: EPOCH }, 123456)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuse a cursor of another consumer, another filter or the search list", () => {
    expect(readNoticeCursor(noticeCursor({ ...CORAL, consumerId: "deposits-online" }, 3), CORAL)).toEqual(BAD);
    expect(readNoticeCursor(noticeCursor(ONE, 3), CORAL)).toEqual(BAD);
    expect(readNoticeCursor(noticeCursor(CORAL, 3), ONE)).toEqual(BAD);
    expect(readNoticeCursor(searchCursor("", null), CORAL)).toEqual(BAD);
  });

  it("refuse a cursor from before a reset with its own sentence, rather than read it against new numbers", () => {
    const before = noticeCursor({ ...CORAL, epoch: "2026-10-01T09:00:00.000Z" }, 29);
    expect(readNoticeCursor(before, CORAL)).toEqual(STALE);
    expect(readNoticeCursor(noticeCursor({ ...CORAL, epoch: null }, 29), CORAL)).toEqual(STALE);
    expect(readNoticeCursor(noticeCursor(CORAL, 29), { ...CORAL, epoch: null })).toEqual(STALE);
  });

  it.each([
    ["not base64url", "abc$def"],
    ["base64 but not JSON", Buffer.from("hello").toString("base64url")],
    ["a JSON array", forge([1, 2])],
    ["a timestamp", "2026-10-05T12:00:00Z"],
    ["another version", notices({ v: 2 })],
    ["a negative seq", notices({ seq: -1 })],
    ["a fractional seq", notices({ seq: 1.5 })],
    ["a seq as text", notices({ seq: "3" })],
    ["no template field", forge({ v: 1, list: "notices", consumer: "coral", epoch: EPOCH, seq: 3 })],
    ["no epoch field", forge({ v: 1, list: "notices", consumer: "coral", template: null, seq: 3 })],
    ["an epoch that isn't text", notices({ epoch: 1 })],
    ["invalid UTF-8", Buffer.from([0x7b, 0xff, 0x7d]).toString("base64url")],
  ])("refuse %s", (_, raw) => {
    expect(readNoticeCursor(raw, CORAL)).toEqual(BAD);
  });
});

describe("search cursors", () => {
  const key: SearchKey = { rank: 1, name: "Rate Change Notice — Terms", id: "UC-4F7K2Q" };

  it("round-trip the last key for the same query, in any case and spacing at the ends", () => {
    expect(readSearchCursor(searchCursor("Rate", key), " rate ")).toEqual({ ok: true, value: key });
    expect(readSearchCursor(searchCursor("", null), "")).toEqual({ ok: true, value: null });
    expect(readSearchCursor(null, "rate")).toEqual({ ok: true, value: null });
  });

  it("refuse a cursor of another query, the notices list, or a bad key", () => {
    expect(readSearchCursor(searchCursor("rate", key), "balance")).toEqual(BAD);
    expect(readSearchCursor(noticeCursor(CORAL, 3), "")).toEqual(BAD);
    expect(readSearchCursor(forge({ v: 1, list: "search", q: "", last: { rank: 3, name: "x", id: "y" } }), "")).toEqual(BAD);
    expect(readSearchCursor(forge({ v: 1, list: "search", q: "", last: { rank: 0, name: 1, id: "y" } }), "")).toEqual(BAD);
    expect(readSearchCursor(forge({ v: 1, list: "search", q: "" }), "")).toEqual(BAD);
  });

  it("order by rank, then name, then id", () => {
    const keys: SearchKey[] = [
      { rank: 2, name: "Alpha", id: "UC-000002" },
      { rank: 1, name: "Zulu", id: "UC-000003" },
      { rank: 2, name: "Alpha", id: "UC-000001" },
      { rank: 0, name: "Mike", id: "UC-000004" },
    ];
    expect([...keys].sort(compareSearchKeys).map((k) => k.id)).toEqual(["UC-000004", "UC-000003", "UC-000001", "UC-000002"]);
  });

  it("compare names by code point, the same in every locale: capitals first, then lower case, then the rest", () => {
    const names = ["savings", "Zulu", "Éclair", "alpha", "Alpha", "Rate — Terms", "Rate Change", "Rate", "😀 Promo", "Ｒate"];
    expect([...names].sort(compareCodePoints)).toEqual(["Alpha", "Rate", "Rate Change", "Rate — Terms", "Zulu", "alpha", "savings", "Éclair", "Ｒate", "😀 Promo"]);
    // Outside the BMP, by code point (UTF-16 order would put U+1F600 before U+FF32).
    expect(compareCodePoints("😀", "Ｒ")).toBe(1);
    expect(compareCodePoints("Rate", "Rate")).toBe(0);
    expect(compareCodePoints("Rat", "Rate")).toBe(-1);
    expect(compareCodePoints("Rate", "Rat")).toBe(1);
    expect(compareCodePoints("", "")).toBe(0);
  });
});

describe("cutPage", () => {
  it("keeps the first limit rows and says whether more follow", () => {
    expect(cutPage([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
    expect(cutPage([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
    expect(cutPage([], 2)).toEqual({ items: [], hasMore: false });
  });
});
