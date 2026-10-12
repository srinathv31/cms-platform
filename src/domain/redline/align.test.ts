import { describe, expect, it } from "vitest";
import { diffDocuments } from "./document";
import {
  NO_CHANGES,
  p,
  h,
  li,
  ul,
  table,
  doc,
  show,
  expectFaithful,
  statuses,
  block,
  EVERYTHING,
} from "./fixtures";

describe("diffDocuments: whole blocks", () => {
  it("reports nothing when nothing changed, and hands back the blocks as they are", () => {
    const next = structuredClone(EVERYTHING);
    const red = diffDocuments(EVERYTHING, next);
    expect(red.counts).toEqual(NO_CHANGES);
    expect(statuses(red)).toEqual(
      ["h1", "a", "l", "t", "c", "r", "z"].map((id) => `${id}:unchanged`),
    );
    red.blocks.forEach((b, k) => expect(b.node).toBe(next.content![k]));
    expectFaithful(EVERYTHING, next, red);
  });

  it("ignores id noise, editor default attributes and a link's target", () => {
    const base = doc(
      p(
        "a",
        {
          type: "text",
          text: "Read the terms",
          marks: [
            { type: "link", attrs: { href: "https://coral.example/terms" } },
          ],
        },
        ".",
      ),
      ul("l", ["One.", "Two."]),
      table("t", ["Fee"], [["$0"]]),
      h("h", 2, "Rates and fees"),
    );
    const next = doc(
      p(
        "a",
        {
          type: "text",
          text: "Read the terms",
          marks: [
            {
              type: "link",
              attrs: {
                href: "https://coral.example/terms",
                target: "_blank",
                rel: "noopener noreferrer nofollow",
                class: null,
              },
            },
          ],
        },
        ".",
      ),
      {
        type: "bulletList",
        attrs: { id: "l" },
        content: [li("One.", "x1"), li("Two.", "x2")].map((item) => ({
          ...item,
          content: [
            p(
              "np" + String(item.attrs?.id),
              String(item.content![0].content![0].text),
            ),
          ],
        })),
      },
      {
        type: "table",
        attrs: { id: "t" },
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [p("c1", "Fee")],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [p("c2", "$0")],
              },
            ],
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2, id: "h" },
        content: [{ type: "text", text: "Rates and fees" }],
      },
    );
    const red = diffDocuments(base, next);
    expect(red.counts).toEqual(NO_CHANGES);
  });

  it("finds a paragraph added", () => {
    const base = doc(p("a", "Alpha one."), p("b", "Beta two."));
    const next = doc(
      p("a", "Alpha one."),
      p("n", "New words."),
      p("b", "Beta two."),
    );
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["a:unchanged", "n:added", "b:unchanged"]);
    expect(red.counts).toEqual({ ...NO_CHANGES, added: 1 });
    expect(block(red, "n").node).toBe(next.content![1]);
    expectFaithful(base, next, red);
  });

  it("finds a paragraph removed, and keeps it where it was", () => {
    const base = doc(
      p("a", "Alpha one."),
      p("b", "Beta two."),
      p("c", "Gamma three."),
    );
    const next = doc(p("a", "Alpha one."), p("c", "Gamma three."));
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["a:unchanged", "b:removed", "c:unchanged"]);
    expect(block(red, "b").node).toBe(base.content![1]);
    expect(red.counts).toEqual({ ...NO_CHANGES, removed: 1 });
    expectFaithful(base, next, red);
  });

  it("finds a paragraph moved", () => {
    const base = doc(
      p("a", "Alpha one."),
      p("b", "Beta two."),
      p("c", "Gamma three."),
      p("d", "Delta four."),
    );
    const next = doc(
      p("a", "Alpha one."),
      p("c", "Gamma three."),
      p("d", "Delta four."),
      p("b", "Beta two."),
    );
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual([
      "a:unchanged",
      "c:unchanged",
      "d:unchanged",
      "b:moved",
    ]);
    expect(block(red, "b").movedFrom).toBe(1);
    expect(block(red, "b").node).toBe(next.content![3]);
    expect(red.counts).toEqual({ ...NO_CHANGES, moved: 1 });
    expectFaithful(base, next, red);
  });

  it("reports a moved and edited paragraph as changed, with where it came from", () => {
    const base = doc(
      p("a", "Alpha one."),
      p("b", "Beta two."),
      p("c", "Gamma three."),
    );
    const next = doc(
      p("b", "Beta two."),
      p("c", "Gamma three."),
      p("a", "Alpha one, edited."),
    );
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual(["b:unchanged", "c:unchanged", "a:changed"]);
    expect(block(red, "a").movedFrom).toBe(0);
    expect(show(block(red, "a").node)).toBe("Alpha one{+, edited+}.");
    expect(red.counts).toEqual({ ...NO_CHANGES, changed: 1 });
    expectFaithful(base, next, red);
  });

  it("adds, removes and moves in one document", () => {
    const base = doc(
      p("a", "Alpha one."),
      p("b", "Beta two."),
      p("c", "Gamma three."),
      p("d", "Delta four."),
      p("e", "Epsilon five."),
    );
    const next = doc(
      p("e", "Epsilon five."),
      p("a", "Alpha one."),
      p("n", "New words."),
      p("c", "Gamma three."),
      p("d", "Delta four."),
    );
    const red = diffDocuments(base, next);
    expect(statuses(red)).toEqual([
      "e:moved",
      "a:unchanged",
      "b:removed",
      "n:added",
      "c:unchanged",
      "d:unchanged",
    ]);
    expect(red.counts).toEqual({ added: 1, removed: 1, changed: 0, moved: 1 });
    expectFaithful(base, next, red);
  });

  it("never pairs two blocks that both have ids, different ones", () => {
    const base = doc(p("x", "Same words here."));
    const next = doc(p("y", "Same words here."));
    expect(statuses(diffDocuments(base, next))).toEqual([
      "x:removed",
      "y:added",
    ]);
  });
});
