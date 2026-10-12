import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// GET /sim/deliveries/{deliveryId}/view: the HTTP side of the customer view. What the view holds for each
// channel is covered in src/simulator/actions.test.ts (`readSimDeliveryView`); this file covers the route.

const read = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));
vi.mock("@/simulator/queries", () => ({ readSimDeliveryView: read }));

const get = (deliveryId: string) =>
  GET(new Request(`http://localhost/sim/deliveries/${deliveryId}/view`), {
    params: Promise.resolve({ deliveryId }),
  } as Parameters<typeof GET>[1]);

beforeEach(() => read.mockReset());

describe("GET /sim/deliveries/[deliveryId]/view", () => {
  it("reads the delivery in the path and answers its view, never cached", async () => {
    read.mockResolvedValue({ ok: true, view: { id: "dlv_1", channel: "web" } });
    const res = await get("dlv_1");
    expect(read).toHaveBeenCalledWith("dlv_1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      ok: true,
      view: { id: "dlv_1", channel: "web" },
    });
  });

  it("answers 404 with only the sentence when there is no such delivery", async () => {
    read.mockResolvedValue({
      ok: false,
      reason: "That delivery doesn't exist.",
      status: 404,
    });
    const res = await get("dlv_nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      ok: false,
      reason: "That delivery doesn't exist.",
    });
  });

  it("answers GET only", async () => {
    const route = await import("./route");
    expect(Object.keys(route)).toEqual(["GET"]);
  });
});
