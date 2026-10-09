// @vitest-environment happy-dom
// The submit dialog: what it lists, the breaking flags, the note, how a refusal and a success end, and
// the refresh it offers when the draft changed after its summary was read.

import { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFUSALS } from "@/domain/lifecycle";
import type { ActionResult } from "@/domain/review-types";
import type { Variable } from "@/domain/types";
import type { SubmitSummary } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined }));

const { SubmitDialog } = await import("./submit-dialog");

const v = (key: string, over: Partial<Variable> = {}): Variable => ({
  key,
  label: key,
  type: "text",
  required: true,
  sample: "",
  ...over,
});

const BASE = [v("first_name"), v("purchase_apr", { type: "percent" })];

const summary = (over: Partial<SubmitSummary> = {}): SubmitSummary => ({
  templateId: "UC-4F7K2Q",
  rev: 4,
  number: 3,
  name: "Spring Travel Rewards — Terms",
  channels: ["pdf", "email"],
  sampleSetNames: ["Typical customer", "Long name and maximum values", "Minimum values"],
  variables: BASE,
  baseline: { number: 2, name: "Spring Travel Rewards — Terms", variables: BASE },
  ...over,
});

type Submit = (note: string | undefined) => Promise<ActionResult<{ number: number }>>;
type Refresh = () => Promise<ActionResult<{ summary: SubmitSummary }>>;

let root: Root;
let container: HTMLElement;
let onSubmit: ReturnType<typeof vi.fn<Submit>>;
let onRefresh: ReturnType<typeof vi.fn<Refresh>>;
let closed: ReturnType<typeof vi.fn<(open: boolean) => void>>;

/** Holds the summary, as the Submit button does: a refresh hands it the new one. */
function Host({ data }: { data: SubmitSummary }) {
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState(data);
  return (
    <SubmitDialog
      summary={shown}
      open={open}
      onOpenChange={(next) => {
        closed(next);
        setOpen(next);
      }}
      finalFocus={createRef<HTMLElement>()}
      onSubmit={onSubmit}
      onRefresh={async () => {
        const result = await onRefresh();
        if (result.ok) setShown(result.summary);
        return result;
      }}
    />
  );
}

const render = (data: SubmitSummary) => act(async () => root.render(<Host data={data} />));
const dialog = () => document.body.querySelector<HTMLElement>("[data-slot='scrim-dialog-content']");
const note = () => document.body.querySelector<HTMLTextAreaElement>("textarea")!;
const button = (name: RegExp) =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => name.test(b.textContent ?? ""))!;

async function typeNote(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note(), value);
    note().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(el: HTMLElement, init: KeyboardEventInit) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onSubmit = vi.fn<Submit>(async () => ({ ok: true, number: 3 }));
  onRefresh = vi.fn<Refresh>(async () => ({ ok: true, summary: summary() }));
  closed = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("what the dialog lists", () => {
  it("names the version about to be assigned, in the title and on the one black button", async () => {
    await render(summary({ number: 4 }));
    expect(dialog()?.querySelector("[data-slot='dialog-title']")?.textContent).toBe("Submit v4 for review");
    expect(button(/^Submit v4$/)).toBeTruthy();
  });

  it("lists the enabled channels and the sample data sets", async () => {
    await render(summary());
    const text = dialog()!.textContent!;
    expect(text).toContain("PDF");
    expect(text).toContain("Email");
    expect(text).not.toContain("Web");
    for (const name of ["Typical customer", "Long name and maximum values", "Minimum values"]) expect(text).toContain(name);
  });

  it("flags breaking changes with the warning tokens and sets keys in mono", async () => {
    await render(summary({ variables: [...BASE, v("annual_fee", { type: "currency" }), v("promo_code", { required: false })] }));
    const rows = [...dialog()!.querySelectorAll("li")].filter((li) => li.textContent?.includes("v3 "));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.className).toContain("bg-warning-soft");
    expect(rows[0]!.textContent).toContain("Breaking: v3 adds required annual_fee (Currency).");
    expect(rows[0]!.querySelector("code")?.textContent).toBe("annual_fee");
    expect(rows[1]!.className).not.toContain("bg-warning-soft");
    // The section's header carries the badge.
    expect(dialog()!.textContent).toContain("Breaking change");
  });

  it("says so, quietly, when nothing changed against the Active version", async () => {
    await render(summary());
    expect(dialog()!.textContent).toContain("No contract changes from v2.");
    expect(dialog()!.textContent).not.toContain("Breaking change");
  });

  it("has no contract section when there is no Active version to compare with", async () => {
    await render(summary({ baseline: null }));
    expect(dialog()!.textContent).not.toContain("Contract changes");
  });

  it("lists a rename against the Active version, old name struck and new name inserted", async () => {
    await render(summary({ name: "Spring Travel Rewards — Card Terms" }));
    const line = dialog()!.querySelector("[data-slot='name-change']")!;
    expect(line.querySelector("del")?.textContent).toBe("Spring Travel Rewards — Terms");
    expect(line.querySelector("ins")?.textContent).toBe("Spring Travel Rewards — Card Terms");
    expect(line.textContent).toContain("Renamed from Spring Travel Rewards — Terms");
  });

  it("has no name section when the name is the Active version's, or nothing is Active", async () => {
    await render(summary());
    expect(dialog()!.querySelector("[data-slot='name-change']")).toBeNull();
    await render(summary({ name: "Spring Travel Rewards — Card Terms", baseline: null }));
    expect(dialog()!.querySelector("[data-slot='name-change']")).toBeNull();
  });

  it("starts with focus in the note, which is labelled for reviewers", async () => {
    await render(summary());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(note().labels?.[0]?.textContent).toBe("Note to reviewers");
    expect(document.activeElement).toBe(note());
  });
});

describe("the shell every action dialog shares", () => {
  it("is 512px wide with 32px padding: a title, a one-line description, the body, and a footer with Cancel and the primary", async () => {
    await render(summary());
    const popup = dialog()!;
    expect(popup.className).toContain("sm:max-w-lg");
    expect(popup.className).toContain("p-8");
    expect(popup.className).toContain("100dvh");
    const title = popup.querySelector("[data-slot='dialog-title']")!;
    const description = popup.querySelector("[data-slot='dialog-description']")!;
    expect(description.textContent).toBeTruthy();
    expect(description.className).not.toContain("sr-only");
    // In that order.
    expect(title.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(popup.querySelector("[data-slot='dialog-close']")).toBeNull();
    expect(button(/^Cancel$/).className).toContain("border-border");
    expect(button(/^Submit v3$/)).toBeTruthy();
  });
});

describe("focus while the server works", () => {
  /** A submit that stays pending until it is settled. */
  function deferred() {
    let settle!: (result: ActionResult<{ number: number }>) => void;
    const promise = new Promise<ActionResult<{ number: number }>>((resolve) => (settle = resolve));
    return { promise, settle };
  }

  it("keeps everything that can hold focus focusable (aria-disabled, read-only), never `disabled`", async () => {
    const pending = deferred();
    onSubmit.mockReturnValueOnce(pending.promise);
    await render(summary());
    const submit = button(/^Submit v3$/);
    submit.focus();
    await act(async () => submit.click());
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(submit.disabled).toBe(false);
    expect(button(/^Cancel$/).getAttribute("aria-disabled")).toBe("true");
    expect(button(/^Cancel$/).disabled).toBe(false);
    expect(note().readOnly).toBe(true);
    expect(note().disabled).toBe(false);
    expect(document.activeElement).toBe(submit);
    await act(async () => pending.settle({ ok: true, number: 3 }));
  });

  it("ignores a second submit and a Cancel while pending", async () => {
    const pending = deferred();
    onSubmit.mockReturnValueOnce(pending.promise);
    await render(summary());
    await act(async () => button(/^Submit v3$/).click());
    await act(async () => button(/^Submit v3$/).click());
    await act(async () => button(/^Cancel$/).click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalledWith(false);
    await act(async () => pending.settle({ ok: true, number: 3 }));
  });

  it("leaves focus on the Submit button after a refusal, so Tab stays in the dialog", async () => {
    onSubmit.mockResolvedValueOnce({ ok: false, reason: "Add an email subject before submitting." });
    await render(summary());
    const submit = button(/^Submit v3$/);
    submit.focus();
    await act(async () => submit.click());
    expect(dialog()!.querySelector("[role='alert']")?.textContent).toBe("Add an email subject before submitting.");
    expect(document.activeElement).toBe(submit);
    expect(submit.getAttribute("aria-disabled")).not.toBe("true");
    expect(note().readOnly).toBe(false);
  });

  it("leaves focus in the note after a refusal from ⌘Enter", async () => {
    onSubmit.mockResolvedValueOnce({ ok: false, reason: "Add an email subject before submitting." });
    await render(summary());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    note().focus();
    await press(note(), { key: "Enter", metaKey: true });
    expect(dialog()!.querySelector("[role='alert']")).not.toBeNull();
    expect(document.activeElement).toBe(note());
  });
});

describe("submitting", () => {
  it("sends the trimmed note and closes on success", async () => {
    await render(summary());
    await typeNote("  Raised the intro APR.  ");
    await act(async () => button(/^Submit v3$/).click());
    expect(onSubmit).toHaveBeenCalledWith("Raised the intro APR.");
    expect(closed).toHaveBeenLastCalledWith(false);
  });

  it("sends no note when it is blank", async () => {
    await render(summary());
    await act(async () => button(/^Submit v3$/).click());
    expect(onSubmit).toHaveBeenCalledWith(undefined);
  });

  it("⌘Enter submits, from the note", async () => {
    await render(summary());
    await typeNote("Ready.");
    await press(note(), { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith("Ready.");
  });

  it("Ctrl+Enter submits too", async () => {
    await render(summary());
    await press(note(), { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("Enter alone in the note is a new line, not a submit", async () => {
    await render(summary());
    await press(note(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("shows a refusal at the button and stays open, with the note kept", async () => {
    onSubmit.mockResolvedValueOnce({ ok: false, reason: "Add an email subject before submitting." });
    await render(summary());
    await typeNote("Keep me.");
    await act(async () => button(/^Submit v3$/).click());
    expect(dialog()!.querySelector("[role='alert']")?.textContent).toBe("Add an email subject before submitting.");
    expect(closed).not.toHaveBeenCalledWith(false);
    expect(note().value).toBe("Keep me.");
    // The reason clears when the author tries again.
    onSubmit.mockResolvedValueOnce({ ok: true, number: 3 });
    await act(async () => button(/^Submit v3$/).click());
    expect(closed).toHaveBeenLastCalledWith(false);
  });

  it("says it couldn't submit when the call itself fails", async () => {
    onSubmit.mockRejectedValueOnce(new Error("boom"));
    await render(summary());
    await act(async () => button(/^Submit v3$/).click());
    expect(dialog()!.querySelector("[role='alert']")?.textContent).toBe("Couldn't submit. Try again.");
  });

  it("Cancel closes without submitting", async () => {
    await render(summary());
    await act(async () => button(/^Cancel$/).click());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(closed).toHaveBeenLastCalledWith(false);
  });
});

describe("a summary the draft has moved past (handoff review I8)", () => {
  const STALE = { ok: false as const, reason: REFUSALS.summaryStale };
  const alert = () => dialog()!.querySelector("[role='alert']")?.textContent;
  const buttonNamed = (name: RegExp) =>
    [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => name.test(b.textContent ?? "")) ?? null;

  it("says so at the button, which becomes Refresh summary; refreshed, it lists the new draft and submits it", async () => {
    onSubmit.mockResolvedValueOnce(STALE);
    await render(summary());
    await typeNote("Keep me.");
    await act(async () => button(/^Submit v3$/).click());
    expect(alert()).toBe(REFUSALS.summaryStale);
    expect(closed).not.toHaveBeenCalledWith(false);
    expect(buttonNamed(/^Submit v3$/), "it no longer offers to submit what it shows").toBeNull();
    expect(buttonNamed(/^Refresh summary$/)).not.toBeNull();

    const moved = summary({ rev: 6, variables: [...BASE, v("gift_card", { required: false })] });
    onRefresh.mockResolvedValueOnce({ ok: true, summary: moved });
    await act(async () => button(/^Refresh summary$/).click());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(alert()).toBe("");
    expect(dialog()!.textContent).toContain("v3 adds optional gift_card (Text).");
    expect(note().value, "the note is kept").toBe("Keep me.");

    await act(async () => button(/^Submit v3$/).click());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith("Keep me.");
    expect(closed).toHaveBeenLastCalledWith(false);
  });

  it("⌘Enter refreshes, rather than submits, while the summary is stale", async () => {
    onSubmit.mockResolvedValueOnce(STALE);
    await render(summary());
    await press(note(), { key: "Enter", metaKey: true });
    expect(alert()).toBe(REFUSALS.summaryStale);
    await press(note(), { key: "Enter", metaKey: true });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(buttonNamed(/^Submit v3$/)).not.toBeNull();
  });

  it("keeps offering the refresh when it fails, with its reason", async () => {
    onSubmit.mockResolvedValueOnce(STALE);
    onRefresh.mockResolvedValueOnce({ ok: false, reason: "Your latest changes aren't saved yet." });
    await render(summary());
    await act(async () => button(/^Submit v3$/).click());
    await act(async () => button(/^Refresh summary$/).click());
    expect(alert()).toBe("Your latest changes aren't saved yet.");
    expect(buttonNamed(/^Refresh summary$/)).not.toBeNull();

    onRefresh.mockRejectedValueOnce(new Error("boom"));
    await act(async () => button(/^Refresh summary$/).click());
    expect(alert()).toBe("Couldn't refresh the summary. Try again.");
    expect(buttonNamed(/^Refresh summary$/)).not.toBeNull();
  });

  it("offers no refresh for any other refusal", async () => {
    onSubmit.mockResolvedValueOnce({ ok: false, reason: "Add an email subject before submitting." });
    await render(summary());
    await act(async () => button(/^Submit v3$/).click());
    expect(buttonNamed(/^Refresh summary$/)).toBeNull();
    expect(buttonNamed(/^Submit v3$/)).not.toBeNull();
  });
});
