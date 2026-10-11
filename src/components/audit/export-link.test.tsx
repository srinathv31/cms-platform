// @vitest-environment happy-dom
// The Audit page's Export link (handoff review A3): a click fetches the file and saves it, and a refusal
// (`{ ok: false, code, reason }`) is shown as its sentence in a toast instead of being saved as a file.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ error: vi.fn() }));
const files = vi.hoisted(() => ({ saveAuditFile: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("./export-audit", async (original) => ({ ...(await original<typeof import("./export-audit")>()), saveAuditFile: files.saveAuditFile }));

const { ExportLink } = await import("./export-link");

const HREF = "/all/audit/export?person=riley";
let root: Root;
let container: HTMLElement;
const link = () => container.querySelector<HTMLAnchorElement>("a")!;
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

function answer(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  toast.error.mockReset();
  files.saveAuditFile.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ExportLink href={HREF} label="Export 3 events" />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("ExportLink", () => {
  it("is still a download link to the filtered export", () => {
    expect(link().getAttribute("href")).toBe(HREF);
    expect(link().hasAttribute("download")).toBe(true);
    expect(link().textContent).toBe("Export 3 events");
  });

  it("saves the file on a click, and shows no error", async () => {
    const fetchMock = answer(
      new Response("When,Who\r\n", { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="stencil-audit-all-2026-10-04.csv"' } }),
    );
    await act(async () => link().click());
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(HREF, { cache: "no-store" });
    expect(files.saveAuditFile).toHaveBeenCalledTimes(1);
    expect(files.saveAuditFile.mock.calls[0]![1]).toBe("stencil-audit-all-2026-10-04.csv");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows the refusal's sentence, and saves nothing, when the server refuses", async () => {
    answer(
      new Response(JSON.stringify({ ok: false, code: "generic", reason: "You don't have access to do this." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await act(async () => link().click());
    await settle();

    expect(toast.error).toHaveBeenCalledWith("You don't have access to do this.");
    expect(files.saveAuditFile).not.toHaveBeenCalled();
  });

  it("says so in its own words when there is no usable answer", async () => {
    answer(new Response("<html>Bad gateway</html>", { status: 502 }));
    await act(async () => link().click());
    await settle();

    expect(toast.error).toHaveBeenCalledWith("Couldn't export the audit log. Try again.");
    expect(files.saveAuditFile).not.toHaveBeenCalled();
  });

  it("leaves a click that opens it elsewhere (a modifier key) to the link", async () => {
    const fetchMock = answer(new Response("x"));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
    await act(async () => void link().dispatchEvent(click));
    await settle();

    expect(click.defaultPrevented).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
