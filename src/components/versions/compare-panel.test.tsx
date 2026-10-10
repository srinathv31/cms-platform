// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult, CompareOption } from "@/domain/review-types";
import type { CompareVersion } from "@/server/queries/compare";

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

const { default: ComparePanel, openingPair } = await import("./compare-panel");

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

  it("opens on the two newest versions, not the last two rounds of one", async () => {
    // Cash Back: v3 sent back on round 1 and in review on round 2.
    const options: CompareOption[] = [
      { id: "v_3r2", label: "v3 · Round 2", state: "in_review", head: true },
      { id: "v_3r1", label: "v3 · Round 1", state: "changes_requested", head: false },
      { id: "v_2", label: "v2", state: "active", head: true },
      { id: "v_1", label: "v1", state: "superseded", head: true },
    ];
    compareRoute.mockResolvedValue({ ok: true, from: version("v_2", 2, "Rates were low."), to: version("v_3r2", 3, "Rates are high.") });
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
