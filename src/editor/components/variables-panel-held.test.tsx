// @vitest-environment happy-dom
// A held root (read-only for a while, as while Submit reads the saved draft): the variables panel keeps
// its editing layout with every control disabled, and a form left open stays mounted with what was
// typed in it, so Cancel in the host's dialog returns to exactly where the author was. A truly
// read-only root is display only; it wins over `held`.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Variable } from "../model/types";
import { EditorRoot } from "./editor-root";
import { VariablesPanel } from "./variables-panel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const VARIABLES: Variable[] = [
  {
    key: "first_name",
    label: "First name",
    type: "text",
    required: true,
    sample: "Maya",
  },
  {
    key: "bonus_points",
    label: "Bonus points",
    type: "number",
    required: false,
    sample: "20000",
  },
];

let root: Root | null = null;
let host: HTMLElement | null = null;
const onVariablesChange = vi.fn();

async function show(props: {
  held?: boolean;
  readOnly?: boolean;
}): Promise<HTMLElement> {
  if (!host || !root) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  const tree: ReactNode = (
    <EditorRoot
      variables={VARIABLES}
      onVariablesChange={onVariablesChange}
      {...props}
    >
      <VariablesPanel />
    </EditorRoot>
  );
  await act(async () => root!.render(tree));
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
  onVariablesChange.mockClear();
});

const byLabel = (el: HTMLElement, label: string) =>
  el.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const button = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  ) ?? null;
const isDisabled = (el: Element | null) =>
  el !== null &&
  (el.hasAttribute("disabled") || el.hasAttribute("data-disabled"));

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("VariablesPanel while the root is held", () => {
  it("keeps the editing layout with every control disabled", async () => {
    const free = await show({});
    const freeRows = free.querySelectorAll("[data-variable-row]").length;
    const freeControls = free.querySelectorAll("button, [role=switch]").length;
    expect(isDisabled(byLabel(free, "Insert First name"))).toBe(false);

    const held = await show({ held: true });
    // The same controls as editing, none removed...
    expect(held.querySelectorAll("[data-variable-row]").length).toBe(freeRows);
    expect(held.querySelectorAll("button, [role=switch]").length).toBe(
      freeControls,
    );
    expect(held.textContent).toContain("Required");
    expect(button(held, "New variable")).not.toBeNull();
    // ...each disabled.
    expect(isDisabled(byLabel(held, "Insert First name"))).toBe(true);
    expect(isDisabled(byLabel(held, "Edit First name"))).toBe(true);
    expect(isDisabled(byLabel(held, "First name required"))).toBe(true);
    expect(isDisabled(button(held, "New variable"))).toBe(true);
    expect(
      held.querySelector("[data-variable-row]")?.getAttribute("draggable"),
    ).toBe("false");
  });

  it("does nothing when a disabled control is clicked", async () => {
    const host = await show({ held: true });
    await act(async () => {
      byLabel(host, "First name required")?.click();
      button(host, "New variable")?.click();
    });
    expect(host.querySelector("form")).toBeNull();
    expect(onVariablesChange).not.toHaveBeenCalled();
  });

  it("keeps an open form, and what was typed in it, disabled until the hold lets go", async () => {
    let host = await show({});
    await act(async () => button(host, "New variable")?.click());
    const label = () =>
      host.querySelector<HTMLInputElement>('form input[id$="-label"]')!;
    await type(label(), "Annual fee");
    expect(
      host.querySelector<HTMLInputElement>('form input[id$="-key"]')!.value,
    ).toBe("annual_fee");

    // The hold starts: the same form, the same inputs, now disabled.
    const input = label();
    host = await show({ held: true });
    expect(host.querySelector("form")).not.toBeNull();
    expect(label()).toBe(input);
    expect(label().value).toBe("Annual fee");
    expect(label().disabled).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('form input[id$="-key"]')!.disabled,
    ).toBe(true);
    expect(isDisabled(host.querySelector('form [role="switch"]'))).toBe(true);
    expect(
      isDisabled(host.querySelector('form [data-slot="select-trigger"]')),
    ).toBe(true);
    expect(button(host.querySelector("form")!, "Create")?.disabled).toBe(true);
    expect(button(host.querySelector("form")!, "Cancel")?.disabled).toBe(true);

    // Enter and Esc in a disabled form do nothing.
    await act(async () => {
      label().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      label().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(host.querySelector("form")).not.toBeNull();
    expect(onVariablesChange).not.toHaveBeenCalled();

    // The hold lets go: still the same form with what was typed, editable again.
    host = await show({});
    expect(label()).toBe(input);
    expect(label().value).toBe("Annual fee");
    expect(label().disabled).toBe(false);
    expect(button(host.querySelector("form")!, "Create")?.disabled).toBe(false);
  });

  it("keeps an open edit form the same way", async () => {
    let host = await show({});
    await act(async () => byLabel(host, "Edit First name")?.click());
    const label = () =>
      host.querySelector<HTMLInputElement>('form input[id$="-label"]')!;
    await type(label(), "Given name");

    host = await show({ held: true });
    expect(label().value).toBe("Given name");
    expect(label().disabled).toBe(true);
    expect(button(host.querySelector("form")!, "Delete")?.disabled).toBe(true);

    host = await show({});
    expect(label().value).toBe("Given name");
    expect(label().disabled).toBe(false);
  });

  it("stays display only when truly read-only, held or not", async () => {
    for (const props of [{ readOnly: true }, { readOnly: true, held: true }]) {
      const host = await show(props);
      expect(host.querySelector("[data-row-insert]")).toBeNull();
      expect(host.querySelector('[role="switch"]')).toBeNull();
      expect(button(host, "New variable")).toBeNull();
    }
  });
});
