// @vitest-environment happy-dom
// "Submit for review" (handoff review I8): the page is inert from the click until the dialog closes
// without submitting, the summary is read once everything typed has saved, and the submit sends the
// summary's rev, offering a refresh when the draft has moved past it.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmitSummary } from "@/components/submit/types";
import { REFUSALS } from "@/domain/lifecycle";
import type { ActionResult } from "@/domain/review-types";
import type { SaveFields } from "./autosave/autosave-scheduler";
import { createWorkspaceSession, type WorkspaceSession } from "./session/session-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let session: WorkspaceSession;

const server = vi.hoisted(() => ({
  getSubmitSummary: vi.fn<(input: { templateId: string }) => Promise<ActionResult<{ summary: SubmitSummary }>>>(),
  submitVersion: vi.fn<(input: { templateId: string; note?: string | null; rev: number }) => Promise<ActionResult<{ number: number }>>>(),
}));

vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined, useSelectedLayoutSegment: () => null }));
vi.mock("@/server/actions/templates", () => ({ startDraft: vi.fn() }));
vi.mock("@/server/actions/review", () => ({ submitVersion: server.submitVersion }));
vi.mock("@/server/queries/submit-summary", () => ({ getSubmitSummary: server.getSubmitSummary }));
vi.mock("./session/workspace-session", () => ({
  useWorkspaceSession: () => session,
  usePreviewState: () => session.getPreview(),
  useRailOpen: () => session.getRailOpen(),
}));

const { SubmitButton } = await import("./workspace-actions");

const TEMPLATE = "UC-4F7K2Q";
const summary = (over: Partial<SubmitSummary> = {}): SubmitSummary => ({
  templateId: TEMPLATE,
  rev: 4,
  number: 3,
  channels: ["pdf"],
  sampleSetNames: ["Typical customer"],
  variables: [],
  baseline: null,
  ...over,
});

/** A flush that stays pending until it is settled, as a save in flight does. */
function deferredFlush() {
  let settle!: () => void;
  const flush = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
  return { flush, settle: () => act(async () => settle()) };
}

let root: Root;
let container: HTMLElement;
let save: ReturnType<typeof vi.fn<(fields: SaveFields) => void>>;

const submitButton = () => document.body.querySelector<HTMLButtonElement>("button[aria-label='Submit for review']")!;
const dialog = () => document.body.querySelector<HTMLElement>("[data-slot='scrim-dialog-content']");
const button = (name: RegExp) =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => name.test(b.textContent ?? "")) ?? null;
const click = (el: HTMLElement) => act(async () => el.click());
const tick = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(async () => {
  server.getSubmitSummary.mockReset().mockResolvedValue({ ok: true, summary: summary() });
  server.submitVersion.mockReset().mockResolvedValue({ ok: true, number: 3 });
  session = createWorkspaceSession();
  session.bind({ versionId: "v_1", rev: 0 });
  save = vi.fn<(fields: SaveFields) => void>();
  session.attach(save, async () => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SubmitButton templateId={TEMPLATE} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("the page while Submit reads the summary", () => {
  it("is inert from the click, before the pending save has gone out, and the summary is read after it", async () => {
    const pending = deferredFlush();
    session.attach(save, pending.flush);

    await click(submitButton());
    expect(session.getInert(), "read-only before the flush resolves").toBe(true);
    expect(pending.flush).toHaveBeenCalledTimes(1);
    expect(server.getSubmitSummary).not.toHaveBeenCalled();

    await pending.settle();
    await tick();
    expect(server.getSubmitSummary).toHaveBeenCalledWith({ templateId: TEMPLATE });
    expect(dialog()?.textContent).toContain("Submit v3 for review");
    expect(session.getInert(), "still inert while the dialog is open").toBe(true);
  });

  it("is editable again when the dialog is cancelled", async () => {
    await click(submitButton());
    await tick();
    expect(dialog()).not.toBeNull();
    await click(button(/^Cancel$/)!);
    expect(session.getInert()).toBe(false);
    expect(server.submitVersion).not.toHaveBeenCalled();
  });

  it("is editable again, with the reason at the button, when the summary can't be read", async () => {
    server.getSubmitSummary.mockResolvedValueOnce({ ok: false, reason: "This version is already in review." });
    await click(submitButton());
    await tick();
    expect(session.getInert()).toBe(false);
    expect(dialog()).toBeNull();
    expect(document.body.querySelector("[role='alert']")?.textContent).toBe("This version is already in review.");
  });

  it("is editable again, with the reason at the button, when the pending save failed", async () => {
    session.attach(save, async () => session.publishStatus({ status: "error", error: "Not saved. Check your connection." }));
    await click(submitButton());
    await tick();
    expect(session.getInert()).toBe(false);
    expect(server.getSubmitSummary).not.toHaveBeenCalled();
    expect(document.body.querySelector("[role='alert']")?.textContent).toBe("Not saved. Check your connection.");
  });

  it("is editable again when the summary read throws", async () => {
    server.getSubmitSummary.mockRejectedValueOnce(new Error("boom"));
    await click(submitButton());
    await tick();
    expect(session.getInert()).toBe(false);
    expect(document.body.querySelector("[role='alert']")?.textContent).toBe("Couldn't open the submit dialog. Try again.");
  });
});

describe("submitting", () => {
  it("sends anything still pending, then the summary's rev; the page stays held until the button goes", async () => {
    await click(submitButton());
    await tick();
    const flush = vi.fn(async () => {});
    session.attach(save, flush);

    await click(button(/^Submit v3$/)!);
    await tick();
    expect(flush, "a last flush before the submit").toHaveBeenCalledTimes(1);
    expect(server.submitVersion).toHaveBeenCalledWith({ templateId: TEMPLATE, note: undefined, rev: 4 });
    expect(dialog()).toBeNull();
    expect(session.getInert(), "nothing can be typed into the version being frozen").toBe(true);

    // The refreshed page has no draft, and no Submit button: it lets go as it goes.
    await act(async () => root.render(null));
    expect(session.getInert()).toBe(false);
  });

  it("refuses inside the dialog, without submitting, when the last flush fails", async () => {
    await click(submitButton());
    await tick();
    session.attach(save, async () => session.publishStatus({ status: "error", error: "Not saved. Check your connection." }));
    await click(button(/^Submit v3$/)!);
    await tick();
    expect(server.submitVersion).not.toHaveBeenCalled();
    expect(dialog()?.querySelector("[role='alert']")?.textContent).toBe("Not saved. Check your connection.");
    expect(session.getInert()).toBe(true);
  });

  it("offers to refresh a summary the draft has moved past, reads it again, and submits the new rev", async () => {
    await click(submitButton());
    await tick();
    server.submitVersion.mockResolvedValueOnce({ ok: false, reason: REFUSALS.summaryStale });
    await click(button(/^Submit v3$/)!);
    await tick();
    expect(dialog()?.querySelector("[role='alert']")?.textContent).toBe(REFUSALS.summaryStale);
    expect(session.getInert()).toBe(true);

    server.getSubmitSummary.mockResolvedValueOnce({ ok: true, summary: summary({ rev: 6 }) });
    await click(button(/^Refresh summary$/)!);
    await tick();
    expect(server.getSubmitSummary).toHaveBeenCalledTimes(2);

    await click(button(/^Submit v3$/)!);
    await tick();
    expect(server.submitVersion).toHaveBeenLastCalledWith({ templateId: TEMPLATE, note: undefined, rev: 6 });
    expect(dialog()).toBeNull();
  });
});
