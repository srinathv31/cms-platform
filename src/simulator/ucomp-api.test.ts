import { afterEach, describe, expect, it, vi } from "vitest";
import { apiOrigin, createUcompApi } from "./ucomp-api";

// A forged Host / X-Forwarded-Host must never become the fetch target.
const headers = vi.hoisted(() => vi.fn(async () => new Headers({ host: "attacker.example", "x-forwarded-host": "169.254.169.254" })));
vi.mock("next/headers", () => ({ headers }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return respond(new URL(String(input)), init);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name);

describe("createUcompApi", () => {
  it("searches with X-Consumer-Id coral, no-store, and only the given params", async () => {
    const { fetch, calls } = fakeFetch(() => json({ query: "spring", asOf: "", results: [] }));
    const api = createUcompApi({ origin: "http://localhost:3001/", fetch });
    const result = await api.searchTemplates({ q: "  spring travel ", limit: 20 });
    expect(result).toEqual({ ok: true, data: { query: "spring", asOf: "", results: [] } });
    expect(calls[0].url).toBe("http://localhost:3001/api/v1/templates?q=spring+travel&limit=20");
    expect(header(calls[0], "X-Consumer-Id")).toBe("coral");
    expect(calls[0].init.cache).toBe("no-store");

    await api.searchTemplates();
    expect(calls[1].url).toBe("http://localhost:3001/api/v1/templates");
  });

  it("builds template and notice URLs", async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const api = createUcompApi({ origin: "http://x.test", fetch });
    await api.getTemplate("UC-4F7K2Q", { version: 2, since: 1 });
    await api.getTemplate("UC 1/2");
    await api.listNotices({ templateId: "UC-4F7K2Q", limit: 200 });
    await api.listNotices({ limit: 200, after: "eyJ2IjoxfQ" });
    await api.searchTemplates({ q: "rate", limit: 20, after: "eyJ2IjoxfQ" });
    expect(calls.map((c) => c.url)).toEqual([
      "http://x.test/api/v1/templates/UC-4F7K2Q?version=2&since=1",
      "http://x.test/api/v1/templates/UC%201%2F2",
      "http://x.test/api/v1/consumers/coral/notices?templateId=UC-4F7K2Q&limit=200",
      "http://x.test/api/v1/consumers/coral/notices?limit=200&after=eyJ2IjoxfQ",
      "http://x.test/api/v1/templates?q=rate&limit=20&after=eyJ2IjoxfQ",
    ]);
  });

  it("keeps the API's error verbatim, with its status", async () => {
    const message = "Spring Travel Rewards — Terms v2 stopped rendering on March 1, 2027. Use v3.";
    const { fetch } = fakeFetch(() => json({ error: { code: "version_sunset", message, details: { version: 2 } } }, 410));
    const api = createUcompApi({ origin: "http://x.test", fetch });
    expect(await api.getTemplate("UC-4F7K2Q")).toEqual({ ok: false, error: { status: 410, code: "version_sunset", message } });
    expect(await api.render("UC-4F7K2Q", { version: 2, channel: "web", values: {} }, "c1")).toEqual({
      ok: false,
      error: { status: 410, code: "version_sunset", message },
      at: expect.any(Date),
    });
  });

  it("reports a body that isn't the contract's, and an unreachable server, as errors", async () => {
    const html = fakeFetch(() => new Response("<html>oops</html>", { status: 500 }));
    expect(await createUcompApi({ origin: "http://x.test", fetch: html.fetch }).searchTemplates()).toEqual({
      ok: false,
      error: { status: 500, code: "bad_response", message: "Stencil answered 500 without an error body." },
    });

    const down = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const result = await createUcompApi({ origin: "http://x.test", fetch: down.fetch }).listNotices();
    expect(result).toEqual({ ok: false, error: { status: 0, code: "unreachable", message: "Stencil couldn't be reached (fetch failed)." } });
  });

  it("renders: pdf asks for base64, web keeps the HTML, email keeps the JSON; correlation id and newer version", async () => {
    const { fetch, calls } = fakeFetch((url, init) => {
      const body = JSON.parse(String(init.body));
      if (body.channel === "pdf") return json({ channel: "pdf", contentType: "application/pdf", encoding: "base64", data: "JVBERi0=", newerVersion: null });
      if (body.channel === "web") return new Response("<!doctype html><p>Hi</p>", { headers: { "X-Stencil-Newer-Version": "3" } });
      return json({ subject: "Your terms", preheader: "Pre", html: "<p>Hi</p>", text: "Hi", newerVersion: 3 });
    });
    const api = createUcompApi({ origin: "http://x.test", fetch });

    const pdf = await api.render("UC-4F7K2Q", { version: 2, channel: "pdf", values: { first_name: "Olivia" } }, "corr-1");
    expect(pdf).toEqual({ ok: true, data: { output: "JVBERi0=", newerVersion: null }, at: expect.any(Date) });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url).toBe("http://x.test/api/v1/templates/UC-4F7K2Q/render");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ version: 2, channel: "pdf", values: { first_name: "Olivia" }, encoding: "base64" });
    expect(header(calls[0], "X-Correlation-Id")).toBe("corr-1");
    expect(header(calls[0], "X-Consumer-Id")).toBe("coral");
    expect(header(calls[0], "Content-Type")).toBe("application/json");

    const web = await api.render("UC-4F7K2Q", { version: 2, channel: "web", values: {} }, "corr-2");
    expect(web).toEqual({ ok: true, data: { output: "<!doctype html><p>Hi</p>", newerVersion: 3 }, at: expect.any(Date) });
    expect(JSON.parse(String(calls[1].init.body))).not.toHaveProperty("encoding");

    const email = await api.render("UC-4F7K2Q", { version: 2, channel: "email", values: {} }, "corr-3");
    expect(email.ok && JSON.parse(email.data.output)).toEqual({ subject: "Your terms", preheader: "Pre", html: "<p>Hi</p>", text: "Hi" });
    expect(email.ok && email.data.newerVersion).toBe(3);
  });

  it("stamps a render with UCOMP's HTTP Date header (the demo clock), real time without one", async () => {
    const demo = "Wed, 21 Oct 2026 09:30:00 GMT";
    const dated = fakeFetch((url, init) =>
      JSON.parse(String(init.body)).version === 2
        ? new Response("<p>Hi</p>", { headers: { Date: demo } })
        : json({ error: { code: "version_sunset", message: "Gone." } }, 410, { Date: demo }),
    );
    const api = createUcompApi({ origin: "http://x.test", fetch: dated.fetch });
    expect((await api.render("UC-4F7K2Q", { version: 2, channel: "web", values: {} }, "c1")).at.toISOString()).toBe("2026-10-21T09:30:00.000Z");
    expect((await api.render("UC-4F7K2Q", { version: 1, channel: "web", values: {} }, "c2")).at.toISOString()).toBe("2026-10-21T09:30:00.000Z");

    const before = Date.now();
    const plain = fakeFetch(() => new Response("<p>Hi</p>"));
    const at = (await createUcompApi({ origin: "http://x.test", fetch: plain.fetch }).render("UC-4F7K2Q", { version: 2, channel: "web", values: {} }, "c3")).at;
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("apiOrigin", () => {
  const port = process.env.PORT;
  afterEach(() => {
    delete process.env.UCOMP_API_ORIGIN;
    if (port === undefined) delete process.env.PORT;
    else process.env.PORT = port;
  });

  it("uses UCOMP_API_ORIGIN when set, else this server on loopback at its own port; never the request's headers", async () => {
    process.env.PORT = "3100";
    expect(await apiOrigin()).toBe("http://127.0.0.1:3100");
    process.env.PORT = "3200";
    expect(await apiOrigin()).toBe("http://127.0.0.1:3200");
    delete process.env.PORT;
    expect(await apiOrigin()).toBe("http://127.0.0.1:3000");
    process.env.UCOMP_API_ORIGIN = "https://ucomp.example/";
    expect(await apiOrigin()).toBe("https://ucomp.example");
    expect(headers).not.toHaveBeenCalled();
  });
});
