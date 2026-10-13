import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESPONSE_FORMATS } from "@/domain/golive/samples";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Variable } from "@/domain/types";
import type { RequestContext } from "@/server/context/request";
import type { IntegrationFacts } from "@/server/services/templates";
import { integrationPanel, loadIntegrationPanel } from "./integration";

// The SHARE panel as the BFF builds it: facts in (IntegrationFacts, what the templates service answers), the
// worded panel out. `integrationPanel` is pure, so its tests hand it facts directly; what the service decides
// (the Active version, the channels it still allows, the consumer the examples name, each older version's sunset,
// who may read the details) is the contract suite's. `loadIntegrationPanel` is checked for what it adds: the
// parse, the refusals passed through, and the origin the examples call, read from the request's headers.
// Balance Transfer Intro: v2 Active (pdf, web), v1 Superseded with a sunset, and v2 adds an optional variable.

const env = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
  integration: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(env.headers),
}));
vi.mock("@/server/services", () => ({
  services: () => ({ templates: { integration: env.integration } }),
}));

const TEMPLATE = "UC-4F7K2Q";
const ORIGIN = "http://localhost:3001";
const ASOF = "2026-10-04T12:00:00.000Z";
const maya: RequestContext = {
  viewer: { userId: "maya" } as RequestContext["viewer"],
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
const lastName: Variable = {
  key: "last_name",
  label: "Last name",
  type: "text",
  required: true,
  sample: "Chen",
};
const purchaseApr: Variable = {
  key: "purchase_apr",
  label: "Purchase APR",
  type: "percent",
  required: true,
  sample: "21.99",
};
const homeState: Variable = {
  key: "home_state",
  label: "Home state",
  type: "us_state",
  required: true,
  sample: "NJ",
};
const offerEndDate: Variable = {
  key: "offer_end_date",
  label: "Offer end date",
  type: "date",
  required: false,
  sample: "2026-11-18",
};
const annualFee: Variable = {
  key: "annual_fee",
  label: "Annual fee",
  type: "currency",
  required: true,
  sample: "95",
};

const V2 = [firstName, lastName, purchaseApr, homeState, offerEndDate];
const V1 = [firstName, lastName, purchaseApr, homeState];

/** The facts of a template whose v2 is Active, as the service answers them. */
function facts(over: Partial<IntegrationFacts> = {}): IntegrationFacts {
  return {
    asOf: ASOF,
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
      variables: V2,
    },
    sampleConsumerId: "coral",
    older: [
      {
        number: 1,
        state: "superseded",
        sunsetDay: "2026-10-25",
        sunsetPassed: false,
        variables: V1,
      },
    ],
    ...over,
  };
}

describe("integrationPanel", () => {
  it("the Active version: the template, its channels, contract rows, schema and endpoint", () => {
    const panel = integrationPanel(facts(), `${ORIGIN}/`);
    expect(panel.template).toEqual({
      id: TEMPLATE,
      name: "Balance Transfer Intro — Terms",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
    });
    expect(panel.active).toEqual({
      number: 2,
      activatedAt: "2026-09-10T12:00:00.000Z",
      channels: ["pdf", "web"],
    });
    expect(panel.contract.map((row) => row.key)).toEqual([
      "first_name",
      "last_name",
      "purchase_apr",
      "home_state",
      "offer_end_date",
    ]);
    expect(panel.contract[2]).toEqual({
      key: "purchase_apr",
      label: "Purchase APR",
      type: "percent",
      typeLabel: "Percent",
      required: true,
      example: "21.99",
    });
    expect(panel.jsonSchema.$id).toBe(
      `https://stencil.example/schemas/${TEMPLATE}/v2/values.json`,
    );
    expect(panel.jsonSchema.title).toBe(
      "Balance Transfer Intro — Terms v2: values",
    );
    expect(panel.jsonSchemaText).toBe(
      JSON.stringify(panel.jsonSchema, null, 2),
    );
    const path = `/api/v1/templates/${TEMPLATE}/render`;
    expect(panel.endpoint).toEqual({
      method: "POST",
      path,
      url: `${ORIGIN}${path}`,
    });
    expect(panel.responses).toEqual(RESPONSE_FORMATS);
    expect(panel.errors.map((e) => e.status)).toEqual(
      expect.arrayContaining([404, 410, 422]),
    );
  });

  it("drops every trailing slash of the origin", () => {
    const panel = integrationPanel(facts(), `${ORIGIN}///`);
    expect(panel.endpoint.url).toBe(
      `${ORIGIN}/api/v1/templates/${TEMPLATE}/render`,
    );
    expect(panel.samples[0]!.curl).toContain(
      `curl -X POST '${ORIGIN}/api/v1/templates/${TEMPLATE}/render'`,
    );
  });

  it("one sample per channel, in the facts' order, naming the consumer the facts name", () => {
    const panel = integrationPanel(facts(), ORIGIN);
    expect(panel.samples.map((s) => s.channel)).toEqual(["pdf", "web"]);
    expect(panel.samples[0]!.curl).toContain(
      `curl -X POST '${ORIGIN}/api/v1/templates/${TEMPLATE}/render'`,
    );
    expect(panel.samples[0]!.curl).toContain("-H 'X-Consumer-Id: coral'");
    expect(panel.samples[0]!.curl).toContain("--output");
    expect(panel.samples[1]!.curl).not.toContain("--output");
    expect(panel.samples[1]!.fetch).toContain('"channel": "web"');
    expect(panel.samples[1]!.fetch).toContain('"X-Consumer-Id": "coral"');

    const reordered = integrationPanel(
      facts({
        active: { ...facts().active, channels: ["web", "pdf"] },
        sampleConsumerId: "deposits-online",
      }),
      ORIGIN,
    );
    expect(reordered.samples.map((s) => s.channel)).toEqual(["web", "pdf"]);
    expect(reordered.samples[0]!.curl).toContain(
      "-H 'X-Consumer-Id: deposits-online'",
    );
  });

  it("a channel the facts leave out has no sample", () => {
    const panel = integrationPanel(
      facts({ active: { ...facts().active, channels: ["pdf"] } }),
      ORIGIN,
    );
    expect(panel.active.channels).toEqual(["pdf"]);
    expect(panel.samples.map((s) => s.channel)).toEqual(["pdf"]);
  });

  it("'since' has one entry per older version, with the service's sunset and the diff to the Active version", () => {
    const panel = integrationPanel(facts(), ORIGIN);
    expect(panel.since).toEqual([
      {
        number: 1,
        state: "superseded",
        sunsetDay: "2026-10-25",
        sunsetPassed: false,
        diff: {
          breaking: false,
          items: [
            {
              kind: "added",
              key: "offer_end_date",
              breaking: false,
              text: "v2 adds optional `offer_end_date` (Date).",
            },
          ],
        },
      },
    ]);
  });

  it("'since' keeps the service's order and words each version against the Active one", () => {
    const panel = integrationPanel(
      facts({
        active: {
          ...facts().active,
          number: 3,
          variables: [firstName, lastName, purchaseApr, annualFee],
        },
        older: [
          {
            number: 2,
            state: "revoked",
            sunsetDay: null,
            sunsetPassed: false,
            variables: V2,
          },
          {
            number: 1,
            state: "superseded",
            sunsetDay: "2026-09-20",
            sunsetPassed: true,
            variables: V1,
          },
        ],
      }),
      ORIGIN,
    );
    expect(
      panel.since.map((s) => [s.number, s.state, s.sunsetDay, s.sunsetPassed]),
    ).toEqual([
      [2, "revoked", null, false],
      [1, "superseded", "2026-09-20", true],
    ]);
    // Both moves to v3 add a required variable and drop `home_state`: breaking.
    expect(panel.since.map((s) => s.diff.breaking)).toEqual([true, true]);
    expect(panel.since[1]!.diff.items.map((i) => [i.kind, i.key])).toEqual(
      expect.arrayContaining([
        ["added", "annual_fee"],
        ["removed", "home_state"],
      ]),
    );
    expect(
      panel.since[1]!.diff.items.find((i) => i.key === "annual_fee")!.text,
    ).toBe("v3 adds required `annual_fee` (Currency).");
  });

  it("'since' is empty for a first version", () => {
    expect(integrationPanel(facts({ older: [] }), ORIGIN).since).toEqual([]);
  });
});

describe("loadIntegrationPanel", () => {
  beforeEach(() => {
    env.headers = { host: "localhost:3001" };
    env.integration.mockReset().mockResolvedValue({ ok: true, ...facts() });
  });

  it("asks the service for the template as the person asking, and answers the panel on the request's origin", async () => {
    const result = await loadIntegrationPanel(maya, { templateId: TEMPLATE });
    expect(env.integration).toHaveBeenCalledExactlyOnceWith(maya, {
      templateId: TEMPLATE,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.panel).toEqual(integrationPanel(facts(), ORIGIN));
      expect(result.panel.endpoint.url).toBe(
        `${ORIGIN}/api/v1/templates/${TEMPLATE}/render`,
      );
    }
  });

  it("trims the template id before it asks", async () => {
    await loadIntegrationPanel(maya, { templateId: `  ${TEMPLATE} ` });
    expect(env.integration.mock.calls[0]![1]).toEqual({ templateId: TEMPLATE });
  });

  it("400 template_gone for a blank or an over-long id, without asking the service", async () => {
    const gone = {
      ok: false,
      status: 400,
      ...REQUEST_REFUSALS.templateGone,
    };
    expect(await loadIntegrationPanel(maya, { templateId: "" })).toEqual(gone);
    expect(await loadIntegrationPanel(maya, { templateId: "  " })).toEqual(
      gone,
    );
    expect(
      await loadIntegrationPanel(maya, { templateId: "U".repeat(65) }),
    ).toEqual(gone);
    expect(env.integration).not.toHaveBeenCalled();
  });

  it.each([
    [
      "403, the permission's refusal",
      { ok: false, status: 403, ...REASONS.generic },
    ],
    [
      "404 template_gone",
      { ok: false, status: 404, ...REQUEST_REFUSALS.templateGone },
    ],
    [
      "409 no_active_version",
      { ok: false, status: 409, ...REQUEST_REFUSALS.noActiveVersion },
    ],
  ])(
    "passes the service's refusal through unchanged: %s",
    async (_, refusal) => {
      env.integration.mockResolvedValue(refusal);
      expect(await loadIntegrationPanel(maya, { templateId: TEMPLATE })).toBe(
        refusal,
      );
    },
  );

  describe("the origin of the examples", () => {
    const urlWith = async (headers: Record<string, string>) => {
      env.headers = headers;
      const result = await loadIntegrationPanel(maya, { templateId: TEMPLATE });
      return result.ok ? result.panel.endpoint.url : undefined;
    };
    const path = `/api/v1/templates/${TEMPLATE}/render`;

    it("a local host is plain http", async () => {
      expect(await urlWith({ host: "localhost:3001" })).toBe(
        `http://localhost:3001${path}`,
      );
      expect(await urlWith({ host: "127.0.0.1:3000" })).toBe(
        `http://127.0.0.1:3000${path}`,
      );
      expect(await urlWith({ host: "localhost" })).toBe(
        `http://localhost${path}`,
      );
    });

    it("a public host defaults to https", async () => {
      expect(await urlWith({ host: "ucomp.example" })).toBe(
        `https://ucomp.example${path}`,
      );
    });

    it("the forwarded protocol wins over the host's default", async () => {
      expect(
        await urlWith({ host: "ucomp.example", "x-forwarded-proto": "http" }),
      ).toBe(`http://ucomp.example${path}`);
      expect(
        await urlWith({
          host: "localhost:3000",
          "x-forwarded-proto": "https, http",
        }),
      ).toBe(`https://localhost:3000${path}`);
    });

    it("the first forwarded host wins over the host", async () => {
      expect(
        await urlWith({
          host: "internal:3000",
          "x-forwarded-host": "stencil.example, proxy.internal",
          "x-forwarded-proto": "https",
        }),
      ).toBe(`https://stencil.example${path}`);
    });

    it("with no host at all, it is the dev server's", async () => {
      expect(await urlWith({})).toBe(`http://localhost:3000${path}`);
    });
  });
});
