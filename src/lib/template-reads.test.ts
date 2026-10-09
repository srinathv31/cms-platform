import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTemplate, templateReadUrl } from "./template-reads";

// The browser's side of the template reads: which URL each one GETs, and what comes back.

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("templateReadUrl", () => {
  it("names the template's read, with its query", () => {
    expect(templateReadUrl("UC-4F7K2Q", "submit-summary")).toBe("/api/templates/UC-4F7K2Q/submit-summary");
    expect(templateReadUrl("UC-4F7K2Q", "compare", { from: "v_1", to: "v_2" })).toBe("/api/templates/UC-4F7K2Q/compare?from=v_1&to=v_2");
    expect(templateReadUrl("UC 4F/7K", "base-version", { draft: "v_a&b" })).toBe("/api/templates/UC%204F%2F7K/base-version?draft=v_a%26b");
  });
});

describe("readTemplate", () => {
  it("GETs the read, uncached, and hands back its data", async () => {
    fetchMock.mockResolvedValue(json({ ok: true, prompt: { text: "Help me write", includesDraft: true } }));
    expect(await readTemplate("UC-4F7K2Q", "copilot-prompt")).toEqual({ ok: true, prompt: { text: "Help me write", includesDraft: true } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/templates/UC-4F7K2Q/copilot-prompt");
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.cache).toBe("no-store");
  });

  it("hands back a refusal's reason, whatever its status", async () => {
    fetchMock.mockResolvedValue(json({ ok: false, code: "no_draft_to_revert", reason: "There is no draft to revert." }, 409));
    expect(await readTemplate("UC-4F7K2Q", "base-version", { draft: "v_1" })).toEqual({ ok: false, code: "no_draft_to_revert", reason: "There is no draft to revert." });
  });

  it("throws when the answer isn't a result: an error page, or JSON of another shape", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Internal Server Error</html>", { status: 500 }));
    await expect(readTemplate("UC-4F7K2Q", "integration")).rejects.toThrow();
    fetchMock.mockResolvedValue(json({ error: "not_found" }, 404));
    await expect(readTemplate("UC-4F7K2Q", "integration")).rejects.toThrow(/answered 404/);
  });

  it("throws when the request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(readTemplate("UC-4F7K2Q", "submit-summary")).rejects.toThrow("Failed to fetch");
  });
});
