import { beforeEach, describe, expect, it, vi } from "vitest";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { refusal } from "@/server/services/results";
import {
  expectOnlyGet,
  getRead,
  readAnswer,
} from "@/server/testing/read-routes";
import * as route from "./route";

// GET /api/templates/{templateId}/base-version, Revert to vN, as the BFF serves it: the request context, the
// draft the query names handed to the versions service as it came, and the service's answer as HTTP. What the
// service decides (who may revert, which draft, each status) is the contract suite's
// (services/contract/versions.ts); this checks what the route adds: the 401 for nobody signed in, the status and
// body of an answer, and that none is cached.

const env = vi.hoisted(() => ({
  signedIn: true,
  answer: undefined as unknown,
  asked: [] as unknown[],
}));
vi.mock("@/server/context/request", () => ({
  requestContextOrRefusal: async () =>
    env.signedIn
      ? {
          ok: true,
          context: {
            viewer: { userId: "maya" },
            correlationId: "req_test",
            credential: { kind: "in_process", userId: "maya" },
          },
        }
      : {
          ok: false,
          code: "signed_out",
          reason: "You're signed out.",
        },
}));
vi.mock("@/server/services", () => ({
  services: () => ({
    versions: {
      baseVersion: async (ctx: unknown, input: unknown) => {
        env.asked.push({ ctx, input });
        return env.answer;
      },
    },
  }),
}));

const BASE = {
  number: 1,
  round: 1,
  state: "changes_requested",
  name: "Annual Fee Waiver — Terms",
  body: { type: "doc", content: [] },
  variables: [],
  channels: ["web"],
  sampleSets: [],
  "email.subject": null,
};

beforeEach(() => {
  env.signedIn = true;
  env.asked = [];
  env.answer = { ok: true, base: BASE };
});

const baseVersion = route.GET;

describe("GET /api/templates/[templateId]/base-version", () => {
  it("200 with the base the service read, for the draft the query named", async () => {
    const { status, body } = await readAnswer(
      getRead(baseVersion, "base-version", "UC-ABC123", "?draft=v_draft"),
    );
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, base: BASE });
    expect(env.asked).toEqual([
      {
        ctx: expect.objectContaining({ viewer: { userId: "maya" } }),
        input: { templateId: "UC-ABC123", versionId: "v_draft" },
      },
    ]);
  });

  it("hands a missing draft on as null, for the service to refuse", async () => {
    await readAnswer(getRead(baseVersion, "base-version", "UC-ABC123"));
    expect(env.asked).toEqual([
      expect.objectContaining({
        input: { templateId: "UC-ABC123", versionId: null },
      }),
    ]);
  });

  it("answers a refusal with its status and { ok: false, code, reason }", async () => {
    for (const answer of [
      refusal(400, REQUEST_REFUSALS.templateUnavailable),
      refusal(403, REASONS.generic),
      refusal(404, REQUEST_REFUSALS.noDraftToRevert),
      refusal(409, REQUEST_REFUSALS.noBaseVersion),
    ]) {
      env.answer = answer;
      expect(
        await readAnswer(
          getRead(baseVersion, "base-version", "UC-ABC123", "?draft=v_1"),
        ),
      ).toEqual({
        status: answer.status,
        body: { ok: false, code: answer.code, reason: answer.reason },
      });
    }
  });

  it("401 signed_out when nobody is signed in, without asking the service", async () => {
    env.signedIn = false;
    expect(
      await readAnswer(
        getRead(baseVersion, "base-version", "UC-ABC123", "?draft=v_1"),
      ),
    ).toEqual({
      status: 401,
      body: {
        ok: false,
        code: REQUEST_REFUSALS.signedOut.code,
        reason: REQUEST_REFUSALS.signedOut.reason,
      },
    });
    expect(env.asked).toEqual([]);
  });

  it("is a GET handler and nothing else", async () => {
    await expectOnlyGet(route);
  });
});
