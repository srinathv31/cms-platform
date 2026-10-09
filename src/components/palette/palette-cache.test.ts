import { describe, expect, it } from "vitest";
import type { PaletteResults } from "@/domain/import-types";
import { emptyPaletteCache, nearestAnswer, PALETTE_CACHE_SIZE, withAnswer, type PaletteAsk } from "./palette-cache";

// The palette's answers are one viewer's: filed under the viewer, the space, the template being viewed
// and the search, and never kept or found for anybody else.

const ask = (over: Partial<PaletteAsk> = {}): PaletteAsk => ({ viewerId: "maya", space: "coral-offers", current: null, query: "", ...over });

const results = (over: Partial<PaletteResults> = {}): PaletteResults => ({
  viewerId: "maya",
  space: "coral-offers",
  query: "",
  canCreate: true,
  current: false,
  recent: [],
  templates: [{ id: "UC-AAAAAA", name: "Cash Back", teamSlug: "coral-offers", teamName: "Coral Offers", status: "active" }],
  ...over,
});

describe("the palette's cache", () => {
  it("is keyed by viewer: another viewer's question finds nothing, in the same space and search", () => {
    const cache = withAnswer(emptyPaletteCache("maya"), ask(), results());
    expect(nearestAnswer(cache, ask())).toEqual({ results: results(), exact: true });
    expect(nearestAnswer(cache, ask({ viewerId: "sam" }))).toBeNull();
  });

  it("never keeps an answer asked or read for somebody else", () => {
    const maya = emptyPaletteCache("maya");
    expect(withAnswer(maya, ask({ viewerId: "sam" }), results({ viewerId: "sam" }))).toBe(maya);
    // Asked as Maya, but read for Sam (the persona changed while it was asked).
    expect(withAnswer(maya, ask(), results({ viewerId: "sam" }))).toBe(maya);
  });

  it("a persona change starts an empty cache: nothing of the last viewer's is found", () => {
    const mayas = withAnswer(emptyPaletteCache("maya"), ask(), results());
    const sams = emptyPaletteCache("sam");
    expect(sams.answers.size).toBe(0);
    expect(nearestAnswer(sams, ask({ viewerId: "sam" }))).toBeNull();
    expect(nearestAnswer(sams, ask())).toBeNull();
    expect(nearestAnswer(mayas, ask())).not.toBeNull();
  });

  it("files answers by space and by the template being viewed", () => {
    const cache = withAnswer(emptyPaletteCache("maya"), ask(), results());
    expect(nearestAnswer(cache, ask({ space: "deposits" }))).toBeNull();
    expect(nearestAnswer(cache, ask({ current: "UC-AAAAAA" }))).toBeNull();
  });

  it("offers the answer to a shorter search while a longer one is asked, to narrow", () => {
    let cache = withAnswer(emptyPaletteCache("maya"), ask(), results());
    cache = withAnswer(cache, ask({ query: "cash" }), results({ query: "cash" }));
    expect(nearestAnswer(cache, ask({ query: "cash b" }))).toEqual({ results: results({ query: "cash" }), exact: false });
    expect(nearestAnswer(cache, ask({ query: "bal" }))).toEqual({ results: results(), exact: false });
    // Not a search the typed one extends.
    expect(nearestAnswer(withAnswer(emptyPaletteCache("maya"), ask({ query: "cash" }), results({ query: "cash" })), ask({ query: "cas" }))).toBeNull();
  });

  it("keeps the newest answers", () => {
    let cache = emptyPaletteCache("maya");
    for (let i = 0; i <= PALETTE_CACHE_SIZE; i++) cache = withAnswer(cache, ask({ query: `q${i}` }), results({ query: `q${i}` }));
    expect(cache.answers.size).toBe(PALETTE_CACHE_SIZE);
    expect(nearestAnswer(cache, ask({ query: "q0" }))).toBeNull();
    expect(nearestAnswer(cache, ask({ query: `q${PALETTE_CACHE_SIZE}` }))?.exact).toBe(true);
  });
});
