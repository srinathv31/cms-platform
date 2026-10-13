import { describe, expect, it } from "vitest";
import type { DraftPatch, JSONContent } from "@/domain/types";
import { prepareDraftPatch } from "./prepare-patch";

// What the autosave route hands the backend: every document of the patch in stored form (docs/render-spec.md §3,
// decision 0065), or the check's refusal and nothing to save. Pure: no database, no service.

const SESSION = "6f1c2b7e-4a0d-4f43-9a58-3a6a1f0f7b21";

const t = (text: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const node = (
  type: string,
  attrs: Record<string, unknown> | null,
  ...content: JSONContent[]
): JSONContent => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});
const para = (text: string, id?: string): JSONContent =>
  node("paragraph", id ? { id } : null, t(text));
const doc = (...content: JSONContent[]): JSONContent => ({
  type: "doc",
  content,
});

function prepared(patch: Partial<DraftPatch>): DraftPatch {
  const result = prepareDraftPatch({ rev: 5, sessionKey: SESSION, ...patch });
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.patch;
}

describe("prepareDraftPatch: the documents in stored form", () => {
  it("leaves the patch's other fields as they are, and a patch without documents unchanged", () => {
    const patch: DraftPatch = {
      rev: 5,
      sessionKey: SESSION,
      name: "Annual fee waiver",
      channels: ["pdf"],
      variables: [],
      sampleSets: [],
      "email.subject": null,
    };
    expect(prepareDraftPatch(patch)).toEqual({ ok: true, patch });
  });

  it("gives blocks without an id one, and keeps the ids they have", () => {
    const content = prepared({
      body: doc(para("Has id", "keep-me"), para("No id")),
    }).body!.content!;
    expect(content[0]!.attrs?.id).toBe("keep-me");
    expect(content[1]!.attrs?.id).toEqual(expect.stringMatching(/.{8,}/));
  });

  it("tabs, heading levels, invisible characters, cell attributes, TipTap's list type, links and ragged rows", () => {
    const body = prepared({
      body: doc(
        node("heading", { id: "h", level: 5 }, t("Fees\t20­27‎"), {
          type: "hardBreak",
        }),
        node(
          "paragraph",
          { id: "p" },
          t("Terms", [
            { type: "link", attrs: { href: " HTTPS://Coral.Example/café " } },
          ]),
          t(" or "),
          t("here", [{ type: "link", attrs: { href: "javascript:x" } }]),
        ),
        node(
          "orderedList",
          { id: "l", start: 2, type: "a" },
          node("listItem", { id: "i" }, node("paragraph", { id: "q" }, t("x"))),
        ),
        node(
          "table",
          { id: "t" },
          node(
            "tableRow",
            null,
            node(
              "tableCell",
              { align: "center", colwidth: [90] },
              node("paragraph", { id: "a" }, t("a")),
            ),
            node("tableCell", null, node("paragraph", { id: "b" }, t("b"))),
          ),
          node(
            "tableRow",
            null,
            node("tableCell", null, node("paragraph", { id: "c" }, t("c"))),
          ),
        ),
      ),
    }).body!;
    const [heading, paragraph, list, table] = body.content!;
    // A hard break at the end stays: the editor shows the line after it.
    expect(heading).toEqual(
      node(
        "heading",
        { id: "h", level: 3, requiredKey: null },
        t("Fees 2027"),
        { type: "hardBreak" },
      ),
    );
    // (Giving ids round-trips through the schema: adjacent plain runs merge, the link's defaults are written.)
    expect(
      paragraph!.content?.map((run) => [
        run.text,
        run.marks?.map((m) => m.attrs?.href),
      ]),
    ).toEqual([
      ["Terms", ["https://Coral.Example/caf%C3%A9"]],
      [" or here", undefined],
    ]);
    expect(list!.attrs).toEqual({
      id: "l",
      start: 2,
      markerFormat: null,
      markerDelimiter: null,
    });
    expect(table!.content![0]!.content![0]!.attrs).toEqual({
      colspan: 1,
      rowspan: 1,
    });
    expect(table!.content![1]!.content).toHaveLength(2);
  });

  it("content a cell can't hold stays in the cell as paragraphs", () => {
    const body = prepared({
      body: doc(
        node(
          "table",
          { id: "t" },
          node(
            "tableRow",
            null,
            node(
              "tableCell",
              null,
              node("heading", { level: 2 }, t("Fee")),
              node("callout", null, node("paragraph", null, t("Note"))),
            ),
          ),
        ),
      ),
    }).body!;
    const cell = body.content![0]!.content![0]!.content![0]!;
    expect(cell.content!.map((b) => [b.type, b.content?.[0]?.text])).toEqual([
      ["paragraph", "Fee"],
      ["paragraph", "Note"],
    ]);
  });

  it("the email fields: one line, no marks; a null still clears one", () => {
    const patch = prepared({
      "email.subject": doc(
        node(
          "paragraph",
          null,
          t("Your\tAPR", [{ type: "bold" }]),
          { type: "hardBreak" },
          t("changes"),
        ),
      ),
      "email.preheader": null,
    });
    expect(patch["email.subject"]).toEqual(
      doc(node("paragraph", null, t("Your APR"), t(" "), t("changes"))),
    );
    expect(patch["email.preheader"]).toBeNull();
  });

  it("an SMS keeps its line breaks", () => {
    const patch = prepared({
      "sms.text": doc(
        node(
          "paragraph",
          null,
          t("Coral: line one"),
          { type: "hardBreak" },
          t("line two"),
        ),
      ),
    });
    expect(JSON.stringify(patch["sms.text"]).includes('"hardBreak"')).toBe(
      true,
    );
  });
});

describe("prepareDraftPatch: a document the check refuses is invalid_input, with the check's sentence", () => {
  const item = (text: string, ...more: JSONContent[]): JSONContent => ({
    type: "listItem",
    content: [para(text), ...more],
  });
  const deep = (levels: number): JSONContent => {
    let list: JSONContent = { type: "bulletList", content: [item("deepest")] };
    for (let level = 1; level < levels; level++)
      list = { type: "bulletList", content: [item(`level ${level}`, list)] };
    return list;
  };
  const row = (n: number, attrs?: Record<string, unknown>): JSONContent => ({
    type: "tableRow",
    content: Array.from({ length: n }, () => ({
      type: "tableCell",
      ...(attrs ? { attrs } : {}),
      content: [para("x")],
    })),
  });

  it.each<[string, JSONContent, string]>([
    [
      "a list start of 10000",
      doc({
        type: "orderedList",
        attrs: { start: 10000 },
        content: [item("x")],
      }),
      "A numbered list can start at 0 to 9999.",
    ],
    [
      "an unknown numbering style",
      doc({
        type: "orderedList",
        attrs: { markerFormat: "greek" },
        content: [item("x")],
      }),
      "This list's numbering style isn't one Stencil knows.",
    ],
    ["lists ten deep", doc(deep(10)), "Lists can nest at most 9 levels deep."],
    [
      "a colspan of 0",
      doc({ type: "table", content: [row(2, { colspan: 0 })] }),
      "This table's cells don't line up into rows and columns.",
    ],
    [
      "a heading of level 9",
      doc({
        type: "heading",
        attrs: { level: 9 },
        content: [{ type: "text", text: "x" }],
      }),
      "Headings can only be levels 1 to 3.",
    ],
    [
      "an unknown node",
      doc({ type: "iframe", attrs: { src: "https://example.com" } }),
      "This document has content Stencil doesn't support.",
    ],
  ])("refuses %s", (_, body, message) => {
    expect(prepareDraftPatch({ rev: 5, sessionKey: SESSION, body })).toEqual({
      ok: false,
      code: "invalid_input",
      reason: message,
    });
  });

  it("refuses an email subject that isn't one line, in the channel's words", () => {
    expect(
      prepareDraftPatch({
        rev: 5,
        sessionKey: SESSION,
        "email.subject": doc(para("a"), {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "b" }],
        }),
      }),
    ).toEqual({
      ok: false,
      code: "invalid_input",
      reason:
        "The email subject and preheader can hold only one line of text and variables.",
    });
  });

  it("refuses the body before the channel fields", () => {
    expect(
      prepareDraftPatch({
        rev: 5,
        sessionKey: SESSION,
        body: doc({ type: "iframe" }),
        "email.subject": doc(para("a"), para("b")),
      }),
    ).toMatchObject({
      reason: "This document has content Stencil doesn't support.",
    });
  });
});
