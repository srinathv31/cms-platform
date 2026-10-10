// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/domain/review-types";
import type { CompareVersion } from "@/server/queries/compare";
import type { CompareOption } from "./compare-dialog";

// The Compare dialog's panel reads each pair of versions from GET /api/templates/[templateId]/compare:
// the redline when both arrive, "Couldn't load these versions." with Try again when they don't.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type CompareAnswer = ActionResult<{ from: CompareVersion; to: CompareVersion }>;
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
const version = (id: string, number: number, text: string, name = "Rate notice"): CompareVersion => ({
  id,
  number,
  round: 1,
  state: number === 2 ? "active" : "superseded",
  name,
  body: doc(text),
  variables: [],
});
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
    compareRoute.mockResolvedValue({ ok: true, from: version("v_1", 1, "Rates were low."), to: version("v_2", 2, "Rates are high.", "Rate change") });
    await act(async () => root.render(<ComparePanel templateId="UC-ABC123" options={OPTIONS} />));
    await tick();

    expect(compareRoute).toHaveBeenCalledWith("/api/templates/UC-ABC123/compare?from=v_1&to=v_2");
    expect(container.querySelector('[data-slot="redline-summary"]')?.textContent).toMatch(/^Renamed, /);
    expect(text()).toContain("Rates are high.");
  });

  it("says it couldn't load them when the route refuses, and Try again reads them again", async () => {
    compareRoute.mockResolvedValueOnce({ ok: false, code: "version_unavailable", reason: "This version isn't available." });
    await act(async () => root.render(<ComparePanel templateId="UC-ABC123" options={OPTIONS} />));
    await tick();
    expect(text()).toContain("Couldn't load these versions.");

    compareRoute.mockResolvedValueOnce({ ok: true, from: version("v_1", 1, "Rates were low."), to: version("v_2", 2, "Rates are high.") });
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
