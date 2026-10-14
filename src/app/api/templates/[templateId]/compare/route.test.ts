import { beforeEach, describe, expect, it, vi } from "vitest";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { refusal } from "@/server/services/results";
import type { ComparePairFacts } from "@/server/services/versions";
import {
  expectOnlyGet,
  getRead,
  readAnswer,
} from "@/server/testing/read-routes";
import * as route from "./route";

// GET /api/templates/{templateId}/compare, as the BFF serves it: the request context, the query handed to the
// versions service as it came, and the service's answer as HTTP. What the service decides (who may compare, which
// ids are the template's, each status) is the contract suite's (services/contract/versions.ts); this checks what
// the route adds: the 401 for nobody signed in, the status and body of an answer, and that none is cached.

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
      compare: async (ctx: unknown, input: unknown) => {
        env.asked.push({ ctx, input });
        return env.answer;
      },
    },
  }),
}));

const side = (id: string, number: number | null) => ({
  id,
  number,
  round: number === null ? null : 1,
  state: number === null ? ("draft" as const) : ("active" as const),
  name: "Cash Back Welcome Bonus — Terms",
  body: { type: "doc", content: [] },
  channels: ["web" as const],
  channelFields: {},
  smsFooter: null,
  variables: [],
});
const PAIR: ComparePairFacts = {
  family: "document",
  from: side("v_1", 1),
  to: side("v_draft", null),
};

beforeEach(() => {
  env.signedIn = true;
  env.asked = [];
  env.answer = { ok: true, ...PAIR };
});

const compare = route.GET;

describe("GET /api/templates/[templateId]/compare", () => {
  it("200 with the pair the service read, from the ids the query named", async () => {
    const { status, body } = await readAnswer(
      getRead(compare, "compare", "UC-ABC123", "?from=v_1&to=v_draft"),
    );
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, ...PAIR });
    expect(env.asked).toEqual([
      {
        ctx: expect.objectContaining({ viewer: { userId: "maya" } }),
        input: { templateId: "UC-ABC123", from: "v_1", to: "v_draft" },
      },
    ]);
  });

  it("hands a missing id on as null, for the service to refuse", async () => {
    await readAnswer(getRead(compare, "compare", "UC-ABC123", "?from=v_1"));
    expect(env.asked).toEqual([
      expect.objectContaining({
        input: { templateId: "UC-ABC123", from: "v_1", to: null },
      }),
    ]);
  });

  it("answers a refusal with its status and { ok: false, code, reason }", async () => {
    for (const answer of [
      refusal(400, REQUEST_REFUSALS.templateUnavailable),
      refusal(403, REQUEST_REFUSALS.templateUnavailable),
      refusal(404, REQUEST_REFUSALS.versionUnavailable),
    ]) {
      env.answer = answer;
      expect(
        await readAnswer(
          getRead(compare, "compare", "UC-ABC123", "?from=v_1&to=v_2"),
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
        getRead(compare, "compare", "UC-ABC123", "?from=v_1&to=v_2"),
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
