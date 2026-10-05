import { afterEach, describe, expect, it, vi } from "vitest";
import { filenameOf, renderPreview, UNREACHABLE } from "./render-preview";

const request = { templateId: "UC-4F7K2Q", version: "draft" as const, channel: "pdf" as const, values: { first_name: "Maya" } };

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function respondWith(response: Response) {
  fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderPreview", () => {
  it("posts the version, channel, values and the preview flag to the template's render route", async () => {
    respondWith(new Response("<html></html>", { status: 200 }));
    await renderPreview({ ...request, channel: "web" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/templates/UC-4F7K2Q/render");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      version: "draft",
      channel: "web",
      values: { first_name: "Maya" },
      preview: true,
    });
  });

  it("asks for a numbered version by its number", async () => {
    respondWith(new Response("<html></html>", { status: 200 }));
    await renderPreview({ ...request, version: 2, channel: "web" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).version).toBe(2);
  });

  it("returns a PDF as its exact bytes with the file name the route gave it", async () => {
    respondWith(
      new Response(new Uint8Array([37, 80, 68, 70, 45]), {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="UC-4F7K2Q-draft.pdf"' },
      }),
    );
    const result = await renderPreview(request);
    expect(result).toEqual({ kind: "pdf", bytes: new Uint8Array([37, 80, 68, 70, 45]), filename: "UC-4F7K2Q-draft.pdf" });
  });

  it("returns Web as its HTML", async () => {
    respondWith(new Response("<!doctype html><p>Hi</p>", { status: 200, headers: { "Content-Type": "text/html" } }));
    expect(await renderPreview({ ...request, channel: "web" })).toEqual({ kind: "web", html: "<!doctype html><p>Hi</p>" });
  });

  it("returns Email as subject, preheader, html and text", async () => {
    const body = { subject: "Hi Maya", preheader: "Your offer", html: "<p>Hi</p>", text: "Hi", newerVersion: null };
    respondWith(Response.json(body));
    expect(await renderPreview({ ...request, channel: "email" })).toEqual({
      kind: "email",
      subject: "Hi Maya",
      preheader: "Your offer",
      html: "<p>Hi</p>",
      text: "Hi",
    });
  });

  it("returns the route's error as it came, message and all", async () => {
    const error = { code: "missing_variables", message: "Missing required variables: first_name.", details: { missing: ["first_name"], invalid: [] } };
    respondWith(Response.json({ error }, { status: 422 }));
    expect(await renderPreview(request)).toEqual({ kind: "error", error });
  });

  it("reads an error even when the channel is Email or Web", async () => {
    const error = { code: "channel_not_enabled", message: "Version 2 doesn't render to Email. Its channels are PDF and Web." };
    respondWith(Response.json({ error }, { status: 422 }));
    expect(await renderPreview({ ...request, channel: "email" })).toEqual({ kind: "error", error });
  });

  it("turns a reply that isn't the route's error shape into a plain failure", async () => {
    respondWith(new Response("<h1>Bad gateway</h1>", { status: 502 }));
    const result = await renderPreview(request);
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.error.code).toBe("render_failed");
  });

  it("explains a request that never got an answer", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await renderPreview(request)).toEqual({ kind: "error", error: UNREACHABLE });
  });

  it("rejects when it is aborted, so a replaced render can be dropped", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );
    const pending = renderPreview({ ...request, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("filenameOf", () => {
  const withHeader = (value: string | null) => new Response(null, value === null ? {} : { headers: { "Content-Disposition": value } });

  it("reads a quoted name", () => {
    expect(filenameOf(withHeader('inline; filename="UC-4F7K2Q-v2.pdf"'), "UC-4F7K2Q")).toBe("UC-4F7K2Q-v2.pdf");
  });

  it("reads a bare name", () => {
    expect(filenameOf(withHeader("attachment; filename=UC-4F7K2Q-v2.pdf; size=10"), "UC-4F7K2Q")).toBe("UC-4F7K2Q-v2.pdf");
  });

  it("falls back to the template id", () => {
    expect(filenameOf(withHeader(null), "UC-4F7K2Q")).toBe("UC-4F7K2Q.pdf");
    expect(filenameOf(withHeader("inline"), "UC-4F7K2Q")).toBe("UC-4F7K2Q.pdf");
  });
});
