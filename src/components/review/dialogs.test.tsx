// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult, ConsumerUsage, StepView } from "@/domain/review-types";
import type { ContractChange } from "@/domain/types";

// The review screen's two decision dialogs: what they refuse before sending, what they send, how the
// consequence lines follow the sunset switch, and where a refusal from the server shows. The server
// actions are replaced; the dialogs and the domain's consequence lines are real.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  approveVersion: vi.fn<
    (input: {
      templateId: string;
      versionNumber: number;
      sunsetPrevious?: string | null;
      sampleSetsSeen: string[];
    }) => Promise<ActionResult<{ wentLive: boolean; number: number }>>
  >(),
  requestChanges: vi.fn<(input: { templateId: string; versionNumber: number; reason: string }) => Promise<ActionResult>>(),
  // The Versions tab's dialogs share this module; they aren't under test here.
  setSunset: vi.fn(),
  startRevoke: vi.fn(),
  confirmRevoke: vi.fn(),
  cancelRevoke: vi.fn(),
}));
vi.mock("@/server/actions/review", () => actions);

const { ApproveDialog } = await import("./approve-dialog");
const { RequestChangesDialog } = await import("./request-dialog");
const { approvalStage } = await import("./decision-model");

const step = (position: number, name: string, status: StepView["status"]): StepView => ({ position, name, status });
const ONE = approvalStage([step(0, "Team approver", "current")]);
const FIRST_OF_TWO = approvalStage([step(0, "Team approver", "current"), step(1, "Legal reviewer", "waiting")]);

const USAGE: ConsumerUsage[] = [
  { consumerId: "coral", consumerName: "Coral", versionNumber: 1, lastRenderAt: "2026-10-05T01:00:00.000Z", renders30d: 332 },
];
const NOW = "2026-10-05T02:29:00.000Z";

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of Object.values(actions)) fn.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement;
const button = (name: string) =>
  [...dialog().querySelectorAll("button")].find((b) => b.textContent?.trim() === name) as HTMLButtonElement;
// The footer's reason is the one live region in the dialog (it is always there, empty until a refusal).
const alertText = () => dialog().querySelector('[role="alert"]')?.textContent || null;
const blocked = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true";
// The first consequence line is the dialog's description; the rest sit in the box under it.
const description = () => dialog().querySelector('[data-slot="dialog-description"]')!.textContent;
const boxLines = () => [...dialog().querySelectorAll('[data-slot="consequences"] li')].map((li) => li.textContent);
const lines = () => [description(), ...boxLines()];
const sunsetSwitch = () => dialog().querySelector('[role="checkbox"]') as HTMLElement | null;
// Base UI's checkbox is a button with a hidden input beside it; a click on the label reaches both.
const sunsetLabel = () => dialog().querySelector('label[id$="-sunset"]') as HTMLElement | null;

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

async function typeInto(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("RequestChangesDialog", () => {
  const onOpenChange = vi.fn();
  const onRequested = vi.fn();
  const open = () =>
    render(
      <RequestChangesDialog
        open
        onOpenChange={onOpenChange}
        templateId="UC-ABC123"
        versionNumber={3}
        authorName="Maya Chen"
        onRequested={onRequested}
      />,
    );

  beforeEach(() => {
    onOpenChange.mockReset();
    onRequested.mockReset();
  });

  it("asks for a reason, with the cursor already in it", async () => {
    await open();
    expect(dialog().textContent).toContain("Request changes");
    const field = dialog().querySelector("textarea")!;
    expect(field.getAttribute("aria-required")).toBe("true");
    await vi.waitFor(() => expect(document.activeElement).toBe(field));
  });

  it("reads as blocked until there is a reason, never sends a blank one, and marks the field without lecturing", async () => {
    await open();
    expect(blocked(button("Request changes"))).toBe(true);
    expect(dialog().textContent).not.toContain("Say what needs to change.");
    await typeInto(dialog().querySelector("textarea")!, "  \n ");
    expect(blocked(button("Request changes"))).toBe(true);
    await click(button("Request changes"));
    expect(actions.requestChanges).not.toHaveBeenCalled();
    // Marked invalid, with the caret in it, and no sentence: the label says what the field is.
    expect(dialog().querySelector("textarea")!.getAttribute("aria-invalid")).toBe("true");
    expect(dialog().querySelector("[id$='-problem']")).toBeNull();
    expect(dialog().textContent).not.toContain("Say what needs to change.");
    expect(document.activeElement).toBe(dialog().querySelector("textarea"));
  });

  it("follows the dialog standard: the consequence as the one-line description, no Close X, an outline Cancel", async () => {
    await open();
    expect(dialog().querySelector('[data-slot="dialog-description"]')!.textContent).toBe(
      "Maya Chen gets a new draft of v3 with your reason and the comments.",
    );
    expect(dialog().querySelector('[aria-label="Close"]')).toBeNull();
    expect(button("Cancel")).toBeTruthy();
  });

  it("sends the trimmed reason, then says so and closes", async () => {
    actions.requestChanges.mockResolvedValue({ ok: true });
    await open();
    await typeInto(dialog().querySelector("textarea")!, "  The APR in Legal notices is wrong.  ");
    expect(blocked(button("Request changes"))).toBe(false);
    await click(button("Request changes"));
    expect(actions.requestChanges).toHaveBeenCalledWith({
      templateId: "UC-ABC123",
      versionNumber: 3,
      reason: "The APR in Legal notices is wrong.",
    });
    expect(onRequested).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says when the reason is too long, and doesn't send it", async () => {
    await open();
    await typeInto(dialog().querySelector("textarea")!, "a".repeat(2001));
    expect(dialog().textContent).toContain("Keep the reason under 2,000 characters.");
    expect(blocked(button("Request changes"))).toBe(true);
    expect(actions.requestChanges).not.toHaveBeenCalled();
  });

  it("shows a refusal at the button, stays open, and keeps the reason", async () => {
    actions.requestChanges.mockResolvedValue({ ok: false, reason: "This version isn't in review." });
    await open();
    await typeInto(dialog().querySelector("textarea")!, "Fix the APR.");
    await click(button("Request changes"));
    expect(alertText()).toBe("This version isn't in review.");
    expect(onRequested).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(dialog().querySelector("textarea")!.value).toBe("Fix the APR.");
  });

  it("says something plain when the call itself fails", async () => {
    actions.requestChanges.mockRejectedValue(new Error("boom"));
    await open();
    await typeInto(dialog().querySelector("textarea")!, "Fix the APR.");
    await click(button("Request changes"));
    expect(alertText()).toBe("Something went wrong. Try again.");
  });
});

describe("ApproveDialog", () => {
  const onOpenChange = vi.fn();
  const onBegin = vi.fn();
  const onApproved = vi.fn();
  const onFailed = vi.fn();

  const open = (
    over: { previousNumber?: number | null; stage?: typeof ONE; sampleSetsSeen?: string[]; contractChanges?: ContractChange[] } = {},
  ) =>
    render(
      <ApproveDialog
        open
        onOpenChange={onOpenChange}
        templateId="UC-ABC123"
        versionNumber={2}
        previousNumber={over.previousNumber === undefined ? 1 : over.previousNumber}
        contractChanges={over.contractChanges ?? []}
        stage={over.stage ?? ONE}
        usage={USAGE}
        today="2026-10-05"
        nowIso={NOW}
        sampleSetsSeen={over.sampleSetsSeen ?? []}
        onBegin={onBegin}
        onApproved={onApproved}
        onFailed={onFailed}
      />,
    );

  beforeEach(() => {
    for (const fn of [onOpenChange, onBegin, onApproved, onFailed]) fn.mockReset();
  });

  it("says what goes live and that the previous version keeps rendering until it relinks, as its description", async () => {
    await open();
    expect(dialog().textContent).toContain("Approve v2");
    expect(description()).toBe("v2 becomes Active. v1 becomes Superseded; Coral keeps rendering v1 until it relinks.");
    // No lead-in about "what happens", and nothing more to say: no box.
    expect(dialog().textContent).not.toContain("What happens when");
    expect(boxLines()).toEqual([]);
    expect(dialog().querySelector('[data-slot="consequences"]')).toBeNull();
  });

  it("says what a breaking change asks of each consumer, with the keys in mono", async () => {
    await open({
      contractChanges: [
        { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true },
        { kind: "key_renamed", key: "state", breaking: true, from: "home_state", to: "state" },
      ],
    });
    expect(lines()).toEqual([
      "v2 becomes Active. v1 becomes Superseded; Coral keeps rendering v1 until it relinks.",
      "Coral has to map annual_fee and state before it moves to v2.",
    ]);
    const keys = [...dialog().querySelectorAll('[data-slot="consequences"] code')];
    expect(keys.map((k) => k.textContent)).toEqual(["annual_fee", "state"]);
    expect(keys[0].className).toContain("font-mono");
  });

  it("follows the sunset switch: the date it starts on (30 days out) and what that means for Coral", async () => {
    await open();
    expect(sunsetSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(button("Pick a date").disabled).toBe(true);

    await click(sunsetLabel()!);
    expect(lines()).toEqual([
      "v2 becomes Active. v1 becomes Superseded.",
      "Coral still renders v1 (last render today). It will keep working until November 4, 2026.",
    ]);
    expect(dialog().textContent).toContain("Set a sunset date for v1");
    expect(dialog().querySelector<HTMLButtonElement>('button[aria-label^="Sunset date"]')?.textContent).toContain("November 4, 2026");

    // Switched off again: back to the first answer.
    await click(sunsetLabel()!);
    expect(lines()).toEqual(["v2 becomes Active. v1 becomes Superseded; Coral keeps rendering v1 until it relinks."]);
  });

  it("approves with no sunset by default, and records the sample sets that were looked at", async () => {
    actions.approveVersion.mockResolvedValue({ ok: true, wentLive: true, number: 2 });
    await open({ sampleSetsSeen: ["typical", "long"] });
    await click(button("Approve v2"));
    expect(actions.approveVersion).toHaveBeenCalledWith({
      templateId: "UC-ABC123",
      versionNumber: 2,
      sunsetPrevious: null,
      sampleSetsSeen: ["typical", "long"],
    });
    expect(onBegin).toHaveBeenCalledTimes(1);
    expect(onApproved).toHaveBeenCalledWith({ wentLive: true });
    expect(onFailed).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sends the sunset date as a calendar day when it is on", async () => {
    actions.approveVersion.mockResolvedValue({ ok: true, wentLive: true, number: 2 });
    await open();
    await click(sunsetLabel()!);
    await click(button("Approve v2"));
    expect(actions.approveVersion).toHaveBeenCalledWith(expect.objectContaining({ sunsetPrevious: "2026-11-04" }));
  });

  it("has no sunset to set when nothing is Active yet", async () => {
    await open({ previousNumber: null });
    expect(lines()).toEqual(["v2 becomes Active.", "Consumers can start using it right away."]);
    expect(sunsetSwitch()).toBeNull();
  });

  it("only moves the version along at an earlier stage: no sunset row, nothing goes live", async () => {
    actions.approveVersion.mockResolvedValue({ ok: true, wentLive: false, number: 2 });
    await open({ stage: FIRST_OF_TWO });
    expect(lines()).toEqual(["v2 moves to Legal reviewer for approval. It isn't Active until the last stage approves."]);
    expect(sunsetSwitch()).toBeNull();
    await click(button("Approve v2"));
    expect(actions.approveVersion).toHaveBeenCalledWith(expect.objectContaining({ sunsetPrevious: null }));
    expect(onApproved).toHaveBeenCalledWith({ wentLive: false });
  });

  it("shows a refusal at the button, stays open, and lets the screen know it failed", async () => {
    actions.approveVersion.mockResolvedValue({ ok: false, reason: "You submitted this version." });
    await open();
    await click(button("Approve v2"));
    expect(alertText()).toBe("You submitted this version.");
    expect(onApproved).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("says something plain when the call itself fails", async () => {
    actions.approveVersion.mockRejectedValue(new Error("boom"));
    await open();
    await click(button("Approve v2"));
    expect(alertText()).toBe("Something went wrong. Try again.");
    expect(onFailed).toHaveBeenCalledTimes(1);
  });
});
