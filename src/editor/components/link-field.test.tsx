// @vitest-environment happy-dom
// The format bar's link field (link-field.tsx) takes web, email and phone links only (rule 23): Enter
// or Apply applies the link check's normalized href; anything else is refused with the check's
// reason, Apply disabled (focusable, marked `data-disabled`), and Enter says why.

import { Editor } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { editorExtensions } from "../schema";
import { createVariableStore } from "../state/variable-store";
import { doc, p } from "../testing/editor";
import { LinkField } from "./link-field";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

function setup(initialHref = "") {
  const element = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(element, host);
  const editor = new Editor({ element, extensions: editorExtensions({ store: createVariableStore([]) }), content: doc(p("Read the terms")) });
  editor.commands.setTextSelection({ from: 10, to: 15 }); // "terms"
  let closed = 0;
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(<LinkField editor={editor} initialHref={initialHref} hasLink={!!initialHref} onClose={() => closed++} />);
  });
  cleanup = () => {
    act(() => root.unmount());
    editor.destroy();
  };
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Link address"]')!;
  const apply = host.querySelector<HTMLButtonElement>('button[aria-label="Apply link"]')!;
  return {
    editor,
    host,
    input,
    apply,
    closed: () => closed,
    type(value: string) {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    /** Enter in the field, as the keyboard sends it. */
    enter() {
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
    },
    clickApply() {
      act(() => {
        apply.click();
      });
    },
    reason: () => {
      const id = input.getAttribute("aria-describedby");
      return id ? (host.querySelector(`#${CSS.escape(id)}`)?.textContent ?? null) : null;
    },
    hrefs: () =>
      editor
        .getJSON()
        .content?.[0].content?.flatMap((node) => (node.marks ?? []).filter((m) => m.type === "link").map((m) => m.attrs?.href)) ?? [],
  };
}

describe("LinkField", () => {
  it("Enter applies a web link, normalized", () => {
    const field = setup();
    field.type("  HTTPS://Coral.Example/café ");
    expect(field.reason()).toBeNull();
    expect(field.apply.hasAttribute("data-disabled")).toBe(false);
    field.enter();
    expect(field.hrefs()).toEqual(["https://Coral.Example/caf%C3%A9"]);
    expect(field.closed()).toBe(1);
  });

  it("Apply applies it too", () => {
    const field = setup();
    field.type("https://coral.example/terms");
    field.clickApply();
    expect(field.hrefs()).toEqual(["https://coral.example/terms"]);
    expect(field.closed()).toBe(1);
  });

  it.each([
    ["mailto:help@coral.example", "mailto:help@coral.example"],
    ["tel:+1(800)555-0100", "tel:+1(800)555-0100"],
    ["http://coral.example", "http://coral.example"],
  ])("applies %s", (input, href) => {
    const field = setup();
    field.type(input);
    field.enter();
    expect(field.hrefs()).toEqual([href]);
  });

  it.each([
    ["coral.example", "Links must start with https://, http://, mailto: or tel:."],
    ["javascript:alert(1)", "Links must start with https://, http://, mailto: or tel:."],
    ["/terms", "Links must start with https://, http://, mailto: or tel:."],
    ["https://coral.example/card terms", "Links can't contain spaces or line breaks."],
    ["https://bank.example@evil.example/", "Web links can't have a name or password before the site's address."],
    ["mailto:nobody", "Enter an email address after mailto:, like mailto:help@example.com."],
  ])("refuses %s with the reason, Apply disabled, and neither Enter nor Apply applies it", (input, message) => {
    const field = setup();
    field.type(input);
    expect(field.reason()).toBe(message);
    expect(field.input.getAttribute("aria-invalid")).toBe("true");
    expect(field.apply.hasAttribute("data-disabled")).toBe(true);
    field.enter();
    field.clickApply();
    expect(field.reason()).toBe(message);
    expect(field.hrefs()).toEqual([]);
    expect(field.closed()).toBe(0);
  });

  it("empty: Apply is disabled without a message, until Enter asks for a link", () => {
    const field = setup();
    expect(field.apply.hasAttribute("data-disabled")).toBe(true);
    expect(field.reason()).toBeNull();
    field.clickApply();
    expect(field.reason()).toBeNull();
    field.enter();
    expect(field.reason()).toBe("Enter a link.");
    expect(document.activeElement).toBe(field.input);
    expect(field.closed()).toBe(0);
  });

  it("Esc closes the field and applies nothing", () => {
    const field = setup();
    field.type("https://coral.example");
    act(() => {
      field.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(field.closed()).toBe(1);
    expect(field.hrefs()).toEqual([]);
  });

  it("an existing link the check refuses opens with its reason", () => {
    const field = setup("ftp://files.example");
    expect(field.reason()).toBe("Links must start with https://, http://, mailto: or tel:.");
  });
});
