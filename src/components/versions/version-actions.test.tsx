// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle";
import { REASONS } from "@/domain/permissions";
import type { VersionTimelineItem } from "@/domain/review-types";

// The actions at the head of a version's entry: which are shown, and how a blocked one reads. The
// server actions are replaced; the read model's `can` results are given as the query decides them.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/server/actions/review", () => ({
  setSunset: vi.fn(),
  startRevoke: vi.fn(),
  confirmRevoke: vi.fn(),
  cancelRevoke: vi.fn(),
}));

const { EntryActions } = await import("./version-actions");

const CTX = {
  templateId: "UC-ABC123",
  activeNumber: 2,
  usage: [],
  sunsetCalendar: { zone: "America/New_York", today: "2026-10-30" },
  nowIso: "2026-10-30T12:00:00.000Z",
};
const OK = { ok: true } as const;
const NO_REVOKE = { ok: false, reason: REFUSALS.noRevokePending } as const;

function superseded(over: Partial<VersionTimelineItem> = {}): VersionTimelineItem {
  return {
    id: "v_1",
    number: 1,
    state: "superseded",
    createdAt: "2026-09-01T12:00:00.000Z",
    author: { id: "priya", name: "Priya Shah", initials: "PS", hue: 0 },
    sunsetDay: "2026-10-25",
    sunsetPassed: false,
    contractLines: [],
    contractItems: [],
    decisions: [],
    lastRenderAt: null,
    renders30d: 0,
    can: { setSunset: OK, startRevoke: OK, confirmRevoke: NO_REVOKE, cancelRevoke: NO_REVOKE },
    ...over,
  };
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

async function render(item: VersionTimelineItem) {
  await act(async () => root.render(<EntryActions ctx={CTX} item={item} />));
}

const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const description = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();

describe("EntryActions: the sunset", () => {
  it("offers Change sunset while the sunset is still to come", async () => {
    await render(superseded());
    const change = button("Change sunset for v1")!;
    expect(change).not.toBeNull();
    expect(change.getAttribute("aria-disabled")).toBeNull();
    expect(change.hasAttribute("data-disabled")).toBe(false);
  });

  it("keeps Change sunset in place once the sunset has passed, disabled, with the reason", async () => {
    await render(superseded({ sunsetPassed: true, can: { setSunset: { ok: false, reason: REFUSALS.sunsetPassed }, startRevoke: OK, confirmRevoke: NO_REVOKE, cancelRevoke: NO_REVOKE } }));
    const change = button("Change sunset for v1")!;
    expect(change).not.toBeNull();
    expect(change.getAttribute("aria-disabled")).toBe("true");
    expect(change.hasAttribute("data-disabled")).toBe(true);
    expect(description(change)).toBe(REFUSALS.sunsetPassed);

    await act(async () => change.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    // Revoke is a separate question, and still there.
    expect(button("Revoke v1")).not.toBeNull();
  });

  it("still leaves it out for a viewer who may not set one, while the sunset is to come", async () => {
    await render(superseded({ can: { setSunset: { ok: false, reason: REASONS.generic }, startRevoke: { ok: false, reason: REASONS.generic }, confirmRevoke: NO_REVOKE, cancelRevoke: NO_REVOKE } }));
    expect(container.querySelector("button")).toBeNull();
  });
});
