import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChannelTabs, DevicePicker, DownloadPdfButton } from "./controls";
import { OutputError } from "./output-error";

const noop = () => {};
/** The attribute, not the `disabled:` utility classes. */
const DISABLED = /\sdisabled(=""|\s|>)/;

describe("ChannelTabs", () => {
  it("offers only the channels that are on, with the shown one pressed", () => {
    const html = renderToStaticMarkup(<ChannelTabs channels={["pdf", "email"]} value="email" onChange={noop} />);
    expect(html).toContain("PDF");
    expect(html).toContain("Email");
    expect(html).not.toContain("Web");
    expect(html).toMatch(/aria-pressed="true"[^>]*>(?:(?!<button).)*Email/);
  });
});

describe("the segmented controls", () => {
  it("are one style: the same 32px track and the same segment, on the channel and on the device", () => {
    const channel = renderToStaticMarkup(<ChannelTabs channels={["pdf", "web"]} value="pdf" onChange={noop} />);
    const device = renderToStaticMarkup(<DevicePicker value="desktop" onChange={noop} />);
    const track = (html: string) => /class="([^"]*)"[^>]*data-slot="toggle-group"|data-slot="toggle-group"[^>]*class="([^"]*)"/.exec(html);
    for (const html of [channel, device]) {
      const match = track(html);
      const classes = match?.[1] ?? match?.[2] ?? "";
      expect(classes).toContain("h-8");
      expect(classes).toContain("rounded-lg");
      expect(html).toContain("aria-pressed:bg-selected");
    }
  });
});

describe("DevicePicker", () => {
  it("is Desktop and Mobile, with the chosen one pressed", () => {
    const html = renderToStaticMarkup(<DevicePicker value="mobile" onChange={noop} />);
    expect(html).toContain("Desktop");
    expect(html).toContain("Mobile");
    expect(html).toMatch(/aria-pressed="true"[^>]*>(?:(?!<button).)*Mobile/);
  });
});

describe("DownloadPdfButton", () => {
  it("waits until there is a PDF to save", () => {
    expect(renderToStaticMarkup(<DownloadPdfButton output={null} />)).toMatch(DISABLED);
    expect(renderToStaticMarkup(<DownloadPdfButton output={{ kind: "web", html: "" }} />)).toMatch(DISABLED);
  });

  it("is ready once a PDF has rendered", () => {
    const html = renderToStaticMarkup(
      <DownloadPdfButton output={{ kind: "pdf", bytes: new Uint8Array([1]), filename: "UC-4F7K2Q-draft.pdf" }} />,
    );
    expect(html).not.toMatch(DISABLED);
    expect(html).toContain('aria-label="Download PDF"');
  });
});

describe("OutputError", () => {
  const VARIABLES = [
    { key: "first_name", label: "First name" },
    { key: "purchase_apr", label: "Purchase APR" },
  ];
  const show = (code: Parameters<typeof OutputError>[0]["error"]["code"]) =>
    renderToStaticMarkup(
      <OutputError
        error={{ code, message: "Missing required variables: first_name." }}
        variables={VARIABLES}
        onEditValues={noop}
        onRetry={noop}
      />,
    );

  it("shows the route's message as it came when it has nothing better, and nothing about its code", () => {
    const html = show("missing_variables");
    expect(html).toContain("Missing required variables: first_name.");
    expect(html).not.toContain("missing_variables");
  });

  it("speaks to the author: the variables by their labels, from the error's details", () => {
    const html = renderToStaticMarkup(
      <OutputError
        error={{
          code: "missing_variables",
          message: "Missing required variables: first_name, purchase_apr.",
          details: { missing: ["first_name", "purchase_apr"], invalid: [] },
        }}
        variables={VARIABLES}
        onEditValues={noop}
        onRetry={noop}
      />,
    );
    expect(html).toContain("First name and Purchase APR need values.");
    expect(html).not.toContain("first_name");
    expect(html).toContain("Edit values");
  });

  it("offers Edit values for a problem with the values", () => {
    expect(show("missing_variables")).toContain("Edit values");
    expect(show("invalid_values")).toContain("Edit values");
    expect(show("render_failed")).not.toContain("Edit values");
  });

  it("offers Try again only for a failure the server may not repeat", () => {
    expect(show("render_failed")).toContain("Try again");
    expect(show("missing_variables")).not.toContain("Try again");
    expect(show("template_not_found")).not.toContain("Try again");
  });
});
