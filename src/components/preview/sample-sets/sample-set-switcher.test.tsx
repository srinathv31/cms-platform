// @vitest-environment happy-dom
// The sample-set switcher: the menu, the values editor popover and what they hand the host.

import { act, useState, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SampleSet, Variable } from "@/editor/model/types";
import { listSets, resolveSetValues } from "./model";
import { SampleSetSwitcher, type SampleSetSwitcherHandle } from "./sample-set-switcher";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-10-04";

const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
  { key: "offer_end_date", label: "Offer end date", type: "date", required: true, sample: "2027-03-04" },
  { key: "home_state", label: "Home state", type: "us_state", required: true, sample: "NJ" },
  { key: "promo_code", label: "Promo code", type: "text", required: false, sample: "" },
];

const CUSTOM: SampleSet = { id: "holiday", name: "Holiday promo", values: { first_name: "Zed" } };

interface HostProps {
  stored?: SampleSet[];
  selected?: string;
  readOnly?: boolean;
  /** Leave onChange out, as a read-only host does. */
  noChange?: boolean;
  onSelect?: (id: string) => void;
  onChange?: (sets: SampleSet[]) => void;
  handle?: Ref<SampleSetSwitcherHandle>;
}

/** A host that keeps the state the way the preview does: stored sets and the selected id. */
function Host({ stored = [], selected = "typical", readOnly, noChange, onSelect, onChange, handle }: HostProps) {
  const [sets, setSets] = useState(stored);
  const [selectedId, setSelectedId] = useState(selected);
  return (
    <SampleSetSwitcher
      ref={handle}
      sets={listSets(sets, VARIABLES, TODAY)}
      variables={VARIABLES}
      today={TODAY}
      selectedId={selectedId}
      readOnly={readOnly}
      onSelect={(id) => {
        onSelect?.(id);
        setSelectedId(id);
      }}
      onChange={
        noChange
          ? undefined
          : (next) => {
              onChange?.(next);
              setSets(next);
            }
      }
    />
  );
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const render = (props: HostProps = {}) => act(async () => root.render(<Host {...props} />));
const sleep = (ms: number) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))));

/** Waits for what Base UI does a tick later (a menu opening, the editor opening after the menu). */
async function until(check: () => unknown) {
  for (let i = 0; i < 40; i++) {
    if (check()) return;
    await sleep(25);
  }
  throw new Error("timed out waiting for the UI");
}

async function click(el: Element) {
  await act(async () => {
    const init = { bubbles: true, cancelable: true, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mousedown", init));
    el.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseup", init));
    el.dispatchEvent(new MouseEvent("click", init));
  });
}

async function press(el: Element, key: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function blur(el: HTMLElement) {
  await act(async () => el.blur());
}

const trigger = () => container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
const menu = () => document.querySelector('[role="menu"]');
const menuItem = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')].find((el) => el.textContent?.trim() === name);
const popup = () => document.querySelector<HTMLElement>('[data-slot="sample-set-editor"]');
function findField(label: string): HTMLInputElement {
  const el = [...document.querySelectorAll<HTMLLabelElement>("label")].find((l) => l.textContent?.trim() === label);
  if (!el) throw new Error(`no field labelled "${label}"`);
  return document.getElementById(el.htmlFor) as HTMLInputElement;
}

async function openMenu() {
  await click(trigger());
  await until(menu);
}

/** Menu, then Edit values… (the editor opens once the menu has closed). */
async function openEditorFromMenu(name = "Edit values…") {
  await openMenu();
  await click(menuItem(name)!);
  await until(popup);
}

const lastChange = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)![0] as SampleSet[];
const byId = (sets: SampleSet[], id: string) => sets.find((s) => s.id === id)!;

describe("the menu", () => {
  it("shows the current set on the trigger and lists the sets with it checked, then Edit values… and New sample set", async () => {
    await render({ stored: [CUSTOM], selected: "long" });
    expect(trigger().textContent).toBe("Long name and maximum values");
    expect(trigger().getAttribute("aria-label")).toBe("Sample set: Long name and maximum values");
    await openMenu();
    const radios = [...document.querySelectorAll('[role="menuitemradio"]')];
    expect(radios.map((r) => r.textContent?.trim())).toEqual([
      "Typical customer",
      "Long name and maximum values",
      "Minimum values",
      "Holiday promo",
    ]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false"]);
    expect(menuItem("Edit values…")).toBeTruthy();
    expect(menuItem("New sample set")).toBeTruthy();
  });

  it("is 32px tall and truncates a name too long for its room, with the whole name in its title", async () => {
    const name = "Long name and maximum values, a second pass over the offer terms with the dates written out in full";
    await render({ stored: [{ id: "wordy", name, values: {} }], selected: "wordy" });
    // The text is whole (the accessible name and the DOM have all of it); only the paint is cut.
    expect(trigger().textContent).toBe(name);
    expect(trigger().getAttribute("aria-label")).toBe(`Sample set: ${name}`);
    expect(trigger().getAttribute("title")).toBe(name);
    expect(trigger().querySelector("span")?.className).toMatch(/\btruncate\b/);
    expect(trigger().className).toContain("max-w-full");
    // One line, whatever the name: the header row's height never depends on it.
    expect(trigger().className).not.toMatch(/\bh-auto\b|\bmin-h-8\b|\bwhitespace-normal\b/);
  });

  it("selects a set", async () => {
    const onSelect = vi.fn();
    await render({ onSelect });
    await openMenu();
    await click(menuItem("Minimum values")!);
    expect(onSelect).toHaveBeenCalledWith("minimum");
    await until(() => !menu());
    expect(trigger().textContent).toBe("Minimum values");
  });

  it("is reachable and operable from the keyboard", async () => {
    const onSelect = vi.fn();
    await render({ onSelect });
    await press(trigger(), "ArrowDown");
    await until(menu);
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(items.length).toBe(3);
    // Esc closes it and focus returns to the trigger.
    await press(menu()!, "Escape");
    await until(() => !menu());
    expect(document.activeElement).toBe(trigger());
  });
});

describe("the values editor", () => {
  it("opens from the menu with a row per variable, in order, each with its type, label and key", async () => {
    await render();
    await openEditorFromMenu();
    const labels = [...popup()!.querySelectorAll("label")].map((l) => l.textContent?.trim());
    expect(labels).toEqual(VARIABLES.map((v) => v.label));
    const keys = [...popup()!.querySelectorAll(".font-mono")].map((k) => k.textContent);
    expect(keys).toEqual(VARIABLES.map((v) => v.key));
    expect(popup()!.querySelectorAll("svg").length).toBeGreaterThanOrEqual(VARIABLES.length);
    // Every field shows a value (the generated default fills the gaps), and focus is on the first.
    expect(findField("Annual fee").value).toBe("95");
    expect(findField("Home state").value).toBe("NJ");
    expect(document.activeElement).toBe(findField("First name"));
    // A default set has no name field and can't be deleted.
    expect(popup()!.textContent).not.toContain("Name");
    expect(popup()!.textContent).not.toContain("Delete");
  });

  it("opens with the imperative handle", async () => {
    const handle = { current: null as SampleSetSwitcherHandle | null };
    await render({ handle });
    expect(popup()).toBeNull();
    await act(async () => handle.current!.openEditor());
    await until(popup);
    expect(findField("First name")).toBeTruthy();
  });

  it("focuses the first empty required value when it opens", async () => {
    await render({ stored: [{ id: "typical", name: "Typical customer", values: { annual_fee: "" } }] });
    await openEditorFromMenu();
    await until(() => document.activeElement === findField("Annual fee"));
  });

  it("normalizes a valid value to canonical and stores it at once", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openEditorFromMenu();
    await typeInto(findField("Annual fee"), "$1,000");
    expect(onChange).not.toHaveBeenCalled(); // typing alone stores nothing
    await blur(findField("Annual fee"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const sets = lastChange(onChange);
    expect(sets.map((s) => s.id)).toEqual(["typical", "long", "minimum"]); // the generated defaults join the list
    expect(byId(sets, "typical").values.annual_fee).toBe("1000");
    expect(findField("Annual fee").value).toBe("1000");
    expect(findField("Annual fee").getAttribute("aria-invalid")).toBeNull();
  });

  it("accepts friendly dates, percents and states", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openEditorFromMenu();
    await typeInto(findField("Offer end date"), "3/5/2027");
    await blur(findField("Offer end date"));
    await typeInto(findField("Purchase APR"), "18.5%");
    await blur(findField("Purchase APR"));
    await typeInto(findField("Home state"), "new york");
    await blur(findField("Home state"));
    const values = byId(lastChange(onChange), "typical").values;
    expect(values).toMatchObject({ offer_end_date: "2027-03-05", purchase_apr: "18.5", home_state: "NY" });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("marks an invalid value with an error ring and message, and doesn't store it", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openEditorFromMenu();
    const apr = findField("Purchase APR");
    await typeInto(apr, "lots");
    await blur(apr);
    expect(onChange).not.toHaveBeenCalled();
    expect(apr.getAttribute("aria-invalid")).toBe("true");
    const message = document.getElementById(apr.getAttribute("aria-describedby")!);
    expect(message?.textContent).toBe("Enter a percentage, like 21.99");
    // Typing again clears the message until the next blur.
    await typeInto(apr, "19");
    expect(apr.getAttribute("aria-invalid")).toBeNull();
    await blur(apr);
    expect(byId(lastChange(onChange), "typical").values.purchase_apr).toBe("19");
  });

  it("drops an invalid value when the popover closes, and shows the stored one next time", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openEditorFromMenu();
    await typeInto(findField("Annual fee"), "lots");
    await blur(findField("Annual fee"));
    await press(popup()!, "Escape");
    await until(() => !popup());
    expect(onChange).not.toHaveBeenCalled();
    await openEditorFromMenu();
    expect(findField("Annual fee").value).toBe("95");
  });

  it("commits a valid value on Enter and on Esc", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openEditorFromMenu();
    await typeInto(findField("Annual fee"), "250");
    await press(findField("Annual fee"), "Enter");
    expect(byId(lastChange(onChange), "typical").values.annual_fee).toBe("250");
    await typeInto(findField("First name"), "  Sam ");
    await press(findField("First name"), "Escape");
    expect(byId(lastChange(onChange), "typical").values.first_name).toBe("Sam");
  });

  it("allows emptying a required value and marks the field quietly", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openEditorFromMenu();
    const first = findField("First name");
    await typeInto(first, "");
    await blur(first);
    expect(byId(lastChange(onChange), "typical").values.first_name).toBe("");
    expect(first.value).toBe("");
    expect(first.getAttribute("aria-invalid")).toBeNull();
    expect(document.getElementById(first.getAttribute("aria-describedby")!)?.textContent).toBe("Required, and empty");
    // The values the preview should render with keep it empty (the render route then names it as missing).
    const sets = lastChange(onChange);
    expect(resolveSetValues(byId(sets, "typical"), VARIABLES, TODAY).first_name).toBe("");
  });

  it("doesn't call onChange when a value is left as it was", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    await openEditorFromMenu();
    await typeInto(findField("Annual fee"), "$95"); // the same canonical value, "95" ("95.00" would be new digits)
    await blur(findField("Annual fee"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes with Esc and returns focus to the trigger", async () => {
    await render();
    await openEditorFromMenu();
    await press(findField("First name"), "Escape");
    await until(() => !popup());
    await until(() => document.activeElement === trigger());
  });
});

describe("a new sample set", () => {
  it("copies the current set's values into 'Sample set 4', selects it and opens the editor on its name", async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    await render({ onChange, onSelect, selected: "long" });
    await openMenu();
    await click(menuItem("New sample set")!);
    const sets = lastChange(onChange);
    expect(sets).toHaveLength(4);
    const made = sets[3];
    expect(made.name).toBe("Sample set 4");
    expect(made.id).toMatch(/^set_/);
    expect(made.values).toEqual(resolveSetValues(listSets([], VARIABLES, TODAY)[1], VARIABLES, TODAY));
    expect(onSelect).toHaveBeenCalledWith(made.id);
    await until(popup);
    expect(trigger().textContent).toBe("Sample set 4");
    const name = popup()!.querySelector<HTMLInputElement>("#" + CSS.escape(popup()!.querySelector("label")!.getAttribute("for")!))!;
    expect(name.value).toBe("Sample set 4");
    await until(() => document.activeElement === name);
  });

  it("numbers the next one after the highest in use", async () => {
    const onChange = vi.fn();
    await render({ onChange, stored: [{ id: "a", name: "Sample set 4", values: {} }] });
    await openMenu();
    await click(menuItem("New sample set")!);
    expect(lastChange(onChange).at(-1)!.name).toBe("Sample set 5");
  });
});

describe("a custom set", () => {
  it("can be renamed from the name field on top", async () => {
    const onChange = vi.fn();
    await render({ onChange, stored: [CUSTOM], selected: "holiday" });
    await openEditorFromMenu();
    const name = findField("Name");
    expect(name.value).toBe("Holiday promo");
    await typeInto(name, "  Black  Friday ");
    await blur(name);
    expect(byId(lastChange(onChange), "holiday").name).toBe("Black Friday");
    expect(trigger().textContent).toBe("Black Friday");
  });

  it("refuses an empty name and another set's name", async () => {
    const onChange = vi.fn();
    await render({ onChange, stored: [CUSTOM], selected: "holiday" });
    await openEditorFromMenu();
    const name = findField("Name");
    await typeInto(name, "typical customer");
    await blur(name);
    expect(onChange).not.toHaveBeenCalled();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(name.getAttribute("aria-describedby")!)?.textContent).toBe("Another set has this name");
    await typeInto(name, "");
    await blur(name);
    expect(document.getElementById(name.getAttribute("aria-describedby")!)?.textContent).toBe("Enter a name");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is deleted at once when nothing was edited, and the set before it is selected", async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    await render({ onChange, onSelect });
    await openMenu();
    await click(menuItem("New sample set")!); // an untouched copy of Typical
    await until(popup);
    await click([...popup()!.querySelectorAll("button")].find((b) => b.textContent === "Delete set")!);
    expect(lastChange(onChange).map((s) => s.id)).toEqual(["typical", "long", "minimum"]);
    expect(onSelect).toHaveBeenLastCalledWith("minimum");
    await until(() => !popup());
    expect(trigger().textContent).toBe("Minimum values");
  });

  it("asks first when values were edited, and Cancel keeps the set", async () => {
    const onChange = vi.fn();
    await render({ onChange, stored: [CUSTOM], selected: "holiday" });
    await openEditorFromMenu();
    onChange.mockClear();
    await click([...popup()!.querySelectorAll("button")].find((b) => b.textContent === "Delete set")!);
    expect(onChange).not.toHaveBeenCalled();
    expect(popup()!.textContent).toContain("Delete this set and its edits?");
    const cancel = [...popup()!.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!;
    await click(cancel);
    expect(onChange).not.toHaveBeenCalled();
    expect(popup()!.textContent).not.toContain("Delete this set and its edits?");
    expect([...popup()!.querySelectorAll("button")].some((b) => b.textContent === "Delete set")).toBe(true);
  });

  it("is deleted after the confirm", async () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    await render({ onChange, onSelect, stored: [CUSTOM], selected: "holiday" });
    await openEditorFromMenu();
    await click([...popup()!.querySelectorAll("button")].find((b) => b.textContent === "Delete set")!);
    await click([...popup()!.querySelectorAll("button")].find((b) => b.textContent === "Delete")!);
    expect(lastChange(onChange).map((s) => s.id)).toEqual(["typical", "long", "minimum"]);
    expect(onSelect).toHaveBeenLastCalledWith("minimum");
    await until(() => !popup());
  });
});

describe("read-only", () => {
  it("still switches sets", async () => {
    const onSelect = vi.fn();
    await render({ readOnly: true, onSelect });
    await openMenu();
    await click(menuItem("Long name and maximum values")!);
    expect(onSelect).toHaveBeenCalledWith("long");
  });

  it("offers View values… and no New sample set, and shows the values as text", async () => {
    await render({ readOnly: true });
    await openMenu();
    expect(menuItem("Edit values…")).toBeUndefined();
    expect(menuItem("New sample set")).toBeUndefined();
    await click(menuItem("View values…")!);
    await until(popup);
    expect(popup()!.querySelectorAll("input")).toHaveLength(0);
    const text = popup()!.textContent!;
    expect(text).toContain("First name");
    expect(text).toContain("Maya");
    expect(text).toContain("$95"); // formatted by type, digits as stored
    expect(text).not.toContain("$95.00");
    expect(text).toContain("New Jersey");
    expect(popup()!.textContent).not.toContain("Delete");
  });

  it("is read-only without an onChange, too", async () => {
    await render({ noChange: true, stored: [CUSTOM], selected: "holiday" });
    await openMenu();
    expect(menuItem("New sample set")).toBeUndefined();
    await click(menuItem("View values…")!);
    await until(popup);
    expect(popup()!.querySelectorAll("input")).toHaveLength(0);
    expect(popup()!.textContent).not.toContain("Name");
  });
});
