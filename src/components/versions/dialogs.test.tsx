// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult, ConsumerUsage } from "@/domain/review-types";

// The Versions tab's dialogs: what they refuse before sending, what they send, and where a refusal
// from the server shows. The server actions are replaced; the dialogs and the domain's consequence
// lines are real.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  setSunset: vi.fn<(input: { templateId: string; versionNumber: number; sunsetAt: string }) => Promise<ActionResult>>(),
  startRevoke: vi.fn<(input: { templateId: string; versionNumber: number; reason: string }) => Promise<ActionResult>>(),
  confirmRevoke: vi.fn<(input: { templateId: string; versionNumber: number }) => Promise<ActionResult>>(),
  cancelRevoke: vi.fn<(input: { templateId: string; versionNumber: number }) => Promise<ActionResult>>(),
}));
vi.mock("@/server/actions/review", () => actions);

const { StartRevokeDialog, ConfirmRevokeDialog } = await import("./revoke-dialogs");
const { SunsetDialog } = await import("./sunset-dialog");

const USAGE: ConsumerUsage[] = [
  { consumerId: "coral", consumerName: "Coral", versionNumber: 1, lastRenderAt: "2026-10-05T01:00:00.000Z", renders30d: 332 },
];
const NOW = "2026-10-05T02:29:00.000Z";
const BASE = { templateId: "UC-ABC123", versionNumber: 1, activeNumber: 2, usage: USAGE, nowIso: NOW };

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

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

async function pressKey(el: HTMLElement, init: KeyboardEventInit) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

async function typeInto(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("StartRevokeDialog", () => {
  const onOpenChange = vi.fn();
  const open = () => render(<StartRevokeDialog open onOpenChange={onOpenChange} {...BASE} />);

  beforeEach(() => onOpenChange.mockReset());

  it("says first that another approver must confirm, then what the revoke will do once they do, before the reason", async () => {
    await open();
    const text = dialog().textContent ?? "";
    expect(text).toContain("Revoke v1");
    expect(text).toContain("Another approver must confirm before this takes effect.");
    expect(text).toContain("Coral rendered v1 332 times in the last 30 days. Once confirmed, its renders will fail immediately.");
    // The explanation comes before the consequences, which come before the reason.
    expect(text.indexOf("Another approver")).toBeLessThan(text.indexOf("Coral rendered"));
    expect(text.indexOf("Coral rendered")).toBeLessThan(text.indexOf("Reason"));
    // The dialog's standard: no Close X; an outline Cancel and the primary.
    expect(dialog().querySelector('[aria-label="Close"]')).toBeNull();
    expect(button("Cancel")).toBeTruthy();
  });

  it("reads as blocked until there is a reason, and never sends a blank one", async () => {
    await open();
    expect(blocked(button("Start revoke"))).toBe(true);
    // Not natively disabled: it keeps the focus, and pressing it says what's missing.
    expect(button("Start revoke").disabled).toBe(false);
    await typeInto(dialog().querySelector("textarea")!, "   ");
    expect(blocked(button("Start revoke"))).toBe(true);
    await click(button("Start revoke"));
    expect(actions.startRevoke).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("Say why this version is being revoked.");
  });

  it("says nothing at an empty field, and says why at a field of blanks once it is left", async () => {
    await open();
    const field = dialog().querySelector("textarea")!;
    await act(async () => field.focus());
    await act(async () => field.blur());
    expect(dialog().textContent).not.toContain("Say why");
    expect(field.getAttribute("aria-invalid")).toBeNull();

    await typeInto(field, "  \n ");
    expect(dialog().textContent).not.toContain("Say why");
    await act(async () => field.focus());
    await act(async () => field.blur());
    expect(dialog().textContent).toContain("Say why this version is being revoked.");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(dialog().querySelector("[id$='-problem']")!.id);
  });

  it("says when the reason is over 2,000 characters, as it happens, and doesn't send it", async () => {
    await open();
    await typeInto(dialog().querySelector("textarea")!, "a".repeat(2001));
    expect(dialog().textContent).toContain("Keep the reason under 2,000 characters.");
    expect(blocked(button("Start revoke"))).toBe(true);
    await click(button("Start revoke"));
    expect(actions.startRevoke).not.toHaveBeenCalled();
  });

  it("sends the trimmed reason and closes on success", async () => {
    actions.startRevoke.mockResolvedValue({ ok: true });
    await open();
    await typeInto(dialog().querySelector("textarea")!, "  Wrong APR in the legal notices.  ");
    expect(blocked(button("Start revoke"))).toBe(false);
    await click(button("Start revoke"));
    expect(actions.startRevoke).toHaveBeenCalledWith({ templateId: "UC-ABC123", versionNumber: 1, reason: "Wrong APR in the legal notices." });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("presses the primary with ⌘Enter or Ctrl+Enter, when there is something to send", async () => {
    actions.startRevoke.mockResolvedValue({ ok: true });
    await open();
    const field = dialog().querySelector("textarea")!;
    // Blocked: it only explains.
    await pressKey(field, { key: "Enter", metaKey: true });
    expect(actions.startRevoke).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("Say why this version is being revoked.");

    await typeInto(field, "Wrong APR.");
    await pressKey(field, { key: "Enter", ctrlKey: true });
    expect(actions.startRevoke).toHaveBeenCalledTimes(1);
    await pressKey(field, { key: "Enter" });
    expect(actions.startRevoke).toHaveBeenCalledTimes(1);
  });

  it("keeps everything enabled to the browser while the server works, so the focus stays where it was", async () => {
    let answer: (result: ActionResult) => void = () => undefined;
    actions.startRevoke.mockReturnValue(new Promise<ActionResult>((resolve) => (answer = resolve)));
    await open();
    const field = dialog().querySelector("textarea")!;
    await typeInto(field, "Wrong APR.");
    await act(async () => field.focus());
    await click(button("Start revoke"));

    expect(button("Start revoke").disabled).toBe(false);
    expect(blocked(button("Start revoke"))).toBe(true);
    expect(blocked(button("Cancel"))).toBe(true);
    expect(field.disabled).toBe(false);
    expect(field.readOnly).toBe(true);
    expect(document.activeElement).toBe(field);

    // A second press, or a second ⌘Enter, doesn't send a second request.
    await click(button("Start revoke"));
    await pressKey(field, { key: "Enter", metaKey: true });
    expect(actions.startRevoke).toHaveBeenCalledTimes(1);

    await act(async () => answer({ ok: false, reason: "A revoke is already waiting for a second approver." }));
    expect(alertText()).toBe("A revoke is already waiting for a second approver.");
    expect(field.readOnly).toBe(false);
    expect(document.activeElement).toBe(field);
    expect(blocked(button("Start revoke"))).toBe(false);
  });

  it("shows a refusal at the button and stays open", async () => {
    actions.startRevoke.mockResolvedValue({ ok: false, reason: "A revoke is already waiting for a second approver." });
    await open();
    await typeInto(dialog().querySelector("textarea")!, "Wrong APR.");
    await click(button("Start revoke"));
    expect(alertText()).toBe("A revoke is already waiting for a second approver.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // The reason survives, so it can be sent again.
    expect(dialog().querySelector("textarea")!.value).toBe("Wrong APR.");
  });

  it("says something plain when the call itself fails", async () => {
    actions.startRevoke.mockRejectedValue(new Error("boom"));
    await open();
    await typeInto(dialog().querySelector("textarea")!, "Wrong APR.");
    await click(button("Start revoke"));
    expect(alertText()).toBe("Something went wrong. Try again.");
  });

  it("clears a refusal once the reason changes", async () => {
    actions.startRevoke.mockResolvedValue({ ok: false, reason: "No." });
    await open();
    const field = dialog().querySelector("textarea")!;
    await typeInto(field, "Wrong APR.");
    await click(button("Start revoke"));
    expect(alertText()).toBe("No.");
    await typeInto(field, "Wrong APR in the notices.");
    expect(alertText()).toBeNull();
  });
});

describe("ConfirmRevokeDialog", () => {
  const onOpenChange = vi.fn();

  it("names who started it and why, and what confirming does", async () => {
    await render(
      <ConfirmRevokeDialog open onOpenChange={onOpenChange} {...BASE} startedBy="Jordan Ellis" reason="Wrong APR in the legal notices." />,
    );
    expect(dialog().textContent).toContain("Jordan Ellis started this revoke: \u201CWrong APR in the legal notices.\u201D");
    // Confirming is the act itself: the effects are present tense, not "once confirmed".
    expect(dialog().textContent).toContain("Its renders will fail immediately.");
    expect(dialog().textContent).not.toContain("Once confirmed");
  });

  it("confirms, and shows the server's refusal at the button", async () => {
    actions.confirmRevoke.mockResolvedValue({ ok: false, reason: "You started this revoke. Another approver must confirm it." });
    await render(<ConfirmRevokeDialog open onOpenChange={onOpenChange} {...BASE} startedBy="Jordan Ellis" reason="Wrong APR." />);
    await click(button("Confirm revoke"));
    expect(actions.confirmRevoke).toHaveBeenCalledWith({ templateId: "UC-ABC123", versionNumber: 1 });
    expect(alertText()).toBe("You started this revoke. Another approver must confirm it.");
  });
});

describe("SunsetDialog", () => {
  const onOpenChange = vi.fn();
  const open = (currentSunset: string | null = null) =>
    render(
      <SunsetDialog
        open
        onOpenChange={onOpenChange}
        {...BASE}
        currentSunset={currentSunset}
        calendar={{ zone: "America/New_York", today: "2026-10-05" }}
      />,
    );

  beforeEach(() => onOpenChange.mockReset());

  it("starts 30 days out, with the consequences for that date", async () => {
    await open();
    expect(dialog().textContent).toContain("Set sunset for v1");
    expect(dialog().textContent).toContain("November 4, 2026");
    expect(dialog().textContent).toContain("Coral still renders v1 (last render today). It will keep working until November 4, 2026.");
  });

  it("starts on the sunset already set, and sends that date as a calendar day", async () => {
    actions.setSunset.mockResolvedValue({ ok: true });
    await open("2026-12-01");
    expect(dialog().textContent).toContain("December 1, 2026");
    await click(button("Change sunset"));
    expect(actions.setSunset).toHaveBeenCalledWith({ templateId: "UC-ABC123", versionNumber: 1, sunsetAt: "2026-12-01" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("names the time zone the day ends in, at the picker", async () => {
    await open();
    const zone = dialog().querySelector('[data-slot="sunset-zone"]');
    expect(zone?.textContent).toBe("Ends at 00:00 Eastern (America/New_York)");
    const picker = dialog().querySelector<HTMLButtonElement>('button[aria-labelledby="sunset-1-label sunset-1-date"]');
    expect(picker?.getAttribute("aria-describedby")).toBe(zone?.id);
  });

  it("is a change, with its own title and button, when a sunset is already set", async () => {
    await open("2026-12-01");
    expect(dialog().textContent).toContain("Change sunset for v1");
    expect(dialog().textContent).not.toContain("Set sunset for v1");
    expect(button("Change sunset")).toBeTruthy();
  });

  it("shows a refusal at the button and stays open", async () => {
    actions.setSunset.mockResolvedValue({ ok: false, reason: "Only a Superseded version can be given a sunset date." });
    await open();
    await click(button("Set sunset"));
    expect(alertText()).toBe("Only a Superseded version can be given a sunset date.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
