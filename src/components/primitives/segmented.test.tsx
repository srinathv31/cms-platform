// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Segmented, SegmentedRadio, type SegmentedOption } from "./segmented";

// The app's one segmented control, in its two semantics: toggle buttons for a view control, a radio
// group for a form field. One look for both.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Fruit = "apple" | "pear" | "plum";
const OPTIONS: readonly SegmentedOption<Fruit>[] = [
  { value: "apple", label: "Apple" },
  { value: "pear", label: "Pear" },
  { value: "plum", label: "Plum" },
];

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
});

const show = (node: React.ReactNode) => act(async () => root.render(node));
const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button")];
const named = (name: string) => buttons().find((b) => (b.getAttribute("aria-label") ?? b.textContent) === name)!;
const press = (el: HTMLElement, key: string) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

/** The classes every segment carries, whichever semantics it has. */
const SEGMENT_LOOK = ["h-6", "rounded-md", "px-2.5", "text-[13px]", "font-medium", "text-text-muted", "hover:bg-hover"];
const TRACK_LOOK = ["h-8", "rounded-lg", "border", "border-hairline", "bg-surface", "p-0.5"];
const classes = (el: Element) => new Set(el.getAttribute("class")?.split(/\s+/));

describe("Segmented", () => {
  it("is a group of toggle buttons named by its label, with the chosen one pressed", async () => {
    await show(<Segmented label="Fruit" value="pear" options={OPTIONS} onChange={() => {}} />);
    const group = container.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("Fruit");
    expect(buttons().map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["Apple", "false"],
      ["Pear", "true"],
      ["Plum", "false"],
    ]);
  });

  it("calls onChange with the option pressed, and never unchooses the chosen one", async () => {
    const onChange = vi.fn();
    await show(<Segmented label="Fruit" value="pear" options={OPTIONS} onChange={onChange} />);
    await act(async () => named("Plum").click());
    expect(onChange).toHaveBeenLastCalledWith("plum");
    onChange.mockClear();
    await act(async () => named("Pear").click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("draws an icon-only segment as a 24px square named by its label", async () => {
    await show(
      <Segmented
        label="Icon"
        value="pear"
        options={OPTIONS.map((o) => ({ ...o, icon: <svg data-icon={o.value} /> }))}
        onChange={() => {}}
      />,
    );
    const pear = named("Pear");
    expect(pear.textContent).toBe("");
    expect(pear.querySelector('[data-icon="pear"]')).not.toBeNull();
    expect(classes(pear).has("size-6")).toBe(true);
    expect(classes(pear).has("px-0")).toBe(true);
  });
});

describe("SegmentedRadio", () => {
  it("is a radio group labelled by the field, with one Tab stop on the chosen option", async () => {
    await show(
      <>
        <span id="fruit-label">Fruit</span>
        <SegmentedRadio labelledBy="fruit-label" value="pear" options={OPTIONS} onChange={() => {}} />
      </>,
    );
    const group = container.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-labelledby")).toBe("fruit-label");
    expect(buttons().map((b) => [b.getAttribute("role"), b.getAttribute("aria-checked"), b.tabIndex])).toEqual([
      ["radio", "false", -1],
      ["radio", "true", 0],
      ["radio", "false", -1],
    ]);
  });

  it("moves the choice and focus with the arrow keys, round from either end", async () => {
    function Field() {
      const [value, setValue] = useState<Fruit>("pear");
      return <SegmentedRadio labelledBy="x" value={value} options={OPTIONS} onChange={setValue} />;
    }
    await show(<Field />);
    const checked = () => buttons().find((b) => b.getAttribute("aria-checked") === "true")!.textContent;

    await press(named("Pear"), "ArrowRight");
    expect(checked()).toBe("Plum");
    expect(document.activeElement).toBe(named("Plum"));

    await press(named("Plum"), "ArrowDown");
    expect(checked()).toBe("Apple");

    await press(named("Apple"), "ArrowLeft");
    expect(checked()).toBe("Plum");

    await press(named("Plum"), "ArrowUp");
    expect(checked()).toBe("Pear");
    expect(document.activeElement).toBe(named("Pear"));
  });

  it("calls onChange on a click", async () => {
    const onChange = vi.fn();
    await show(<SegmentedRadio labelledBy="x" value="pear" options={OPTIONS} onChange={onChange} />);
    await act(async () => named("Apple").click());
    expect(onChange).toHaveBeenCalledWith("apple");
  });
});

describe("one look for both", () => {
  it("has the same track and the same segment, with the tan fill under the chosen one", async () => {
    await show(<Segmented label="Fruit" value="pear" options={OPTIONS} onChange={() => {}} />);
    const toggleTrack = classes(container.querySelector('[role="group"]')!);
    const toggle = classes(named("Pear"));
    await show(<SegmentedRadio labelledBy="x" value="pear" options={OPTIONS} onChange={() => {}} />);
    const radioTrack = classes(container.querySelector('[role="radiogroup"]')!);
    const radio = classes(named("Pear"));

    for (const c of TRACK_LOOK) {
      expect(toggleTrack.has(c), `toggle track ${c}`).toBe(true);
      expect(radioTrack.has(c), `radio track ${c}`).toBe(true);
    }
    for (const c of SEGMENT_LOOK) {
      expect(toggle.has(c), `toggle segment ${c}`).toBe(true);
      expect(radio.has(c), `radio segment ${c}`).toBe(true);
    }
    expect(toggle.has("aria-pressed:bg-selected")).toBe(true);
    expect(radio.has("aria-checked:bg-selected")).toBe(true);
    // The same focus ring: the toggle's own.
    expect(radio.has("focus-visible:ring-[3px]")).toBe(true);
    expect(toggle.has("focus-visible:ring-[3px]")).toBe(true);
  });
});
