// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { closePreview, focusPreviewToggle } from "./close-preview";

afterEach(() => {
  document.body.replaceChildren();
});

function page() {
  const toggle = document.createElement("button");
  toggle.setAttribute("data-preview-toggle", "");
  const inRail = document.createElement("button");
  const inDocument = document.createElement("div");
  inDocument.tabIndex = 0;
  document.body.append(toggle, inRail, inDocument);
  return { toggle, inRail, inDocument };
}

const fakeSession = () => ({ closePreview: vi.fn(), setRailOpen: vi.fn() });

describe("closePreview", () => {
  it("puts the preview and the overlay away, and returns focus to the Preview toggle", () => {
    const { toggle, inRail } = page();
    inRail.focus();
    const session = fakeSession();
    closePreview(session, { restoreFocus: true });
    expect(session.closePreview).toHaveBeenCalledTimes(1);
    expect(session.setRailOpen).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(toggle);
  });

  it("leaves focus where it is when asked to (an Esc in the document keeps the caret)", () => {
    const { inDocument } = page();
    inDocument.focus();
    const session = fakeSession();
    closePreview(session, { restoreFocus: false });
    expect(session.closePreview).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(inDocument);
  });

  it("moves focus before the rail goes, so it is never dropped onto the page", () => {
    const { toggle, inRail } = page();
    inRail.focus();
    const session = fakeSession();
    session.closePreview.mockImplementation(() => {
      expect(document.activeElement).toBe(toggle);
    });
    closePreview(session, { restoreFocus: true });
    expect(session.closePreview).toHaveBeenCalled();
  });
});

describe("focusPreviewToggle", () => {
  it("does nothing when the toggle isn't on the page (a tab without a preview)", () => {
    expect(() => focusPreviewToggle()).not.toThrow();
  });
});
