import { describe, expect, it } from "vitest";
import type { ChannelFields } from "@/domain/channel-fields";
import { renderMessage } from "@/domain/render/message";
import { validateValues } from "@/domain/render/validate";
import type { JSONContent, Variable } from "@/domain/types";
import { renderMessagePreview, type MessagePreviewInput } from "./message-preview";

const t = (text: string): JSONContent => ({ type: "text", text });
const chip = (key: string): JSONContent => ({ type: "variable", attrs: { key } });
const field = (...inline: JSONContent[]): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content: inline }] });

const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "amount_due", label: "Amount due", type: "currency", required: true, sample: "35" },
];
const FIELDS: ChannelFields = {
  push: { title: field(t("Payment due")), subtitle: field(t("Coral Card")), body: field(t("Hi "), chip("first_name"), t(", "), chip("amount_due"), t(" is due.")) },
  sms: { text: field(t("Hi "), chip("first_name"), t(", "), chip("amount_due"), t(" is due.")) },
};
const RULES = { smsFooter: "Reply STOP to opt out." };

function input(over: Partial<MessagePreviewInput> = {}): MessagePreviewInput {
  return { fields: FIELDS, variables: VARIABLES, values: { first_name: "Maya", amount_due: "35" }, rules: RULES, ...over };
}

describe("renderMessagePreview", () => {
  it("renders exactly what the route's function renders: the phone shows what a consumer gets", () => {
    const checked = validateValues(VARIABLES, { first_name: "Maya", amount_due: "35" });
    if (!checked.ok) throw new Error("values");
    const route = renderMessage({ channel: "sms" }, { fields: FIELDS, variables: VARIABLES, values: checked.values, rules: RULES });
    const preview = renderMessagePreview({ channel: "sms" }, input());
    expect(route.ok && preview.ok && preview.output.kind === "sms" ? preview.output.text : null).toBe(route.ok ? route.output.text : "");
    expect(preview).toEqual({ ok: true, output: { kind: "sms", text: "Hi Maya, $35 is due.\nReply STOP to opt out.", refusal: null } });
  });

  it("renders a push for the platform asked, with no subtitle on Android", () => {
    expect(renderMessagePreview({ channel: "push", platform: "ios" }, input())).toEqual({
      ok: true,
      output: { kind: "push", platform: "ios", push: { title: "Payment due", subtitle: "Coral Card", body: "Hi Maya, $35 is due." }, refusal: null },
    });
    expect(renderMessagePreview({ channel: "push", platform: "android" }, input())).toEqual({
      ok: true,
      output: { kind: "push", platform: "android", push: { title: "Payment due", body: "Hi Maya, $35 is due." }, refusal: null },
    });
  });

  it("renders the fields as given, so an unsaved keystroke is in the next render", () => {
    const typed: ChannelFields = { ...FIELDS, sms: { text: field(t("Hi "), chip("first_name"), t("!")) } };
    const preview = renderMessagePreview({ channel: "sms" }, input({ fields: typed }));
    expect(preview.ok && preview.output.kind === "sms" && preview.output.text).toBe("Hi Maya!\nReply STOP to opt out.");
  });

  it("refuses values the route would refuse, in the route's words, and draws nothing", () => {
    const preview = renderMessagePreview({ channel: "sms" }, input({ values: { first_name: "", amount_due: "lots" } }));
    expect(preview.ok).toBe(false);
    if (!preview.ok) {
      expect(preview.error.code).toBe("missing_variables");
      expect(preview.error.details).toEqual({ missing: ["first_name"], invalid: [{ key: "amount_due", expected: "currency" }] });
    }
  });

  it("still shows a message the route would refuse, with the route's refusal", () => {
    const huge: ChannelFields = { sms: { text: field(t("x".repeat(1600))) } };
    const sms = renderMessagePreview({ channel: "sms" }, input({ fields: huge }));
    expect(sms.ok && sms.output.kind === "sms" && sms.output.text.startsWith("x".repeat(1600))).toBe(true);
    expect(sms.ok && sms.output.refusal?.code).toBe("sms_too_long");

    const heavy: ChannelFields = { push: { title: field(t("T")), body: field(t("€".repeat(1400))) } };
    const push = renderMessagePreview({ channel: "push", platform: "android" }, input({ fields: heavy }));
    expect(push.ok && push.output.kind === "push" && push.output.push.body.length).toBe(1400);
    expect(push.ok && push.output.refusal?.code).toBe("push_payload_too_large");
  });
});
