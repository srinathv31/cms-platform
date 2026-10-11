import { describe, expect, it } from "vitest";
import { PLATFORM_REFUSALS } from "./refusals";
import { channelOffConsequences, channelRuleRefusal, setChannelRule } from "./channels";
import type { Channel } from "../types";
import { NOW, riley } from "./fixtures";

describe("channelRuleRefusal (whether a switch may flip)", () => {
  const type = (...allowedChannels: Channel[]) => ({ name: "Disclosure", allowedChannels });

  it("refuses turning off the last channel on", () => {
    expect(channelRuleRefusal(type("email"), "email", false)).toBe(PLATFORM_REFUSALS.oneChannel);
    expect(channelRuleRefusal(type("web", "email"), "email", false)).toBeNull();
    expect(channelRuleRefusal(type("email"), "pdf", true)).toBeNull();
    expect(channelRuleRefusal(type("email"), "fax" as never, true)).toBe(PLATFORM_REFUSALS.oneChannel);
    const ct = { id: "ct_disclosure", name: "Disclosure", allowedChannels: ["email" as const] };
    expect(setChannelRule({ contentType: ct, channel: "email", allowed: false, activeUsing: 0, contentTypes: [], actor: riley, now: NOW })).toEqual({
      ok: false,
      ...channelRuleRefusal(type("email"), "email", false),
    });
  });

  describe("families never mix (decision 0034)", () => {
    const disclosure = { name: "Disclosure", allowedChannels: ["pdf", "web"] as Channel[] };
    const notice = { name: "Notice", allowedChannels: ["pdf"] as Channel[] };
    const alert = { name: "Alert", allowedChannels: ["push", "sms"] as Channel[] };
    const all = [disclosure, notice, alert];

    it("refuses a message channel on a document type, naming the types it goes on", () => {
      for (const channel of ["push", "sms"] as const) {
        const refusal = channelRuleRefusal(disclosure, channel, true, all);
        expect(refusal).toEqual({ code: "channel_family", reason: "Disclosures are documents. Push and SMS go on Alert templates." });
      }
    });

    it("refuses a document channel on a message type, naming the types it goes on", () => {
      expect(channelRuleRefusal(alert, "email", true, all)).toEqual({
        code: "channel_family",
        reason: "Alerts are messages. PDF, Web and Email go on Disclosure or Notice templates.",
      });
    });

    it("names the family when no content type of it exists", () => {
      expect(channelRuleRefusal(disclosure, "sms", true, [disclosure])?.reason).toBe(
        "Disclosures are documents. Push and SMS go on message templates.",
      );
    });

    it("lets a type turn on its own family's channels, and turn any channel off", () => {
      expect(channelRuleRefusal(disclosure, "email", true, all)).toBeNull();
      expect(channelRuleRefusal(alert, "sms", false, all)).toBeNull();
      expect(channelRuleRefusal({ name: "Alert", allowedChannels: ["push"] }, "sms", true, all)).toBeNull();
    });

    it("setChannelRule refuses it too, and writes nothing", () => {
      const ct = { id: "ct_alert", name: "Alert", allowedChannels: ["push", "sms"] as Channel[] };
      expect(setChannelRule({ contentType: ct, channel: "pdf", allowed: true, activeUsing: 0, contentTypes: all, actor: riley, now: NOW })).toEqual({
        ok: false,
        code: "channel_family",
        reason: "Alerts are messages. PDF, Web and Email go on Disclosure or Notice templates.",
      });
    });
  });
});

describe("setChannelRule", () => {
  const ct = { id: "ct_disclosure", name: "Disclosure", allowedChannels: ["pdf", "web", "email"] as const };
  const run = (over: Partial<Parameters<typeof setChannelRule>[0]> = {}) =>
    setChannelRule({
      contentType: { ...ct, allowedChannels: [...ct.allowedChannels] },
      channel: "email",
      allowed: false,
      activeUsing: 2,
      contentTypes: [],
      actor: riley,
      now: NOW,
      ...over,
    });

  it("turning a channel off names the Active versions it stops", () => {
    expect(run()).toEqual({
      ok: true,
      allowedChannels: ["pdf", "web"],
      consequences: ["2 Active Disclosure versions stop rendering to Email.", "New Disclosure templates can't turn Email on."],
      effects: [
        {
          kind: "audit",
          action: "platform.config_changed",
          teamId: null,
          details: {
            area: "channel_rules",
            summary: "Turned off Email for Disclosure: 2 Active versions stopped rendering to Email",
            contentTypeId: "ct_disclosure",
            contentTypeName: "Disclosure",
            channel: "email",
            allowed: false,
            activeUsing: 2,
          },
        },
      ],
    });
    expect(channelOffConsequences("Disclosure", "pdf", 1)[0]).toBe("1 Active Disclosure version stops rendering to PDF.");
    expect(channelOffConsequences("Disclosure", "web", 0)[0]).toBe("No Active Disclosure version renders to Web.");
  });

  it("turning one back on keeps the channel order; a no-op writes nothing", () => {
    const on = run({ contentType: { ...ct, allowedChannels: ["web"] }, channel: "pdf", allowed: true });
    expect(on.ok && on.allowedChannels).toEqual(["pdf", "web"]);
    expect(on.ok && on.consequences).toEqual([]);
    expect(run({ allowed: true })).toEqual({ ok: true, allowedChannels: ["pdf", "web", "email"], consequences: [], effects: [] });
  });

  it("keeps at least one channel on", () => {
    expect(run({ contentType: { ...ct, allowedChannels: ["email"] } })).toEqual({ ok: false, ...PLATFORM_REFUSALS.oneChannel });
  });
});
