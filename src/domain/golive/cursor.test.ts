import { describe, expect, it } from "vitest";
import {
  compareSearchKeys,
  cutPage,
  noticeCursor,
  readNoticeCursor,
  readSearchCursor,
  searchCursor,
  type SearchKey,
} from "./cursor";

const BAD = { ok: false, error: { code: "bad_request", message: "after must be the nextCursor of an earlier page of this list." } };
const CORAL = { consumerId: "coral", templateId: null };

/** A cursor-shaped string with any JSON inside. */
const forge = (body: unknown) => Buffer.from(JSON.stringify(body)).toString("base64url");

describe("notice cursors", () => {
  it("round-trip the seq for the same consumer and filter; no after is the start", () => {
    expect(readNoticeCursor(noticeCursor(CORAL, 42), CORAL)).toEqual({ ok: true, value: 42 });
    expect(readNoticeCursor(noticeCursor(CORAL, 0), CORAL)).toEqual({ ok: true, value: 0 });
    const one = { consumerId: "coral", templateId: "UC-4F7K2Q" };
    expect(readNoticeCursor(` ${noticeCursor(one, 7)} `, one)).toEqual({ ok: true, value: 7 });
    expect(readNoticeCursor(null, CORAL)).toEqual({ ok: true, value: 0 });
    expect(readNoticeCursor("  ", CORAL)).toEqual({ ok: true, value: 0 });
  });

  it("are base64url, with no characters a URL would need to escape", () => {
    expect(noticeCursor({ consumerId: "deposits-online", templateId: "UC-4F7K2Q" }, 123456)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuse a cursor of another consumer, another filter or the search list", () => {
    expect(readNoticeCursor(noticeCursor({ consumerId: "deposits-online", templateId: null }, 3), CORAL)).toEqual(BAD);
    expect(readNoticeCursor(noticeCursor({ consumerId: "coral", templateId: "UC-4F7K2Q" }, 3), CORAL)).toEqual(BAD);
    expect(readNoticeCursor(noticeCursor(CORAL, 3), { consumerId: "coral", templateId: "UC-4F7K2Q" })).toEqual(BAD);
    expect(readNoticeCursor(searchCursor("", null), CORAL)).toEqual(BAD);
  });

  it.each([
    ["not base64url", "abc$def"],
    ["base64 but not JSON", Buffer.from("hello").toString("base64url")],
    ["a JSON array", forge([1, 2])],
    ["a timestamp", "2026-10-05T12:00:00Z"],
    ["another version", forge({ v: 2, list: "notices", consumer: "coral", template: null, seq: 3 })],
    ["a negative seq", forge({ v: 1, list: "notices", consumer: "coral", template: null, seq: -1 })],
    ["a fractional seq", forge({ v: 1, list: "notices", consumer: "coral", template: null, seq: 1.5 })],
    ["a seq as text", forge({ v: 1, list: "notices", consumer: "coral", template: null, seq: "3" })],
    ["no template field", forge({ v: 1, list: "notices", consumer: "coral", seq: 3 })],
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
});

describe("cutPage", () => {
  it("keeps the first limit rows and says whether more follow", () => {
    expect(cutPage([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
    expect(cutPage([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
    expect(cutPage([], 2)).toEqual({ items: [], hasMore: false });
  });
});
