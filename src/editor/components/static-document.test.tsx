// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { JSONContent, Variable } from "../model/types";
import { createVariableStore } from "../state/variable-store";
import { StaticDocument } from "./static-document";

const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" },
];

const DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { id: "h-1", level: 2, requiredKey: "rates_and_fees" }, content: [{ type: "text", text: "Rates and fees" }] },
    {
      type: "paragraph",
      attrs: { id: "p-1" },
      content: [
        { type: "text", text: "Hi " },
        { type: "variable", attrs: { key: "first_name" } },
        { type: "text", text: ", your fee is " },
        { type: "variable", attrs: { key: "annual_fee" } },
        { type: "text", text: " and " },
        { type: "variable", attrs: { key: "promo_code" } },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
      ],
    },
    { type: "callout", attrs: { id: "c-1" }, content: [{ type: "paragraph", attrs: { id: "p-2" }, content: [{ type: "text", text: "Note" }] }] },
    { type: "paragraph", attrs: { id: "p-3" } },
  ],
};

describe("StaticDocument", () => {
  const html = renderToStaticMarkup(<StaticDocument content={DOC} variables={VARIABLES} />);

  it("renders chips with labels and type", () => {
    expect(html).toMatch(/<span[^>]*data-variable="first_name"[^>]*data-variable-type="text"[^>]*>.*First name<\/span>/);
    expect(html).toMatch(/data-variable="annual_fee"[^>]*data-variable-type="currency"[^>]*>.*Annual fee<\/span>/);
  });

  it("shows an unknown key in the warning style", () => {
    expect(html).toMatch(/data-variable="promo_code"[^>]*data-unknown=""/);
    expect(html).toContain("promo_code</span>");
    expect(html).toContain("bg-warning-soft");
    expect(html).toContain("border-warning-border");
    expect(html).toContain("text-warning-text");
    expect(html).not.toContain("status-review");
  });

  it("uses the editor's markup: block ids, data-required, callout, marks", () => {
    expect(html).toContain('<h2 data-id="h-1" data-required="rates_and_fees">Rates and fees</h2>');
    expect(html).toContain('<div data-callout="" data-id="c-1"><p data-id="p-2">Note</p></div>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<p data-id="p-3"></p>');
  });

  it("wraps the document in the same surface/doc classes as the live editor", () => {
    expect(html).toMatch(/^<div class="ucomp-surface relative" data-static-document=""><div class="ucomp-doc">/);
  });
});

describe("variable store", () => {
  it("keeps unchanged variables' identity so chips don't re-render", () => {
    const store = createVariableStore(VARIABLES);
    const before = store.getState().byKey.get("first_name");
    store.getState().setVariables(VARIABLES.map((v) => ({ ...v })));
    expect(store.getState().byKey.get("first_name")).toBe(before);

    store.getState().setVariables(VARIABLES.map((v) => (v.key === "first_name" ? { ...v, label: "Given name" } : { ...v })));
    expect(store.getState().byKey.get("first_name")?.label).toBe("Given name");
    expect(store.getState().byKey.get("annual_fee")).toBe(VARIABLES[1]);
  });
});
