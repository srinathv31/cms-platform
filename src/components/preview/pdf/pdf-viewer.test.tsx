// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfViewer } from "./pdf-viewer";

// pdf.js is not under test: a controller that fails to open the bytes stands in, so the viewer shows the
// fallback it shows when pdf.js can't draw a file the route returned.
const spies = vi.hoisted(() => ({ downloadPdf: vi.fn() }));
vi.mock("./download", () => ({ downloadPdf: spies.downloadPdf }));
vi.mock("./pdf-controller", () => ({
  PdfController: class {
    constructor(private events: { failed: (error: unknown) => void }) {}
    onShown() {}
    attach() {}
    detach() {}
    register() {}
    adopt() {}
    clear() {}
    load() {
      this.events.failed(new Error("not a PDF pdf.js can open"));
    }
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
beforeEach(() => spies.downloadPdf.mockClear());
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function show(
  props: { onFallbackDownload?: () => void; data?: Uint8Array | null } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <PdfViewer
        data={props.data === undefined ? new Uint8Array([1, 2, 3]) : props.data}
        fileName="UC-4F7K2Q-v3.pdf"
        onFallbackDownload={props.onFallbackDownload}
      />,
    );
  });
  return host;
}

describe("PdfViewer's fallback", () => {
  it("says the file can't be previewed and offers it for download", async () => {
    const host = await show();
    expect(host.textContent).toContain("Preview unavailable.");
    expect(host.textContent).toContain("UC-4F7K2Q-v3.pdf");
    expect(
      [...host.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["Download PDF"]);
  });

  it("downloads the exact bytes and says so once Download PDF is pressed", async () => {
    const onFallbackDownload = vi.fn();
    const host = await show({ onFallbackDownload });
    expect(
      onFallbackDownload,
      "showing the fallback is not a download",
    ).not.toHaveBeenCalled();
    act(() => host.querySelector("button")!.click());
    expect(spies.downloadPdf).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "UC-4F7K2Q-v3.pdf",
    );
    expect(onFallbackDownload).toHaveBeenCalledTimes(1);
  });

  it("downloads without a listener too", async () => {
    const host = await show();
    act(() => host.querySelector("button")!.click());
    expect(spies.downloadPdf).toHaveBeenCalledTimes(1);
  });
});
