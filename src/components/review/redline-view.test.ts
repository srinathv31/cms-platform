import { describe, expect, it } from "vitest";
import { REDLINE_DOC } from "@/components/redline/redline-fixtures";
import type { ThreadView } from "@/domain/review-types";
import { threadsForMarkers } from "./redline-view";

const thread = (id: string, blockId: string): ThreadView => ({
  id,
  blockId,
  quote: null,
  status: "open",
  originVersionNumber: 1,
  comments: [],
  orphaned: false,
});

describe("threadsForMarkers", () => {
  const threads = [thread("a", "p-1"), thread("b", "p-2"), thread("c", "p-3"), thread("d", "h-1"), thread("e", "p-6")];

  it("leaves every thread on its block when the whole redline shows", () => {
    expect(threadsForMarkers(REDLINE_DOC, false, null, threads)).toBe(threads);
  });

  it("moves threads on hidden blocks onto the line they are collapsed into, so none is without a marker", () => {
    const placed = threadsForMarkers(REDLINE_DOC, true, null, threads).map((t) => t.blockId);
    // p-1 and p-2 share the "2 unchanged blocks" line; the heading's thread sits on its caption.
    expect(placed).toEqual(["collapsed:p-1", "collapsed:p-1", "p-3", "collapsed:h-1", "collapsed:p-6"]);
  });

  it("keeps the thread being read on its block, which shows in place", () => {
    const placed = threadsForMarkers(REDLINE_DOC, true, "p-2", threads).map((t) => t.blockId);
    expect(placed).toEqual(["collapsed:p-1", "p-2", "p-3", "collapsed:h-1", "collapsed:p-6"]);
  });
});
