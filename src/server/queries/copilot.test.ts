import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCopilotPrompt } from "@/domain/copilot";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { JSONContent, RequiredSection } from "@/domain/types";
import type { RequestContext } from "@/server/context/request";
import type { CopilotFacts } from "@/server/services/templates";
import { getCopilotPrompt } from "./copilot";

// The Copilot prompt as the BFF builds it: the templates service answers the saved draft with its team and content
// type (CopilotFacts), and the prompt is worded here (`buildCopilotPrompt`, tested on its text in
// src/domain/copilot.test.ts). These tests check what the read adds: the parse, the refusals passed through, and
// that the prompt is built from the facts. Who may edit the draft, which template has an open draft and which is an
// alert are the service's, and the contract suite's.

const copilotPrompt = vi.hoisted(() => vi.fn());
vi.mock("@/server/services", () => ({
  services: () => ({ templates: { copilotPrompt } }),
}));

const TEMPLATE = "UC-4F7K2Q";
const maya: RequestContext = {
  viewer: { userId: "maya" } as RequestContext["viewer"],
  correlationId: "req_test",
  credential: { kind: "in_process", userId: "maya" },
};

const SECTIONS: RequiredSection[] = [
  { key: "offer_details", title: "Offer details" },
  { key: "rates_and_fees", title: "Rates and fees" },
  { key: "legal_notices", title: "Legal notices" },
];

const text = (value: string): JSONContent => ({ type: "text", text: value });
const heading = (title: string, requiredKey: string): JSONContent => ({
  type: "heading",
  attrs: { id: `h-${requiredKey}`, level: 2, requiredKey },
  content: [text(title)],
});
const paragraph = (value?: string): JSONContent =>
  value ? { type: "paragraph", content: [text(value)] } : { type: "paragraph" };

/** The headings only: nothing typed yet. */
const BLANK: JSONContent = {
  type: "doc",
  content: [
    heading("Offer details", "offer_details"),
    paragraph(),
    heading("Rates and fees", "rates_and_fees"),
    heading("Legal notices", "legal_notices"),
  ],
};
/** A body with the author's text under the first heading. */
const WRITTEN: JSONContent = {
  type: "doc",
  content: [
    heading("Offer details", "offer_details"),
    paragraph("Earn a $200 credit when you spend $2,000 in 3 months."),
    heading("Rates and fees", "rates_and_fees"),
    heading("Legal notices", "legal_notices"),
  ],
};

/** The draft as the service answers it: a disclosure of Coral Offers, with one variable. */
function facts(over: Partial<CopilotFacts> = {}): CopilotFacts {
  return {
    templateName: "Annual Fee Waiver — Terms",
    teamName: "Coral Offers",
    contentTypeName: "Disclosure",
    channels: ["pdf", "web"],
    requiredSections: SECTIONS,
    variables: [
      {
        key: "annual_fee",
        label: "Annual fee",
        type: "currency",
        required: true,
        sample: "95",
      },
    ],
    body: WRITTEN,
    ...over,
  };
}

beforeEach(() => {
  copilotPrompt.mockReset().mockResolvedValue({ ok: true, ...facts() });
});

describe("getCopilotPrompt", () => {
  it("asks the service for the template as the person asking, and builds the prompt from the draft's facts", async () => {
    const result = await getCopilotPrompt(maya, { templateId: TEMPLATE });
    expect(copilotPrompt).toHaveBeenCalledExactlyOnceWith(maya, {
      templateId: TEMPLATE,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.prompt).toEqual(buildCopilotPrompt(facts()));
    expect(result.prompt.text).toContain(
      "Help me write the body of a disclosure for Coral Offers.",
    );
    expect(result.prompt.text).toContain("Template: Annual Fee Waiver — Terms");
    expect(result.prompt.text).toContain(
      "## Offer details\n## Rates and fees\n## Legal notices",
    );
    expect(result.prompt.text).toContain(
      "- {{annual_fee}}: Annual fee (Currency, required)",
    );
    expect(result.prompt.includesDraft).toBe(true);
    expect(result.prompt.text).toContain("Improve this draft:");
    expect(result.prompt.text).toContain(
      "Earn a $200 credit when you spend $2,000 in 3 months.",
    );
  });

  it("asks for the body to be written when the draft has no text of its own", async () => {
    copilotPrompt.mockResolvedValue({ ok: true, ...facts({ body: BLANK }) });
    const result = await getCopilotPrompt(maya, { templateId: TEMPLATE });
    if (!result.ok) throw new Error(result.reason);
    expect(result.prompt.includesDraft).toBe(false);
    expect(result.prompt.text).toContain("Write the body now.");
    expect(result.prompt.text).not.toContain("Improve this draft:");
  });

  it("names only what the facts name: the team, the sections and the channels", async () => {
    copilotPrompt.mockResolvedValue({
      ok: true,
      ...facts({
        teamName: "Deposits",
        contentTypeName: "Rate disclosure",
        channels: ["email"],
        requiredSections: [{ key: "rates", title: "Rates" }],
        variables: [],
        body: { type: "doc", content: [paragraph()] },
      }),
    });
    const result = await getCopilotPrompt(maya, { templateId: TEMPLATE });
    if (!result.ok) throw new Error(result.reason);
    expect(result.prompt.text).toContain(
      "Help me write the body of a rate disclosure for Deposits.",
    );
    expect(result.prompt.text).toContain("Published as: email");
    expect(result.prompt.text).toContain("## Rates");
    expect(result.prompt.text).toContain("There are no placeholders yet.");
    expect(result.prompt.text).not.toContain("Offer details");
  });

  it("400 template_unavailable for a blank or an over-long id, without asking the service", async () => {
    const unavailable = {
      ok: false,
      status: 400,
      ...REQUEST_REFUSALS.templateUnavailable,
    };
    expect(await getCopilotPrompt(maya, { templateId: "" })).toEqual(
      unavailable,
    );
    expect(
      await getCopilotPrompt(maya, { templateId: "U".repeat(65) }),
    ).toEqual(unavailable);
    expect(copilotPrompt).not.toHaveBeenCalled();
  });

  it.each([
    ["403, the permission's refusal", { status: 403, ...REASONS.generic }],
    [
      "404 template_unavailable",
      { status: 404, ...REQUEST_REFUSALS.templateUnavailable },
    ],
    [
      "409 no_draft_to_write",
      { status: 409, ...REQUEST_REFUSALS.noDraftToWrite },
    ],
    [
      "409 copilot_documents_only",
      { status: 409, ...REQUEST_REFUSALS.copilotDocumentsOnly },
    ],
  ])(
    "passes the service's refusal through unchanged: %s",
    async (_, refusal) => {
      const refused = { ok: false, ...refusal };
      copilotPrompt.mockResolvedValue(refused);
      expect(await getCopilotPrompt(maya, { templateId: TEMPLATE })).toBe(
        refused,
      );
    },
  );
});
