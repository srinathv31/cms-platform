// @vitest-environment happy-dom
// The server render of a root: the panel shows usage counts when it renders after the document,
// and leaves them out (rows not muted) when it renders first, so hydration matches either way.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { JSONContent, Variable } from "../model/types";
import { DocumentEditor } from "./document-editor";
import { EditorRoot } from "./editor-root";
import { VariablesPanel } from "./variables-panel";

const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
  { key: "bonus_points", label: "Bonus points", type: "number", required: false, sample: "20000" },
];

const BASELINE: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "purchase_apr", label: "Purchase APR", type: "number", required: true, sample: "21.99" },
  { key: "promo_code", label: "Promo code", type: "text", required: false, sample: "" },
];

const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });
const DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "paragraph", attrs: { id: "p-1" }, content: [{ type: "text", text: "Hi " }, chip("first_name"), chip("first_name")] },
    { type: "paragraph", attrs: { id: "p-2" }, content: [chip("purchase_apr")] },
  ],
};

const rowHtml = (html: string, key: string) => html.match(new RegExp(`<li[^>]*data-variable-row="${key}"[\\s\\S]*?</li>`))?.[0] ?? "";

describe("VariablesPanel server render", () => {
  it("shows counts and mutes unused rows when the document renders first", () => {
    const html = renderToStaticMarkup(
      <EditorRoot variables={VARIABLES}>
        <DocumentEditor content={DOC} />
        <VariablesPanel />
      </EditorRoot>,
    );
    expect(rowHtml(html, "first_name")).toContain("2 uses");
    expect(rowHtml(html, "purchase_apr")).toContain("1 use");
    expect(rowHtml(html, "bonus_points")).toContain("Unused");
    expect(rowHtml(html, "bonus_points")).toContain("data-unused");
    expect(rowHtml(html, "first_name")).not.toContain("data-unused");
  });

  it("leaves counts out (rows not muted) when the panel renders before the document", () => {
    const html = renderToStaticMarkup(
      <EditorRoot variables={VARIABLES}>
        <VariablesPanel />
        <DocumentEditor content={DOC} />
      </EditorRoot>,
    );
    expect(rowHtml(html, "first_name")).not.toContain("uses");
    expect(html).not.toContain("data-unused");
  });

  it("is display-only when read-only: no insert buttons, edit or New variable", () => {
    const html = renderToStaticMarkup(
      <EditorRoot variables={VARIABLES} readOnly>
        <DocumentEditor content={DOC} />
        <VariablesPanel />
      </EditorRoot>,
    );
    expect(html).not.toContain("data-row-insert");
    expect(html).not.toContain("Edit First name");
    expect(html).not.toContain("New variable");
    expect(html).not.toContain('draggable="true"');
    expect(rowHtml(html, "first_name")).toContain("2 uses");
    // No disabled controls: a quiet word for required, nothing for optional.
    expect(html).not.toContain('role="switch"');
    expect(rowHtml(html, "first_name")).toMatch(/>Required<\/span>/);
    expect(rowHtml(html, "bonus_points")).not.toContain("Required");
  });

  it("flags contract changes against a baseline, breaking apart from non-breaking", () => {
    const html = renderToStaticMarkup(
      <EditorRoot variables={VARIABLES} baseline={BASELINE}>
        <VariablesPanel />
      </EditorRoot>,
    );
    expect(rowHtml(html, "purchase_apr")).toMatch(/bg-warning-soft[^>]*>.*Type changed/);
    expect(rowHtml(html, "bonus_points")).toMatch(/bg-surface-tinted[^>]*>New</);
    expect(rowHtml(html, "first_name")).not.toContain("changed");
    expect(html).toMatch(/Removed .*promo_code/);
  });
});
