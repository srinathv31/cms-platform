// @vitest-environment happy-dom
// The block handle loads lazily (client only). If its chunk fails to load, an editable document
// must still become editable: the live editor mounts without the handle, and the failed load is
// handled (no unhandled rejection). Vitest fails the run on an unhandled rejection, so these tests
// passing also shows none escaped.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { doc, h2, p } from "../testing/editor";
import { DocumentEditor } from "./document-editor";

vi.mock("./block-handle", () => {
  throw new Error("Loading chunk block-handle failed.");
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONTENT = doc(h2("Offer details", "offer_details"), p("Hello there"));
const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

async function mount(readOnly = false): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<DocumentEditor content={CONTENT} readOnly={readOnly} />));
  return host;
}

describe("DocumentEditor when the block handle fails to load", () => {
  it("mounts the live editor without the handle, editable", async () => {
    const host = await mount();
    await vi.waitFor(async () => {
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
      expect(host.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("true");
    });
    expect(host.textContent).toContain("Hello there");
  });

  it("a later editor (the load is retried, fails again) is editable too", async () => {
    const host = await mount();
    await vi.waitFor(async () => {
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
      expect(host.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("true");
    });
  });
});
