// @vitest-environment happy-dom
// "Edit" (handoff review A3): `startDraft` answers a refusal instead of throwing it, and the button shows
// the domain's sentence rather than a generic failure. A call that fails says so in the screen's words.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle";
import type { ActionResult } from "@/domain/review-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const server = vi.hoisted(() => ({ startDraft: vi.fn<(input: { templateId: string }) => Promise<ActionResult>>() }));
const toast = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined, useSelectedLayoutSegment: () => null }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/server/actions/templates", () => ({ startDraft: server.startDraft }));
vi.mock("@/server/actions/review", () => ({ submitVersion: vi.fn() }));

const { EditButton } = await import("./workspace-actions");

const TEMPLATE = "UC-4F7K2Q";
let root: Root;
let container: HTMLElement;

const edit = () => container.querySelector<HTMLButtonElement>("button")!;
const tick = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(async () => {
  server.startDraft.mockReset();
  toast.error.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<EditButton templateId={TEMPLATE} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Edit", () => {
  it("opens the draft through startDraft", async () => {
    // On success the action redirects; until the new page is up, its promise stays out.
    let redirected!: (result: ActionResult) => void;
    server.startDraft.mockReturnValue(new Promise((resolve) => (redirected = resolve)));
    await act(async () => edit().click());
    expect(server.startDraft).toHaveBeenCalledWith({ templateId: TEMPLATE });
    expect(edit().disabled, "pending until the draft's page is up").toBe(true);
    // React entangles every async transition with one still out: settle it so the next test starts clean.
    await act(async () => redirected({ ok: true }));
  });

  it("shows the refusal's sentence when the server refuses", async () => {
    server.startDraft.mockResolvedValue({ ok: false, ...REFUSALS.newerInReview });
    await act(async () => edit().click());
    await tick();
    expect(toast.error).toHaveBeenCalledWith("A newer version is in review.");
    expect(edit().disabled, "pressable again").toBe(false);
  });

  it("says it couldn't open a draft when the call fails", async () => {
    server.startDraft.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => edit().click());
    await tick();
    expect(toast.error).toHaveBeenCalledWith("Couldn't open a draft. Try again.");
  });
});
