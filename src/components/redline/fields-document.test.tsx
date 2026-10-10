// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChannelFields } from "@/domain/channel-fields";
import { diffChannelFields } from "@/domain/redline";
import type { Channel, JSONContent, Variable } from "@/domain/types";
import { FieldsDocument, type FieldsDocumentProps } from "./fields-document";

// A version's channel fields as the composer shows them, read-only, with their redline: an alert's push and
// SMS (its whole content) and a document's email details.

const text = (value: string): JSONContent => ({ type: "text", text: value });
const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });
const field = (...content: JSONContent[]): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content }] });
const VARIABLES = [{ key: "card_last4", label: "Card last 4", type: "text", required: true }] as unknown as Variable[];

const alert = (channelFields: ChannelFields, channels: Channel[] = ["push", "sms"]) => ({ channels, channelFields });
const V1 = alert({
  push: { title: field(text("Was this you?")), subtitle: field(text("Card ending in "), chip("card_last4")) },
  sms: { text: field(text("Coral: card used.")) },
});
const V2 = alert({
  push: { title: field(text("Was this you?")), body: field(text("Lock your card in the app.")) },
  sms: { text: field(text("Coral: card used abroad.")) },
});

function render(props: Partial<FieldsDocumentProps> & Pick<FieldsDocumentProps, "fields">): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<FieldsDocument variables={VARIABLES} layout="sections" {...props} />);
  return host;
}
const frame = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`.ucomp-doc > [data-block-id="${id}"]`);

describe("FieldsDocument", () => {
  it("heads each channel's section and frames every field by its id, as a block is, with the label and tag", () => {
    const clean = diffChannelFields(null, { ...V1, smsFooter: "Reply STOP to opt out." });
    const root = render({ fields: clean.fields, footer: clean.footer });
    expect([...root.querySelectorAll('[role="heading"][aria-level="2"]')].map((h) => h.textContent)).toEqual(["Push notification", "Text message"]);
    expect([...root.querySelectorAll(".ucomp-doc > [data-block-id]")].map((el) => el.getAttribute("data-block-id"))).toEqual([
      "push.title",
      "push.subtitle",
      "push.body",
      "sms.text",
    ]);
    expect(frame(root, "push.subtitle")?.textContent).toBe("SubtitleiPhone onlyCard ending in Card last 4");
    expect(frame(root, "push.title")?.getAttribute("aria-label")).toBe("Push title");
    expect(frame(root, "sms.text")?.querySelector('[data-slot="sms-footer"]')?.textContent).toBe("Reply STOP to opt out.");
    // Clean: nothing is marked, and nothing has a bar.
    expect(root.querySelectorAll("ins, del, [data-slot='redline-bar']")).toHaveLength(0);
  });

  it("paints the redline: a changed field's words, an added field under <ins>, a removed one struck whole, each with its bar", () => {
    const root = render({ fields: diffChannelFields(V1, V2).fields });
    expect(frame(root, "push.title")?.getAttribute("data-redline")).toBe("unchanged");
    expect(frame(root, "sms.text")?.getAttribute("aria-label")).toBe("SMS message, changed");
    expect(frame(root, "sms.text")?.querySelector('ins[data-redline-op="insert"]')?.textContent).toBe(" abroad");
    expect(frame(root, "push.body")?.querySelector("ins.block")?.textContent).toBe("Lock your card in the app.");
    expect(frame(root, "push.subtitle")?.getAttribute("data-id"), "a removed field takes no comment").toBeNull();
    expect(frame(root, "push.subtitle")?.querySelectorAll('del[data-redline-op="delete"]').length).toBeGreaterThan(0);
    expect(root.querySelectorAll("[data-slot='redline-bar']")).toHaveLength(3);
  });

  it("with Changes only, an unchanged field says so in place of its text, unless a thread on it is being read", () => {
    const fields = diffChannelFields(V1, V2).fields;
    const root = render({ fields, changesOnly: true });
    expect(frame(root, "push.title")?.querySelector('[data-slot="field-unchanged"]')?.textContent).toBe("Unchanged");
    expect(frame(root, "sms.text")?.querySelector('[data-slot="field-text"]')).not.toBeNull();
    const active = render({ fields, changesOnly: true, activeBlockId: "push.title" });
    expect(frame(active, "push.title")?.hasAttribute("data-active")).toBe(true);
    expect(frame(active, "push.title")?.querySelector('[data-slot="field-text"]')?.textContent).toBe("Was this you?");
  });

  it("redlines the SMS footer each version was submitted with, and keeps the SMS in full with Changes only", () => {
    const before = { ...V1, smsFooter: "Coral: Reply STOP to opt out." };
    const after = { ...V1, smsFooter: "Coral Offers: Reply STOP to opt out, HELP for help." };
    const redline = diffChannelFields(before, after);
    expect(redline.counts).toEqual({ added: 0, removed: 0, changed: 1, moved: 0 });
    const root = render({ fields: redline.fields, footer: redline.footer, changesOnly: true });
    const footer = frame(root, "sms.text")?.querySelector('[data-slot="sms-footer"]');
    expect(footer?.getAttribute("data-redline")).toBe("changed");
    expect(footer?.querySelector("del")?.textContent).toBe("Coral: Reply STOP to opt out.");
    expect(footer?.querySelector("ins")?.textContent).toBe("Coral Offers: Reply STOP to opt out, HELP for help.");
    expect(frame(root, "sms.text")?.querySelector('[data-slot="field-unchanged"]'), "shown in full").toBeNull();
    expect(frame(root, "push.title")?.querySelector('[data-slot="field-unchanged"]')).not.toBeNull();
  });

  it("lays a document's email details out under a caps label, at the heading level it is given", () => {
    const email = { channels: ["pdf", "email"] as Channel[], channelFields: { email: { subject: field(text("Your new rate")) } } };
    const root = render({ fields: diffChannelFields(null, email).fields, layout: "details", headingLevel: 3 });
    const heading = root.querySelector('[role="heading"]');
    expect(heading?.getAttribute("aria-level")).toBe("3");
    expect(heading?.className).toContain("caps-label");
    expect(heading?.textContent).toBe("Email");
  });

  it("draws nothing when there are no fields (a document without email)", () => {
    expect(render({ fields: [] }).innerHTML).toBe("");
  });
});
