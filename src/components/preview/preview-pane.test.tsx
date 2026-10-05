import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PreviewOutput } from "./render-preview";
import type { PreviewPaneProps } from "./preview-pane";
import { PreviewPane } from "./preview-pane";

// The PDF viewer loads pdf.js; what it draws isn't under test here.
vi.mock("./pdf/pdf-viewer", () => ({ PdfViewer: () => <div role="region" aria-label="PDF preview" /> }));

const noop = () => {};
/** The attribute, not the `disabled:` utility classes. */
const DISABLED = /\sdisabled(=""|\s|>)/;

const PDF: PreviewOutput = { kind: "pdf", bytes: new Uint8Array([1]), filename: "UC-4F7K2Q-draft.pdf" };
const VARIABLES = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
] as const;

function show(props: Partial<PreviewPaneProps>) {
  return renderToStaticMarkup(
    <PreviewPane
      channels={["pdf", "web", "email"]}
      channel="pdf"
      onChannel={noop}
      variables={VARIABLES}
      onEditValues={noop}
      device="desktop"
      onDevice={noop}
      slot={undefined}
      rendering={false}
      onRetry={noop}
      sender={{ name: "Coral Offers", address: "no-reply@coraloffers.example" }}
      recipient={null}
      {...props}
    />,
  );
}

const downloadTag = (html: string) => /<button[^>]*aria-label="Download PDF"[^>]*>/.exec(html)?.[0] ?? "";

describe("PreviewPane", () => {
  it("offers Download PDF once a good PDF is on screen", () => {
    const html = show({ slot: { output: PDF, error: null } });
    expect(downloadTag(html)).not.toBe("");
    expect(downloadTag(html)).not.toMatch(DISABLED);
  });

  it("waits for the first PDF", () => {
    expect(downloadTag(show({ slot: undefined }))).toMatch(DISABLED);
  });

  it("disables Download PDF while the pane shows an error, though the last good PDF is still in memory", () => {
    const html = show({
      slot: {
        output: PDF,
        error: {
          code: "missing_variables",
          message: "Missing required variables: first_name.",
          details: { missing: ["first_name"], invalid: [] },
        },
      },
    });
    expect(downloadTag(html)).toMatch(DISABLED);
    expect(html).toContain("First name needs a value.");
    expect(html).toContain("Edit values");
    expect(html).not.toContain("first_name");
  });

  it("holds the controls row at 32px on every channel, with the channel's own control at its right", () => {
    for (const channel of ["pdf", "web", "email"] as const) {
      const html = show({ channel });
      const row = /data-slot="preview-controls" class="([^"]*)"/.exec(html)?.[1] ?? /class="([^"]*)" data-slot="preview-controls"/.exec(html)?.[1] ?? "";
      expect(row, channel).toContain("h-8");
    }
    expect(show({ channel: "pdf" })).toContain('aria-label="Download PDF"');
    expect(show({ channel: "pdf" })).not.toContain('aria-label="Device"');
    expect(show({ channel: "web" })).toContain('aria-label="Device"');
    expect(show({ channel: "web" })).not.toContain('aria-label="Download PDF"');
    const email = show({ channel: "email" });
    expect(email).not.toContain('aria-label="Device"');
    expect(email).not.toContain('aria-label="Download PDF"');
  });
});
