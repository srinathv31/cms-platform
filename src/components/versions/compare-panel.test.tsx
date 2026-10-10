// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult, CompareOption } from "@/domain/review-types";
import type { ChannelFields } from "@/domain/channel-fields";
import type { Channel, ChannelFamily } from "@/domain/types";
import type { ComparePair, CompareVersion } from "@/server/queries/compare";

// The Compare dialog's panel reads each pair of versions from GET /api/templates/[templateId]/compare:
// the redline when both arrive (the name, each channel's fields, the body), "Couldn't load these
// versions." with Try again when they don't.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type CompareAnswer = ActionResult<ComparePair>;
/** The compare route as the browser reaches it: handed the URL fetched, it gives the body (or the network fails). */
const compareRoute = vi.hoisted(() => vi.fn<(url: string) => Promise<CompareAnswer>>());
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string) => {
    const body = await compareRoute(url);
    return { status: body.ok ? 200 : 404, json: async () => body };
  }),
);

const { default: ComparePanel, openingPair } = await import("./compare-panel");

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const version = (
  id: string,
  number: number,
  text: string,
  name = "Rate notice",
  fields: { channels: Channel[]; channelFields: ChannelFields } = { channels: ["pdf"], channelFields: {} },
): CompareVersion => ({
  id,
  number,
  round: 1,
  state: number === 2 ? "active" : "superseded",
  name,
  body: doc(text),
  ...fields,
  smsFooter: null,
  variables: [],
});
/** The route's answer: the template's family is its content type's, whatever the versions' channels. */
const pair = (from: CompareVersion, to: CompareVersion, family: ChannelFamily = "document"): CompareAnswer => ({ ok: true, family, from, to });
const FOOTER = "Reply STOP to opt out.";
/** An alert's version: no body, a push title and an SMS, ending with the footer it was submitted with. */
const alert = (id: string, number: number, title: string, sms: string, smsFooter: string | null = FOOTER): CompareVersion => ({
  ...version(id, number, "", "Card used abroad", {
    channels: ["push", "sms"],
    channelFields: { push: { title: doc(title) }, sms: { text: doc(sms) } },
  }),
  smsFooter,
});
const marks = (op: "ins" | "del") => [...container.querySelectorAll(op)].map((el) => el.textContent);
const OPTIONS: CompareOption[] = [
  { id: "v_2", label: "v2", state: "active", head: true },
  { id: "v_1", label: "v1", state: "superseded", head: true },
];

let root: Root;
let container: HTMLElement;

const tick = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const text = () => container.textContent ?? "";
const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name) ?? null;

beforeEach(() => {
  compareRoute.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("ComparePanel", () => {
  it("reads the pair from the compare route, older first, and shows the redline", async () => {
    compareRoute.mockResolvedValue(pair(version("v_1", 1, "Rates were low."), version("v_2", 2, "Rates are high.", "Rate change")));
    await act(async () => root.render(<ComparePanel templateId="UC-ABC123" options={OPTIONS} />));
    await tick();

    expect(compareRoute).toHaveBeenCalledWith("/api/templates/UC-ABC123/compare?from=v_1&to=v_2");
    expect(container.querySelector('[data-slot="redline-summary"]')?.textContent).toMatch(/^Renamed, /);
    expect(text()).toContain("Rates are high.");
  });

  it("redlines an email subject above the body, and counts it with the body's changes", async () => {
    const email = (subject: string) => ({ channels: ["pdf", "email"] as Channel[], channelFields: { email: { subject: doc(subject) } } });
    compareRoute.mockResolvedValue(
      pair(version("v_1", 1, "Rates are high.", "Rate notice", email("Your new rate")), version("v_2", 2, "Rates are high.", "Rate notice", email("Your new APR"))),
    );
    await act(async () => root.render(<ComparePanel templateId="UC-ABC123" options={OPTIONS} />));
    await tick();

    expect(container.querySelector('[data-block-id="email.subject"]')?.getAttribute("aria-label")).toBe("Email subject, changed");
    expect(marks("del")).toEqual(["rate"]);
    expect(marks("ins")).toEqual(["APR"]);
    expect(container.querySelector('[data-slot="redline-summary"]')?.textContent).toBe("1 changed");
  });

  it("shows an alert's fields as its whole content, with the footer locked under the SMS, and no body", async () => {
    compareRoute.mockResolvedValue(
      pair(alert("v_1", 1, "Was this you?", "Coral: card used."), alert("v_2", 2, "Was this you?", "Coral: card used abroad."), "message"),
    );
    await act(async () => root.render(<ComparePanel templateId="UC-ABC123" options={OPTIONS} />));
    await tick();

    const headings = [...container.querySelectorAll('[role="heading"]')].map((h) => h.textContent);
    expect(headings).toEqual(["Push notification", "Text message"]);
    expect(container.querySelector('[data-block-id="push.title"]')?.getAttribute("data-redline")).toBe("unchanged");
    expect(container.querySelector('[data-block-id="sms.text"]')?.getAttribute("data-redline")).toBe("changed");
    expect(marks("ins")).toEqual([" abroad"]);
    expect(container.querySelector('[data-slot="sms-footer"]')?.textContent).toBe("Reply STOP to opt out.");
    expect(container.querySelector("[data-redline-document]"), "no body to redline").toBeNull();
    expect(container.querySelector('[data-slot="redline-summary"]')?.textContent).toBe("1 changed");
  });

  it("knows an alert by its content type, not its channels: one with none still shows no body", async () => {
    const emptied = { ...alert("v_2", 2, "Was this you?", "Coral: card used abroad."), channels: [] };
    compareRoute.mockResolvedValue(pair(alert("v_1", 1, "Was this you?", "Coral: card used."), emptied, "message"));
    await act(async () => root.render(<ComparePanel templateId="UC-ABC123" options={OPTIONS} />));
    await tick();
    expect(container.querySelector("[data-redline-document]"), "no body to redline").toBeNull();
  });

  it("redlines a footer that changed between the two versions, and counts it", async () => {
    const newFooter = "Coral Offers: Reply STOP to opt out, HELP for help.";
    compareRoute.mockResolvedValue(
      pair(alert("v_1", 1, "Was this you?", "Coral: card used."), alert("v_2", 2, "Was this you?", "Coral: card used.", newFooter), "message"),
    );
    await act(async () => root.render(<ComparePanel templateId="UC-ABC123" options={OPTIONS} />));
    await tick();
    const footer = container.querySelector('[data-slot="sms-footer"]');
    expect(footer?.getAttribute("data-redline")).toBe("changed");
    expect(marks("del")).toEqual([FOOTER]);
    expect(marks("ins")).toEqual([newFooter]);
    expect(container.querySelector('[data-slot="redline-summary"]')?.textContent).toBe("1 changed");
  });

  it("says it couldn't load them when the route refuses, and Try again reads them again", async () => {
    compareRoute.mockResolvedValueOnce({ ok: false, code: "version_unavailable", reason: "This version isn't available." });
    await act(async () => root.render(<ComparePanel templateId="UC-ABC123" options={OPTIONS} />));
    await tick();
    expect(text()).toContain("Couldn't load these versions.");

    compareRoute.mockResolvedValueOnce(pair(version("v_1", 1, "Rates were low."), version("v_2", 2, "Rates are high.")));
    await act(async () => button("Try again")!.click());
    await tick();
    expect(compareRoute).toHaveBeenCalledTimes(2);
    expect(text()).not.toContain("Couldn't load these versions.");
    expect(text()).toContain("Rates are high.");
  });

  it("opens on the two newest versions, not the last two rounds of one", async () => {
    // Cash Back: v3 sent back on round 1 and in review on round 2.
    const options: CompareOption[] = [
      { id: "v_3r2", label: "v3 · Round 2", state: "in_review", head: true },
      { id: "v_3r1", label: "v3 · Round 1", state: "changes_requested", head: false },
      { id: "v_2", label: "v2", state: "active", head: true },
      { id: "v_1", label: "v1", state: "superseded", head: true },
    ];
    compareRoute.mockResolvedValue(pair(version("v_2", 2, "Rates were low."), version("v_3r2", 3, "Rates are high.")));
    await act(async () => root.render(<ComparePanel templateId="UC-ABC123" options={options} />));
    await tick();
    expect(compareRoute).toHaveBeenCalledWith("/api/templates/UC-ABC123/compare?from=v_2&to=v_3r2");
    expect(openingPair(options)).toEqual({ fromId: "v_2", toId: "v_3r2" });
    // A draft is a version of its own; a first version on its second round has only its rounds.
    expect(openingPair([{ id: "d", label: "Draft", state: "draft", head: true }, ...options.slice(2, 3)])).toEqual({ fromId: "v_2", toId: "d" });
    expect(
      openingPair([
        { id: "v_1r2", label: "v1 · Round 2", state: "in_review", head: true },
        { id: "v_1r1", label: "v1 · Round 1", state: "changes_requested", head: false },
      ]),
    ).toEqual({ fromId: "v_1r1", toId: "v_1r2" });
  });

  it("says it couldn't load them when the request fails", async () => {
    compareRoute.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => root.render(<ComparePanel templateId="UC-ABC123" options={OPTIONS} />));
    await tick();
    expect(text()).toContain("Couldn't load these versions.");
  });
});
