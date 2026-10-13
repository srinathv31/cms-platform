import { beforeEach, describe, expect, it, vi } from "vitest";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { JSONContent, Viewer } from "@/domain/types";
import { findRequestContext } from "@/server/context/request";
import type { RequestContext } from "@/server/context/request";
import type { CopilotFacts } from "@/server/services/templates";
import {
  expectOnlyGet,
  getRead,
  readAnswer,
} from "@/server/testing/read-routes";
import * as route from "./route";

// GET /api/templates/{templateId}/copilot-prompt, the Copilot prompt, as the BFF runs it, on facts: HTTP in, the
// route and `getCopilotPrompt` for real, HTTP out. The backend (`templates.copilotPrompt`) is stood in for by the
// answers below, so these tests check only what the BFF adds: who is asking (before anything is parsed), the parse,
// the request it hands the backend, the prompt it words from the draft's facts, and the refusals it passes through
// with their status and `{ ok: false, code, reason }`; no answer may be cached. Who may edit the draft, which
// template has an open draft and which is an alert are the backend's, and the contract suite's.
//
// Facts used: Maya is signed in. Annual Fee Waiver (Coral Offers) is a disclosure with an open draft that has text.

const copilotPrompt = vi.hoisted(() => vi.fn());
vi.mock("@/server/services", () => ({
  services: () => ({ templates: { copilotPrompt } }),
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

const TEMPLATE = "UC-4F7K2Q";
const maya: RequestContext = {
  viewer: { userId: "maya" } as Viewer,
  correlationId: "req_test",
  credential: { kind: "in_process", userId: "maya" },
};

const text = (value: string): JSONContent => ({ type: "text", text: value });
const body: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { id: "h-offer", level: 2, requiredKey: "offer_details" },
      content: [text("Offer details")],
    },
    {
      type: "paragraph",
      content: [text("The annual fee is waived for the first year.")],
    },
  ],
};

const facts: CopilotFacts = {
  templateName: "Annual Fee Waiver — Terms",
  teamName: "Coral Offers",
  contentTypeName: "Disclosure",
  channels: ["pdf", "web"],
  requiredSections: [{ key: "offer_details", title: "Offer details" }],
  variables: [],
  body,
};

beforeEach(() => {
  copilotPrompt.mockReset().mockResolvedValue({ ok: true, ...facts });
  vi.mocked(findRequestContext).mockReset().mockResolvedValue(maya);
});

const get = (templateId = TEMPLATE) =>
  getRead(route.GET, "copilot-prompt", templateId);

describe("GET /api/templates/[templateId]/copilot-prompt", () => {
  it("200 with the prompt built from the saved draft's facts", async () => {
    const { status, body } = await readAnswer(get());
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      prompt: {
        includesDraft: true,
        text: expect.stringContaining("Coral Offers"),
      },
    });
    const { text } = body.prompt as { text: string };
    expect(text).toContain("Template: Annual Fee Waiver — Terms");
    expect(text).toContain("## Offer details");
    expect(text).toContain("The annual fee is waived for the first year.");
  });

  it("asks the backend for the template, as the person asking", async () => {
    await get();
    expect(copilotPrompt).toHaveBeenCalledExactlyOnceWith(maya, {
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
    expect(copilotPrompt).not.toHaveBeenCalled();
  });

  it("400 template_unavailable for an id that doesn't parse, without asking the backend", async () => {
    expect(await readAnswer(get("U".repeat(65)))).toEqual({
      status: 400,
      body: {
        ok: false,
        code: "template_unavailable",
        reason: "This template isn't available.",
      },
    });
    expect(copilotPrompt).not.toHaveBeenCalled();
  });

  it.each([
    [403, "generic", REASONS.generic],
    [404, "template_unavailable", REQUEST_REFUSALS.templateUnavailable],
    [409, "no_draft_to_write", REQUEST_REFUSALS.noDraftToWrite],
    [409, "copilot_documents_only", REQUEST_REFUSALS.copilotDocumentsOnly],
  ] as const)(
    "%i %s: the backend's refusal, with its status, code and sentence",
    async (status, code, refusal) => {
      copilotPrompt.mockResolvedValue({ ok: false, status, ...refusal });
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
