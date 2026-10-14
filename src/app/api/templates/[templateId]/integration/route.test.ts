import { beforeEach, describe, expect, it, vi } from "vitest";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Variable, Viewer } from "@/domain/types";
import { findRequestContext } from "@/server/context/request";
import type { RequestContext } from "@/server/context/request";
import type { IntegrationFacts } from "@/server/services/templates";
import {
  expectOnlyGet,
  getRead,
  readAnswer,
} from "@/server/testing/read-routes";
import * as route from "./route";

// GET /api/templates/{templateId}/integration, the SHARE panel, as the BFF runs it, on facts: HTTP in, the route and
// `loadIntegrationPanel` for real, HTTP out. The backend (`templates.integration`) is stood in for by the answers
// below, so these tests check only what the BFF adds: who is asking (before anything is parsed), the parse, the
// request it hands the backend, the panel it words from the facts (on the origin the request names), and the
// refusals it passes through with their status and `{ ok: false, code, reason }`; no answer may be cached. Who may
// read the details, the Active version, its channels and the consumer the examples name are the backend's, and the
// contract suite's.
//
// Facts used: Maya is signed in. Balance Transfer Intro (Coral Offers) has v2 Active (pdf, web) and v1 Superseded.

const integration = vi.hoisted(() => vi.fn());
vi.mock("@/server/services", () => ({
  services: () => ({ templates: { integration } }),
}));
vi.mock("@/server/context/request", async () => {
  const { REQUEST_REFUSALS, refuse } = await import("@/domain/refusals");
  const findRequestContext = vi.fn();
  return {
    findRequestContext,
    requestContextOrRefusal: async () => {
      const context = await findRequestContext();
      return context
        ? { ok: true, context }
        : refuse(REQUEST_REFUSALS.signedOut);
    },
  };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
}));

const TEMPLATE = "UC-4F7K2Q";
const maya: RequestContext = {
  viewer: { userId: "maya" } as Viewer,
  correlationId: "req_test",
  credential: { kind: "in_process", userId: "maya" },
};

const firstName: Variable = {
  key: "first_name",
  label: "First name",
  type: "text",
  required: true,
  sample: "Maya",
};
const offerEndDate: Variable = {
  key: "offer_end_date",
  label: "Offer end date",
  type: "date",
  required: false,
  sample: "2026-11-18",
};

const facts: IntegrationFacts = {
  asOf: "2026-10-04T12:00:00.000Z",
  template: {
    id: TEMPLATE,
    teamSlug: "coral-offers",
    teamName: "Coral Offers",
    name: "Balance Transfer Intro — Terms",
  },
  active: {
    number: 2,
    activatedAt: "2026-09-10T12:00:00.000Z",
    channels: ["pdf", "web"],
    variables: [firstName, offerEndDate],
  },
  sampleConsumerId: "coral",
  older: [
    {
      number: 1,
      state: "superseded",
      sunsetDay: "2026-10-25",
      sunsetPassed: false,
      variables: [firstName],
    },
  ],
};

beforeEach(() => {
  integration.mockReset().mockResolvedValue({ ok: true, ...facts });
  vi.mocked(findRequestContext).mockReset().mockResolvedValue(maya);
});

const get = (templateId = TEMPLATE) =>
  getRead(route.GET, "integration", templateId);

describe("GET /api/templates/[templateId]/integration", () => {
  it("200 with the Active version's panel, worded from the facts on the request's origin", async () => {
    const { status, body } = await readAnswer(get());
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      panel: {
        template: {
          id: TEMPLATE,
          name: "Balance Transfer Intro — Terms",
          teamSlug: "coral-offers",
          teamName: "Coral Offers",
        },
        active: { number: 2, channels: ["pdf", "web"] },
        endpoint: {
          method: "POST",
          url: `http://localhost:3000/api/v1/templates/${TEMPLATE}/render`,
        },
        since: [
          {
            number: 1,
            state: "superseded",
            sunsetDay: "2026-10-25",
            sunsetPassed: false,
            diff: { breaking: false },
          },
        ],
      },
    });
    const panel = body.panel as {
      contract: { key: string }[];
      samples: { channel: string; curl: string }[];
    };
    expect(panel.contract.map((row) => row.key)).toEqual([
      "first_name",
      "offer_end_date",
    ]);
    expect(panel.samples.map((s) => s.channel)).toEqual(["pdf", "web"]);
    expect(panel.samples[0]!.curl).toContain("-H 'X-Consumer-Id: coral'");
  });

  it("asks the backend for the template, as the person asking", async () => {
    await get();
    expect(integration).toHaveBeenCalledExactlyOnceWith(maya, {
      templateId: TEMPLATE,
    });
  });

  it("401 signed_out when nobody is signed in, without asking the backend", async () => {
    vi.mocked(findRequestContext).mockResolvedValue(null);
    expect(await readAnswer(get())).toEqual({
      status: 401,
      body: {
        ok: false,
        code: "signed_out",
        reason: "Sign in to continue.",
      },
    });
    expect(integration).not.toHaveBeenCalled();
  });

  it("400 template_gone for an id that doesn't parse, without asking the backend", async () => {
    expect(await readAnswer(get("U".repeat(65)))).toEqual({
      status: 400,
      body: {
        ok: false,
        code: "template_gone",
        reason: "This template no longer exists.",
      },
    });
    expect(integration).not.toHaveBeenCalled();
  });

  it.each([
    [403, "generic", REASONS.generic],
    [404, "template_gone", REQUEST_REFUSALS.templateGone],
    [409, "no_active_version", REQUEST_REFUSALS.noActiveVersion],
  ] as const)(
    "%i: the backend's refusal, with its status, code and sentence",
    async (status, code, refusal) => {
      integration.mockResolvedValue({ ok: false, status, ...refusal });
      expect(await readAnswer(get())).toEqual({
        status,
        body: { ok: false, code, reason: refusal.reason },
      });
    },
  );

  it("is a GET handler and nothing else", async () => {
    await expectOnlyGet(route);
  });
});
