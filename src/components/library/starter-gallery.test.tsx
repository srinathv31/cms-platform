// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// New template's gallery: Document · Alert over the cards decides the kind, each kind has its own
// starters, and Import a file stays in place but can't be used while Alert is chosen.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createTemplate = vi.fn(async (input: unknown) => {
  void input;
  return { ok: true as const };
});
vi.mock("@/server/actions/create-template", () => ({ createTemplate }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), unstable_rethrow: () => {} }));

const { StarterGallery } = await import("./starter-gallery");

let root: Root;
let container: HTMLElement;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<StarterGallery teamSlug="coral-offers" columns={2} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  createTemplate.mockClear();
});

const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button")];
const kind = (name: string) => buttons().find((b) => b.textContent === name)!;
const cardNames = () =>
  [...container.querySelectorAll('[aria-label="Starting points"] button')].map((b) => b.querySelector("span.font-medium")?.textContent);
const importRow = () => buttons().find((b) => b.textContent?.includes("Import a file"))!;
const click = (el: HTMLElement) => act(async () => el.click());

describe("StarterGallery", () => {
  it("opens on Document, with the document starters and Import a file usable", () => {
    expect(container.querySelector('[aria-label="Kind of template"]')).not.toBeNull();
    expect(kind("Document").getAttribute("aria-pressed")).toBe("true");
    expect(kind("Alert").getAttribute("aria-pressed")).toBe("false");
    expect(cardNames()).toEqual(["Blank", "Card offer terms", "Rate change notice", "Fee schedule"]);
    expect(importRow().getAttribute("aria-disabled")).toBeNull();
    expect(importRow().getAttribute("aria-describedby")).toBeNull();
  });

  it("with Alert chosen: the alert starters, and Import disabled with its reason", async () => {
    await click(kind("Alert"));
    expect(kind("Alert").getAttribute("aria-pressed")).toBe("true");
    expect(cardNames()).toEqual(["Blank", "Payment reminder", "Card activity", "Statement ready"]);

    const row = importRow();
    expect(row.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(row.getAttribute("aria-describedby")!);
    expect(reason?.textContent).toBe("Only documents can be imported.");
    const picker = container.querySelector<HTMLInputElement>('[data-slot="import-input"]')!;
    const opened = vi.spyOn(picker, "click");
    await click(row);
    expect(opened).not.toHaveBeenCalled();
  });

  it("makes the template from the card picked, of the kind chosen", async () => {
    await click(kind("Alert"));
    const card = buttons().find((b) => b.textContent?.startsWith("Payment reminder"))!;
    await click(card);
    expect(createTemplate).toHaveBeenCalledWith({ teamSlug: "coral-offers", family: "message", starterKey: "payment_reminder" });

    await click(kind("Document"));
    await click(buttons().find((b) => b.textContent?.startsWith("Blank"))!);
    expect(createTemplate).toHaveBeenLastCalledWith({ teamSlug: "coral-offers", family: "document", starterKey: "blank" });
  });
});
