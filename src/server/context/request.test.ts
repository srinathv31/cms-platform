import { beforeEach, describe, expect, it, vi } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { now } from "@/server/clock";
import { getViewer } from "@/server/viewer";
import {
  findRequestContext,
  requestContextOrRefusal,
  requireRequestContext,
} from "./request";

// The request context: the viewer and the instant, read once per request, and no context at all without a
// viewer (it fails closed). The persona and the clock are swapped.

const AT = new Date("2026-10-04T12:00:00.000Z");
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => AT) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

const maya: Viewer = {
  userId: "maya",
  name: "Maya Chen",
  initials: "MC",
  title: "Author",
  platformRole: null,
  memberships: [],
};

beforeEach(() => {
  vi.mocked(getViewer).mockResolvedValue(maya);
  vi.mocked(now).mockClear();
});

describe("the request context", () => {
  it("holds the viewer, the instant, a correlation id and the in-process credential", async () => {
    expect(await findRequestContext()).toEqual({
      viewer: maya,
      now: AT,
      correlationId: expect.stringMatching(/^req_[0-9a-z]{12}$/),
      credential: { kind: "in_process" },
    });
    expect(now).toHaveBeenCalledTimes(1);
  });

  describe("without a viewer", () => {
    beforeEach(() => {
      vi.mocked(getViewer).mockResolvedValue(null as unknown as Viewer);
    });

    it("is null, and reads no clock", async () => {
      expect(await findRequestContext()).toBeNull();
      expect(now).not.toHaveBeenCalled();
    });

    it("is the signed_out refusal for an action or a route", async () => {
      expect(await requestContextOrRefusal()).toEqual({
        ok: false,
        ...REQUEST_REFUSALS.signedOut,
      });
    });

    it("is the Not found page for a page", async () => {
      await expect(requireRequestContext()).rejects.toThrow(
        /NEXT_HTTP_ERROR_FALLBACK;404/,
      );
    });
  });
});
