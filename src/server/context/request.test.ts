import { beforeEach, describe, expect, it, vi } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { getViewer } from "@/server/viewer";
import {
  findRequestContext,
  requestContextOrRefusal,
  requireRequestContext,
} from "./request";

// The request context: who is asking, read once per request, and no context at all without a viewer (it
// fails closed). The sign-in stand-in is swapped.

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
});

describe("the request context", () => {
  it("holds the viewer, a correlation id and the in-process credential, and no time", async () => {
    expect(await findRequestContext()).toEqual({
      viewer: maya,
      correlationId: expect.stringMatching(/^req_[0-9a-z]{12}$/),
      credential: { kind: "in_process", userId: "maya" },
    });
  });

  describe("without a viewer", () => {
    beforeEach(() => {
      vi.mocked(getViewer).mockResolvedValue(null);
    });

    it("is null", async () => {
      expect(await findRequestContext()).toBeNull();
    });

    it("is the signed_out refusal for an action or a route", async () => {
      expect(await requestContextOrRefusal()).toEqual({
        ok: false,
        ...REQUEST_REFUSALS.signedOut,
      });
    });

    it("sends a page to sign in, not to Not found", async () => {
      await expect(requireRequestContext()).rejects.toMatchObject({
        digest: expect.stringContaining("/sign-in"),
      });
    });
  });
});
