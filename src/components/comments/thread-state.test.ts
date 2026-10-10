import { describe, expect, it } from "vitest";
import { DOCUMENT_THREAD, type Person, type ThreadView } from "@/domain/review-types";
import type { JSONContent } from "@/domain/types";
import {
  groupThreads,
  insertThread,
  isOptimistic,
  liveBlockPresence,
  openCount,
  optimisticId,
  reduceThreads,
  samePresence,
  withBlockPresence,
} from "./thread-state";

const MAYA: Person = { id: "maya", name: "Maya Chen", initials: "MC", hue: 28 };

function thread(id: string, blockId: string, patch: Partial<ThreadView> = {}): ThreadView {
  return {
    id,
    blockId,
    quote: null,
    status: "open",
    originVersionNumber: 1,
    originRound: 1,
    originLabel: "v1",
    comments: [{ id: `c-${id}`, author: MAYA, body: "Text", kind: "comment", createdAt: "2027-02-18T10:00:00Z" }],
    orphaned: false,
    ...patch,
  };
}

const ids = (list: readonly ThreadView[]) => list.map((t) => t.id);

describe("groupThreads", () => {
  const list = [
    thread("doc", DOCUMENT_THREAD),
    thread("a", "b1"),
    thread("done", "b2", { status: "resolved", resolvedBy: MAYA, resolvedAt: "2027-02-18T11:00:00Z" }),
    thread("b", "b3"),
    thread("gone", "b9", { orphaned: true }),
    thread("doc-done", DOCUMENT_THREAD, { status: "resolved" }),
  ];

  it("puts the change request first, then open threads in the order they came, then orphaned ones, with resolved ones apart", () => {
    const groups = groupThreads(list);
    expect(ids(groups.document)).toEqual(["doc"]);
    expect(ids(groups.anchored)).toEqual(["a", "b"]);
    expect(ids(groups.orphaned)).toEqual(["gone"]);
    expect(ids(groups.resolved)).toEqual(["done", "doc-done"]);
  });

  it("counts the open ones, the number on the Comments tab", () => {
    expect(openCount(list)).toBe(4);
  });
});

describe("reduceThreads", () => {
  const base = [thread("a", "b1"), thread("b", "b2")];

  it("adds a reply to its thread", () => {
    const comment = { id: "new", author: MAYA, body: "Done", kind: "comment" as const, createdAt: "2027-02-18T12:00:00Z" };
    const next = reduceThreads(base, { type: "reply", threadId: "a", comment });
    expect(next[0].comments.map((c) => c.id)).toEqual(["c-a", "new"]);
    expect(next[1]).toBe(base[1]);
  });

  it("resolves an open thread, with who and when, and leaves a resolved one alone", () => {
    const next = reduceThreads(base, { type: "resolve", threadId: "a", by: MAYA, at: "2027-02-18T12:00:00Z" });
    expect(next[0]).toMatchObject({ status: "resolved", resolvedBy: MAYA, resolvedAt: "2027-02-18T12:00:00Z" });
    const again = reduceThreads(next, { type: "resolve", threadId: "a", by: { ...MAYA, name: "Someone" }, at: "later" });
    expect(again[0].resolvedBy).toBe(MAYA);
  });

  it("reopens a resolved thread and forgets who resolved it", () => {
    const resolved = reduceThreads(base, { type: "resolve", threadId: "b", by: MAYA, at: "2027-02-18T12:00:00Z" });
    const next = reduceThreads(resolved, { type: "reopen", threadId: "b" });
    expect(next[1].status).toBe("open");
    expect(next[1]).not.toHaveProperty("resolvedBy");
    expect(next[1]).not.toHaveProperty("resolvedAt");
  });

  it("doesn't change the list it was given", () => {
    const copy = structuredClone(base);
    reduceThreads(base, { type: "resolve", threadId: "a", by: MAYA, at: "x" });
    expect(base).toEqual(copy);
  });
});

describe("insertThread", () => {
  const list = [thread("doc", DOCUMENT_THREAD), thread("a", "b1"), thread("c", "b3"), thread("gone", "b9", { orphaned: true })];
  const position = (blockId: string) => ({ b1: 10, b2: 20, b3: 30, b4: 40, b9: null })[blockId as "b1"] ?? null;

  it("puts a thread on a block that has threads right after them", () => {
    expect(ids(insertThread(list, thread("new", "b1")))).toEqual(["doc", "a", "new", "c", "gone"]);
  });

  it("finds its place by where the block is in the document", () => {
    expect(ids(insertThread(list, thread("new", "b2"), position))).toEqual(["doc", "a", "new", "c", "gone"]);
    expect(ids(insertThread(list, thread("last", "b4"), position))).toEqual(["doc", "a", "c", "last", "gone"]);
  });

  it("goes after the anchored threads and before the orphaned ones when it can't tell where its block is", () => {
    expect(ids(insertThread(list, thread("new", "b2")))).toEqual(["doc", "a", "c", "new", "gone"]);
  });

  it("puts a thread about the whole version first", () => {
    expect(ids(insertThread(list, thread("change", DOCUMENT_THREAD)))[0]).toBe("change");
  });
});

describe("optimistic ids", () => {
  it("are recognizable", () => {
    expect(isOptimistic(optimisticId("thread", 3))).toBe(true);
    expect(isOptimistic("th_4F7K2Q")).toBe(false);
  });
});

describe("threads against the live document", () => {
  const para = (id: string): JSONContent => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text: "x" }] });
  const doc = (...ids: string[]): JSONContent => ({ type: "doc", content: ids.map(para) });
  const nestedDoc: JSONContent = {
    type: "doc",
    content: [{ type: "bulletList", attrs: { id: "l1" }, content: [{ type: "listItem", attrs: { id: "li1" }, content: [para("p9")] }] }],
  };

  it("says which blocks are in the document, top-level and nested", () => {
    expect([...liveBlockPresence(doc("a", "b"), ["a", "c"])]).toEqual([["a", true], ["c", false]]);
    expect([...liveBlockPresence(nestedDoc, ["l1", "li1", "p9", "zz"])]).toEqual([
      ["l1", true],
      ["li1", true],
      ["p9", true],
      ["zz", false],
    ]);
  });

  it("compares two presences", () => {
    expect(samePresence(new Map([["a", true]]), new Map([["a", true]]))).toBe(true);
    expect(samePresence(new Map([["a", true]]), new Map([["a", false]]))).toBe(false);
    expect(samePresence(new Map([["a", true]]), new Map())).toBe(false);
  });

  it("orphans a thread whose block was deleted, and brings it back when the block returns", () => {
    const threads = [thread("t1", "b1"), thread("t2", "b2"), thread("gone", "b3", { orphaned: true }), thread("doc", DOCUMENT_THREAD)];
    const deleted = withBlockPresence(threads, new Map([["b1", false], ["b2", true], ["b3", false]]));
    expect(deleted.map((t) => t.orphaned)).toEqual([true, false, true, false]);
    const restored = withBlockPresence(deleted, new Map([["b1", true], ["b2", true], ["b3", false]]));
    expect(restored.map((t) => t.orphaned)).toEqual([false, false, true, false]);
  });

  it("lets the live document overrule the server when it has the block after all", () => {
    expect(withBlockPresence([thread("t", "b", { orphaned: true })], new Map([["b", true]]))[0].orphaned).toBe(false);
  });

  it("leaves a block it knows nothing about, and the list itself when nothing changes", () => {
    const threads = [thread("t1", "b1"), thread("t2", "b2", { orphaned: true })];
    expect(withBlockPresence(threads, new Map())).toBe(threads);
    expect(withBlockPresence(threads, new Map([["other", false]]))).toBe(threads);
    expect(withBlockPresence(threads, new Map([["b1", true], ["b2", false]]))).toBe(threads);
  });
});
