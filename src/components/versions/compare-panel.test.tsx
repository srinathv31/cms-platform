// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/domain/review-types";
import type { ChannelFields } from "@/domain/channel-fields";
import type { Channel } from "@/domain/types";
import type { ComparePair, CompareVersion } from "@/server/queries/compare";
import type { CompareOption } from "./compare-dialog";

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

const { default: ComparePanel } = await import("./compare-panel");

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
  state: number === 2 ? "active" : "superseded",
  name,
  body: doc(text),
  ...fields,
  variables: [],
});
const pair = (from: CompareVersion, to: CompareVersion, smsFooter: string | null = null): CompareAnswer => ({ ok: true, from, to, smsFooter });
/** An alert's version: no body, a push title and an SMS. */
const alert = (id: string, number: number, title: string, sms: string): CompareVersion =>
  version(id, number, "", "Card used abroad", {
    channels: ["push", "sms"],
    channelFields: { push: { title: doc(title) }, sms: { text: doc(sms) } },
  });
const marks = (op: "ins" | "del") => [...container.querySelectorAll(op)].map((el) => el.textContent);
const OPTIONS: CompareOption[] = [
  { id: "v_2", label: "v2", state: "active" },
  { id: "v_1", label: "v1", state: "superseded" },
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
      pair(alert("v_1", 1, "Was this you?", "Coral: card used."), alert("v_2", 2, "Was this you?", "Coral: card used abroad."), "Reply STOP to opt out."),
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

  it("says it couldn't load them when the request fails", async () => {
    compareRoute.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => root.render(<ComparePanel templateId="UC-ABC123" options={OPTIONS} />));
    await tick();
    expect(text()).toContain("Couldn't load these versions.");
  });
});
