import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PushContent, SmsContent } from "@/components/device";
import { INITIAL_PHONE } from "@/components/workspace/session/session-store";
import type { MessageOutput } from "./message-preview";
import type { PreviewOutput } from "./render-preview";
import type { PreviewPaneProps } from "./preview-pane";
import { PreviewPane } from "./preview-pane";

// The PDF viewer loads pdf.js; what it draws isn't under test here.
vi.mock("./pdf/pdf-viewer", () => ({ PdfViewer: () => <div role="region" aria-label="PDF preview" /> }));

// The phone kit loads its fonts through next/font; the pane's part is what it hands the kit.
vi.mock("@/components/device", async () => {
  const kit = await vi.importActual<typeof import("@/components/device/labels")>("@/components/device/labels");
  return {
    pushScreenLabel: kit.pushScreenLabel,
    SCREEN_SIZES: { ios: { compact: { width: 375 }, standard: { width: 402 }, large: { width: 440 } }, android: { compact: { width: 360 }, standard: { width: 412 }, large: { width: 448 } } },
    SIZE_UNIT: { ios: "pt", android: "dp" },
    PushPreview: ({ content, screen }: { content: PushContent; screen: string }) => (
      <figure data-phone="push" data-screen={screen}>
        {[content.appName, content.appMark.monogram, content.title, content.subtitle, content.body, content.time].join("|")}
      </figure>
    ),
    SmsPreview: ({ content }: { content: SmsContent }) => <figure data-phone="sms">{`${content.sender}|${content.text}`}</figure>,
  };
});

const noop = () => {};
/** The attribute, not the `disabled:` utility classes. */
const DISABLED = /\sdisabled(=""|\s|>)/;

const PDF: PreviewOutput = { kind: "pdf", bytes: new Uint8Array([1]), filename: "UC-4F7K2Q-draft.pdf" };
const SMS: MessageOutput = { kind: "sms", text: "Hi Maya.\nReply STOP to opt out.", refusal: null };
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
      phone={{ settings: INITIAL_PHONE, screen: "lock" }}
      onPhone={noop}
      message={null}
      senders={{ appName: "Coral", smsSender: "26725" }}
      clock={{ time: "9:41", date: "Friday, October 9" }}
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
    for (const channel of ["push", "sms"] as const) {
      const html = show({ channels: ["push", "sms"], channel, message: { ok: true, output: SMS } });
      expect(html, channel).toContain('aria-label="Phone"');
      expect(html, channel).toContain('aria-label="Device options"');
      expect(html, channel).not.toContain('aria-label="Download PDF"');
    }
  });
});

describe("PreviewPane: Push and SMS", () => {
  const PUSH: MessageOutput = {
    kind: "push",
    platform: "ios",
    push: { title: "Payment due", subtitle: "Coral Card", body: "Hi Maya, $35 is due." },
    refusal: null,
  };

  it("draws the push on the phone, from the app the team sends as, on the screen chosen", () => {
    const html = show({ channels: ["push", "sms"], channel: "push", message: { ok: true, output: PUSH } });
    expect(html).toContain('data-phone="push"');
    expect(html).toContain('data-screen="lock"');
    expect(html).toContain("Coral|C|Payment due|Coral Card|Hi Maya, $35 is due.|now");
  });

  it("draws the SMS in the messages app, from the team's short code", () => {
    const html = show({ channels: ["push", "sms"], channel: "sms", message: { ok: true, output: SMS } });
    expect(html).toContain('data-phone="sms"');
    expect(html).toContain("26725|Hi Maya.\nReply STOP to opt out.");
  });

  it("still draws a message the route would refuse, with the route's sentence over it", () => {
    const refusal = { code: "sms_too_long", message: "The SMS is 11 parts in GSM-7. It can be at most 10 parts." } as const;
    const html = show({ channels: ["push", "sms"], channel: "sms", message: { ok: true, output: { ...SMS, refusal } } });
    expect(html).toContain('data-phone="sms"');
    expect(html).toContain("The SMS is 11 parts in GSM-7. It can be at most 10 parts.");
  });

  it("offers no Try again on a message the browser couldn't render: the same fields fail the same way", () => {
    const error = { code: "render_failed", message: "The SMS couldn't be rendered. The document has content that can't be rendered." } as const;
    for (const channel of ["push", "sms"] as const) {
      const html = show({ channels: ["push", "sms"], channel, message: { ok: false, error } });
      expect(html, channel).toContain("couldn&#x27;t be rendered");
      expect(html, channel).not.toContain("Try again");
    }
    // A document channel's render is a request, so it can be tried again.
    expect(show({ slot: { output: null, error } })).toContain("Try again");
  });

  it("shows values that don't render as any channel does, in the author's words, with no phone", () => {
    const error = { code: "missing_variables", message: "Missing required variables: first_name.", details: { missing: ["first_name"], invalid: [] } } as const;
    const html = show({ channels: ["push", "sms"], channel: "push", message: { ok: false, error } });
    expect(html).toContain("First name needs a value.");
    expect(html).toContain("Edit values");
    expect(html).not.toContain("data-phone");
  });
});
