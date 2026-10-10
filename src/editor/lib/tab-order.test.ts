// @vitest-environment happy-dom
// Tab from a portalled popover goes on from its anchor: the first control after it in the page.

import { afterEach, describe, expect, it } from "vitest";
import { nextTabbable } from "./tab-order";

afterEach(() => {
  document.body.innerHTML = "";
});

function page(html: string) {
  document.body.innerHTML = html;
  const get = (id: string) => document.getElementById(id)!;
  return get;
}

describe("nextTabbable", () => {
  it("is the first control after the field, past what is inside it", () => {
    const get = page(`
      <button id="before">Before</button>
      <div id="field" contenteditable="true"><span tabindex="0" id="chip">chip</span></div>
      <button id="next">Next</button>
      <button id="later">Later</button>
    `);
    expect(nextTabbable(get("field"))?.id).toBe("next");
  });

  it("reaches the next field, a link or an input, and skips what Tab doesn't stop at", () => {
    const get = page(`
      <div id="field" contenteditable="true"></div>
      <button disabled>Off</button>
      <span tabindex="-1">Programmatic only</span>
      <div hidden><button>In a hidden section</button></div>
      <div inert><button>Inert</button></div>
      <span tabindex="0" data-base-ui-focus-guard></span>
      <input type="hidden" />
      <div id="other" contenteditable="true"></div>
    `);
    expect(nextTabbable(get("field"))?.id).toBe("other");
  });

  it("leaves out the popover asking, though it sits after the field in the page", () => {
    const get = page(`
      <div id="field" contenteditable="true"></div>
      <div id="popover"><button>Replace with '</button></div>
      <a id="link" href="#x">A link</a>
    `);
    expect(nextTabbable(get("field"), get("popover"))?.id).toBe("link");
  });

  it("is null at the end of the page", () => {
    const get = page(`<button>Before</button><div id="field" contenteditable="true"></div>`);
    expect(nextTabbable(get("field"))).toBeNull();
  });
});
