import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// GET /sim/templates/search: the HTTP side of Coral's template search. What the search finds, and what it
// refuses, is covered in src/simulator/actions.test.ts (`searchSimTemplates`); this file covers the route.

const search = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));
vi.mock("@/simulator/queries", () => ({ searchSimTemplates: search }));

const get = (query = "") => GET(new Request(`http://localhost/sim/templates/search${query}`));

beforeEach(() => search.mockReset());

describe("GET /sim/templates/search", () => {
  it("passes q to the search and answers its results, never cached", async () => {
    search.mockResolvedValue({ ok: true, results: [{ id: "UC-TEST01" }] });
    const res = await get("?q=spring%20travel");
    expect(search).toHaveBeenCalledWith("spring travel");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.json()).toEqual({ ok: true, results: [{ id: "UC-TEST01" }] });
  });

  it("asks for every template without a q", async () => {
    search.mockResolvedValue({ ok: true, results: [] });
    await get();
    expect(search).toHaveBeenCalledWith(null);
  });

  it("answers a refusal with its status and only its sentence", async () => {
    search.mockResolvedValue({ ok: false, reason: "Search for a template name or ID.", status: 400 });
    const res = await get(`?q=${"x".repeat(201)}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "Search for a template name or ID." });

    search.mockResolvedValue({ ok: false, reason: "Stencil couldn't be reached.", status: 502 });
    expect((await get("?q=a")).status).toBe(502);
  });
});

describe("the route is a read, not an action", () => {
  it("answers GET only", async () => {
    const route = await import("./route");
    expect(Object.keys(route)).toEqual(["GET"]);
  });
});
