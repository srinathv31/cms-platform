// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { BlockedButton } from "./blocked-button";

// A blocked action is shown greyed but stays focusable, so a keyboard user reaches it and its reason.

function mount(markup: string) {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.append(host);
  return host.querySelector("button") as HTMLButtonElement;
}

const description = (el: Element) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("BlockedButton", () => {
  it("is marked disabled without the native attribute, so it takes focus, and its reason describes it", () => {
    const button = mount(renderToStaticMarkup(<BlockedButton reason="The sunset has passed.">Change sunset</BlockedButton>));
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("data-disabled")).toBe(true);
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(description(button)).toBe("The sunset has passed.");
    // The hidden copy is what describes it, so it is not shown twice.
    expect(document.querySelector(".sr-only")?.textContent).toBe("The sunset has passed.");
  });

  it("points to a visible line that already says why, instead of a hidden copy", () => {
    const host = document.createElement("div");
    host.innerHTML = `<p id="why">You submitted this version.</p>${renderToStaticMarkup(
      <BlockedButton variant="default" reason="You submitted this version." describedBy="why">
        Approve
      </BlockedButton>,
    )}`;
    document.body.append(host);
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-describedby")).toBe("why");
    expect(description(button)).toBe("You submitted this version.");
    expect(host.querySelector(".sr-only")).toBeNull();
  });

  it("greys itself with data-disabled classes, since shadcn's disabled: ones don't match", () => {
    const button = mount(renderToStaticMarkup(<BlockedButton reason="x">Approve</BlockedButton>));
    expect(button.className).toContain("data-disabled:opacity-50");
    expect(button.className).toContain("data-disabled:cursor-default");
  });
});
