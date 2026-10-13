import { describe, expect, it, vi } from "vitest";
import type { SubmitFacts } from "@/domain/submit-types";
import type { Variable } from "@/domain/types";
import { submitSummaryOf } from "@/server/queries/submit-summary";
import { services } from "@/server/services";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import {
  expectOnlyGet,
  getRead,
  readAnswer,
} from "@/server/testing/read-routes";
import * as route from "./route";

// GET /api/templates/{templateId}/submit-summary, the submit dialog: what submit will freeze. The route and its read
// model run as they do in the app, against the in-memory fake (decision 0068): what they add to the service is the
// parse, the 401, the refusal's status, and the dialog's layout of the facts (`submitSummaryOf`). Who may read it
// and what it holds is the contract suite's (src/server/services/contract/review.ts). A refusal is answered with
// its status and `{ ok: false, code, reason }`, and no answer may be cached.
//
// Seed facts used: Annual Fee Waiver (Coral Offers) has v1 Changes requested and an open draft started from it;
// Cash Back has v3 In review. Maya is an Author on Coral Offers, Sam a Viewer there.

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: "localhost:3000" })),
}));

const backend = fakeBackendPerTest({
  base: new Date("2026-10-04T12:00:00.000Z"),
});

const submitSummary = route.GET;

describe("GET /api/templates/[templateId]/submit-summary", () => {
  it("200 with what submit will freeze: the draft's rev and name among it", async () => {
    const fee = backend.templates["annual-fee-waiver"]!;
    const ctx = backend.as("maya");
    const facts = await services().review.submitSummary(ctx, {
      templateId: fee,
    });
    if (!facts.ok) throw new Error(facts.code);
    const { status, body } = await readAnswer(
      getRead(submitSummary, "submit-summary", fee),
    );
    expect(status).toBe(200);
    // v1 was sent back: its draft resubmits as v1, round 2.
    expect(body).toEqual({ ok: true, summary: submitSummaryOf(facts) });
    expect(body).toMatchObject({
      summary: { templateId: fee, rev: facts.rev, number: 1, round: 2 },
    });
  });

  it("400 for a malformed template id", async () => {
    backend.as("maya");
    expect(
      await readAnswer(
        getRead(submitSummary, "submit-summary", "U".repeat(65)),
      ),
    ).toEqual({
      status: 400,
      body: {
        ok: false,
        code: "template_unavailable",
        reason: "This template isn't available.",
      },
    });
  });

  it("401 when nobody is signed in", async () => {
    backend.signOut();
    expect(
      await readAnswer(
        getRead(
          submitSummary,
          "submit-summary",
          backend.templates["annual-fee-waiver"]!,
        ),
      ),
    ).toMatchObject({ status: 401, body: { ok: false, code: "signed_out" } });
  });

  it("answers the service's refusals with their status: 403 for someone who may not submit, 404, 409", async () => {
    backend.as("sam");
    expect(
      (
        await readAnswer(
          getRead(
            submitSummary,
            "submit-summary",
            backend.templates["annual-fee-waiver"]!,
          ),
        )
      ).status,
    ).toBe(403);
    backend.as("maya");
    expect(
      (await readAnswer(getRead(submitSummary, "submit-summary", "UC-ZZZZZZ")))
        .status,
    ).toBe(404);
    expect(
      await readAnswer(
        getRead(
          submitSummary,
          "submit-summary",
          backend.templates["cash-back"]!,
        ),
      ),
    ).toEqual({
      status: 409,
      body: {
        ok: false,
        code: "already_in_review",
        reason: "This version is already in review.",
      },
    });
  });

  it("is a GET handler and nothing else", async () => {
    await expectOnlyGet(route);
  });
});

describe("submitSummaryOf", () => {
  const fee: Variable = {
    key: "annual_fee",
    label: "Annual fee",
    type: "currency",
    required: true,
    sample: "95.00",
  };
  const facts: SubmitFacts = {
    asOf: "2026-10-04T12:00:00.000Z",
    templateId: "UC-TEST01",
    rev: 7,
    number: 2,
    round: 1,
    name: "Spring Travel Rewards — Terms",
    channels: ["web", "email", "pdf"],
    variables: [fee],
    sampleSets: [
      { id: "set_custom", name: "Gold card holder", values: {} },
      { id: "long", name: "Long", values: { annual_fee: "1234.56" } },
    ],
    baseline: { number: 1, name: "Spring Rewards — Terms", variables: [] },
  };

  it("lays the facts out for the dialog: the channels in their order, the sample sets after the generated defaults", () => {
    expect(submitSummaryOf(facts)).toEqual({
      templateId: "UC-TEST01",
      rev: 7,
      number: 2,
      round: 1,
      name: "Spring Travel Rewards — Terms",
      channels: ["pdf", "web", "email"],
      // A stored default keeps its own name; the missing defaults are generated, the custom sets follow.
      sampleSetNames: [
        "Typical customer",
        "Long",
        "Minimum values",
        "Gold card holder",
      ],
      variables: [fee],
      baseline: { number: 1, name: "Spring Rewards — Terms", variables: [] },
    });
  });
});
