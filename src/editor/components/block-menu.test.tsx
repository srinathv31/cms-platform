// @vitest-environment happy-dom
// The block menu (components/block-menu.tsx): named "Block options" however it opened; Numbering (ten
// styles and Default, the list's own checked) and Start at… for a numbered list; both disabled, with
// the reason, elsewhere. Choices are edits of the list node. The grip opens it on a click and closes
// it on the next one.

import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listItemMarkers } from "../extensions/list-markers";
import { editorExtensions } from "../schema";
import { createVariableStore } from "../state/variable-store";
import { byRole } from "../testing/editor";
import { GripBlockMenu, GripTrigger, KeyboardBlockMenu, NO_NUMBERING_REASON, START_RANGE_MESSAGE } from "./block-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const li = (text: string, ...nested: JSONContent[]): JSONContent => ({ type: "listItem", content: [p(text), ...nested] });
const DOC: JSONContent = {
  type: "doc",
  content: [p("Intro"), { type: "orderedList", attrs: { start: 1 }, content: [li("One", { type: "orderedList", content: [li("Inner")] }), li("Two")] }],
};

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** The grip and its menu, as the block handle wires them (a click while it closes is ignored). */
function Grip({ editor, blockPos, onClosed }: { editor: Editor; blockPos: number; onClosed: () => void }) {
  const [menu, setMenu] = useState<{ open: boolean; blockPos: number | null }>({ open: false, blockPos: null });
  const [grip, setGrip] = useState<HTMLElement | null>(null);
  const onOpenChange = (open: boolean) => setMenu((m) => (open ? (m.blockPos === null ? { open: true, blockPos } : m) : { ...m, open: false }));
  return (
    <GripBlockMenu
      editor={editor}
      blockPos={menu.blockPos}
      open={menu.open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setMenu({ open: false, blockPos: null });
        onClosed();
      }}
      anchor={grip}
    >
      <GripTrigger ref={setGrip} open={menu.open} onOpenChange={onOpenChange}>
        grip
      </GripTrigger>
    </GripBlockMenu>
  );
}

function setup(which: "grip" | "keyboard", blockIndex: number) {
  const frame = document.createElement("div");
  frame.className = "ucomp-editor";
  const element = document.createElement("div");
  const host = document.createElement("div");
  frame.append(element, host);
  document.body.appendChild(frame);
  const editor = new Editor({ element, extensions: editorExtensions({ store: createVariableStore([]) }), content: DOC });
  let blockPos = 0;
  for (let i = 0; i < blockIndex; i++) blockPos += editor.state.doc.child(i).nodeSize;
  const onClose = vi.fn();
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(
      which === "grip" ? (
        <Grip editor={editor} blockPos={blockPos} onClosed={onClose} />
      ) : (
        <KeyboardBlockMenu editor={editor} blockPos={blockPos} onClose={onClose} />
      ),
    );
  });
  cleanup = () => {
    act(() => root.unmount());
    editor.destroy();
  };
  return { editor, frame, onClose };
}

/** The menu, found the way assistive technology names it. */
const blockMenu = (frame: HTMLElement) => byRole(frame, "menu", "Block options");
const gripOf = (frame: HTMLElement) => frame.querySelector<HTMLElement>('[aria-label="Drag to move block, or click for options"]')!;

/** A click on the grip: press, release, click (a press alone starts a drag, so it doesn't open the menu). */
async function clickGrip(frame: HTMLElement, { pressOnly = false } = {}) {
  const grip = gripOf(frame);
  await act(async () => {
    grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await wait(20);
  });
  if (pressOnly) return;
  await act(async () => {
    grip.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }));
    grip.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    grip.click();
    await wait(20);
  });
}

async function openFromGrip(frame: HTMLElement) {
  expect(gripOf(frame).getAttribute("aria-haspopup")).toBe("menu");
  await clickGrip(frame, { pressOnly: true });
  expect(blockMenu(frame)).toBeNull();
  await clickGrip(frame);
  expect(gripOf(frame).getAttribute("aria-expanded")).toBe("true");
  expect(blockMenu(frame)).not.toBeNull();
}

const items = (frame: HTMLElement) => [...frame.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')];
const item = (frame: HTMLElement, name: string) => items(frame).find((el) => el.textContent?.trim().startsWith(name)) ?? null;
const markers = (editor: Editor) => listItemMarkers(editor.state.doc).map((m) => m.marker);

/** Activates an item the way Enter on it does: highlighted (focused) first, then a click with no pointer. */
async function click(el: HTMLElement | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.focus();
    await wait(10);
  });
  await act(async () => {
    el!.click();
    await wait(20);
  });
}

async function key(el: Element, name: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    await wait(20);
  });
}

/** Start at…, opened: the field, typing into it, and its reason. */
async function openStartAt(frame: HTMLElement) {
  await click(item(frame, "Start at"));
  const field = byRole(frame, "group", "Start at")?.querySelector<HTMLInputElement>("input") ?? null;
  expect(field).not.toBeNull();
  return {
    field: field!,
    async type(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
        field!.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    reason: () => {
      const id = field!.getAttribute("aria-describedby");
      return id ? (frame.querySelector(`#${CSS.escape(id)}`)?.textContent ?? null) : null;
    },
    check: () => frame.querySelector<HTMLButtonElement>('button[aria-label="Set start number"]')!,
  };
}

describe("block menu on a numbered list", () => {
  it("is named Block options (not after the grip), names the list and offers Numbering and Start at…, with the list's start", async () => {
    const { frame } = setup("grip", 1);
    await openFromGrip(frame);
    const popup = blockMenu(frame);
    expect(popup?.textContent).toContain("Numbered list");
    const numbering = item(frame, "Numbering");
    expect(numbering?.hasAttribute("data-disabled")).toBe(false);
    expect(numbering?.getAttribute("aria-haspopup")).toBe("menu");
    expect(item(frame, "Start at")?.textContent).toMatch(/Start at…\s*1$/);
    expect(frame.textContent).not.toContain(NO_NUMBERING_REASON);
  });

  it("closes on a second click on the grip, and focus goes back to the text", async () => {
    const { editor, frame, onClose } = setup("grip", 1);
    await openFromGrip(frame);
    await clickGrip(frame);
    await act(() => wait(50));
    expect(gripOf(frame).getAttribute("aria-expanded")).toBe("false");
    expect(blockMenu(frame)).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(editor.view.dom);

    // And the next click opens it again.
    await clickGrip(frame);
    expect(blockMenu(frame)).not.toBeNull();
  });

  it("lists Default and the ten styles with previews, the list's own checked, and applies a choice", async () => {
    const { editor, frame, onClose } = setup("grip", 1);
    await openFromGrip(frame);
    await click(item(frame, "Numbering"));
    expect(byRole(frame, "menu", "Numbering")).not.toBeNull();
    const radios = [...frame.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(radios.map((el) => el.textContent?.trim())).toEqual([
      "Default1. 2. 3.",
      "1. 2. 3.",
      "a. b. c.",
      "A. B. C.",
      "i. ii. iii.",
      "I. II. III.",
      "(1) (2) (3)",
      "(a) (b) (c)",
      "(i) (ii) (iii)",
      "1) 2) 3)",
      "a) b) c)",
    ]);
    expect(radios.filter((el) => el.getAttribute("aria-checked") === "true").map((el) => el.textContent)).toEqual(["Default1. 2. 3."]);

    await click(radios.find((el) => el.textContent === "(a) (b) (c)") ?? null);
    expect(editor.state.doc.child(1).attrs).toMatchObject({ markerFormat: "lower-alpha", markerDelimiter: "parens" });
    expect(markers(editor)).toEqual(["(a)", "a.", "(b)"]);
    await act(() => wait(50));
    expect(onClose).toHaveBeenCalled();
  });

  it("Start at… swaps its row for a field (a group, not a menu item): Enter applies 0 to 9999, and says why for anything else", async () => {
    const { editor, frame, onClose } = setup("grip", 1);
    await openFromGrip(frame);
    const start = await openStartAt(frame);
    expect(document.activeElement).toBe(start.field);
    expect(start.field.value).toBe("1");
    expect(start.field.closest('[role="menuitem"]')).toBeNull();
    expect(item(frame, "Start at")).toBeNull();

    await start.type("10000");
    expect(start.reason()).toBe(START_RANGE_MESSAGE);
    expect(start.field.getAttribute("aria-invalid")).toBe("true");
    expect(start.check().hasAttribute("data-disabled")).toBe(true);
    await key(start.field, "Enter");
    expect(editor.state.doc.child(1).attrs.start).toBe(1);
    expect(blockMenu(frame)).not.toBeNull();

    await start.type("0");
    expect(start.reason()).toBeNull();
    await key(start.field, "Enter");
    expect(editor.state.doc.child(1).attrs.start).toBe(0);
    expect(markers(editor)).toEqual(["0.", "a.", "1."]);
    await act(() => wait(50));
    expect(onClose).toHaveBeenCalled();
  });

  it("Start at…: empty says nothing until Enter, then why; the ✓ applies a valid number", async () => {
    const { editor, frame } = setup("grip", 1);
    await openFromGrip(frame);
    const start = await openStartAt(frame);
    await start.type("");
    expect(start.reason()).toBeNull();
    expect(start.check().hasAttribute("data-disabled")).toBe(true);
    await key(start.field, "Enter");
    expect(start.reason()).toBe(START_RANGE_MESSAGE);
    expect(document.activeElement).toBe(start.field);

    await start.type("12");
    await act(async () => {
      start.check().click();
      await wait(20);
    });
    expect(editor.state.doc.child(1).attrs.start).toBe(12);
  });

  it("Start at…: the field keeps focus while the pointer moves over it and off its row", async () => {
    const { frame } = setup("grip", 1);
    await openFromGrip(frame);
    const start = await openStartAt(frame);
    const popup = blockMenu(frame)!;
    await act(async () => {
      for (const target of [start.field, start.field.parentElement!]) {
        target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
        target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      }
      // Off the row, onto the menu's own padding, then out of the menu.
      start.field.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: popup }));
      start.field.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: popup }));
      popup.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", relatedTarget: start.field }));
      popup.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: document.body }));
      await wait(20);
    });
    expect(document.activeElement).toBe(start.field);
    expect(byRole(frame, "group", "Start at")).not.toBeNull();
  });

  it("Start at…: focus moving to another row cancels the field", async () => {
    const { editor, frame } = setup("grip", 1);
    await openFromGrip(frame);
    const start = await openStartAt(frame);
    await start.type("7");
    await act(async () => {
      item(frame, "Numbering")!.focus();
      await wait(20);
    });
    expect(byRole(frame, "group", "Start at")).toBeNull();
    expect(item(frame, "Start at")?.textContent).toMatch(/Start at…\s*1$/);
    expect(document.activeElement).toBe(item(frame, "Numbering"));
    expect(editor.state.doc.child(1).attrs.start).toBe(1);
  });

  it("Esc in the field goes back to the item, and the menu stays open", async () => {
    const { frame } = setup("grip", 1);
    await openFromGrip(frame);
    const start = await openStartAt(frame);
    await key(start.field, "Escape");
    await act(() => wait(50));
    expect(byRole(frame, "group", "Start at")).toBeNull();
    expect(blockMenu(frame)).not.toBeNull();
    expect(document.activeElement).toBe(item(frame, "Start at"));
    expect(item(frame, "Start at")?.hasAttribute("data-highlighted")).toBe(true);
  });
});

describe("block menu elsewhere", () => {
  it("shows Numbering and Start at… disabled, with the reason", async () => {
    const { frame } = setup("grip", 0);
    await openFromGrip(frame);
    const reason = [...frame.querySelectorAll("p")].find((el) => el.textContent === NO_NUMBERING_REASON);
    expect(reason).toBeDefined();
    for (const name of ["Numbering", "Start at"]) {
      const el = item(frame, name);
      expect(el?.hasAttribute("data-disabled")).toBe(true);
      expect(el?.getAttribute("aria-describedby")).toBe(reason?.id);
    }
    expect(frame.textContent).not.toContain("Numbered list");
  });
});

describe("keyboard opener", () => {
  it("puts a focused button in the block's gutter; Esc goes back to the text", async () => {
    const { editor, frame, onClose } = setup("keyboard", 1);
    await act(() => wait(20));
    const button = frame.querySelector<HTMLButtonElement>('[aria-label="Block options"][aria-keyshortcuts="Alt+F10"]');
    expect(button).not.toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button?.getAttribute("aria-haspopup")).toBe("menu");
    await key(button!, "Escape");
    expect(document.activeElement).toBe(editor.view.dom);
    expect(onClose).toHaveBeenCalled();
  });

  it("opens the same menu, named Block options", async () => {
    const { frame } = setup("keyboard", 1);
    await act(() => wait(20));
    await act(async () => {
      frame.querySelector<HTMLButtonElement>('[aria-keyshortcuts="Alt+F10"]')!.click();
      await wait(20);
    });
    expect(blockMenu(frame)?.textContent).toContain("Numbered list");
  });
});
