import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deliveryViewUrl,
  readDeliveryView,
  readTemplateSearch,
  templateSearchUrl,
} from "./reads";

// The browser's side of Coral's two GET reads: the URL it asks, and an answer that is never a throw.

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => Response.json(body, { status }));

afterEach(() => vi.unstubAllGlobals());

describe("the read URLs", () => {
  it("encode what the person typed and what an id may hold", () => {
    expect(templateSearchUrl("spring & travel")).toBe(
      "/sim/templates/search?q=spring+%26+travel",
    );
    expect(templateSearchUrl("")).toBe("/sim/templates/search?q=");
    expect(deliveryViewUrl("dlv_a/b")).toBe("/sim/deliveries/dlv_a%2Fb/view");
  });
});

describe("readTemplateSearch and readDeliveryView", () => {
  it("GET the URL with no cache and return the route's answer", async () => {
    const fetch = answer({ ok: true, results: [{ id: "UC-TEST01" }] });
    vi.stubGlobal("fetch", fetch);
    expect(await readTemplateSearch("spring")).toEqual({
      ok: true,
      results: [{ id: "UC-TEST01" }],
    });
    expect(fetch).toHaveBeenCalledWith("/sim/templates/search?q=spring", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  });

  it("returns a refusal's sentence, whatever its status", async () => {
    vi.stubGlobal(
      "fetch",
      answer({ ok: false, reason: "That delivery doesn't exist." }, 404),
    );
    expect(await readDeliveryView("dlv_nope")).toEqual({
      ok: false,
      reason: "That delivery doesn't exist.",
    });
  });

  it("turns a network failure, an error page and a body that isn't an answer into a sentence to show", async () => {
    const unreachable = { ok: false, reason: "Coral couldn't be reached." };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect(await readDeliveryView("dlv_1")).toEqual(unreachable);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>Internal Server Error</html>", { status: 500 }),
      ),
    );
    expect(await readDeliveryView("dlv_1")).toEqual(unreachable);
    vi.stubGlobal("fetch", answer({ unexpected: true }, 500));
    expect(await readTemplateSearch("x")).toEqual(unreachable);
  });
});
