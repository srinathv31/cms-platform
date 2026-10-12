import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BODY_BYTES,
  type EmailResponseBody,
  type RenderErrorBody,
} from "@/domain/render/types";
import type { JSONContent, Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import {
  contentTypes,
  renderLog,
  templates,
  versions,
} from "@/server/db/schema/ucomp";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { POST } from "./route";

// Stencil's own preview route end to end: HTTP in, the session's person, the real pipeline and adapters
// against a temporary database filled by the real seed (a copy of its own for every test), HTTP out. Only the database handle, the demo
// clock and the persona (`getViewer`) are swapped. The same engine answers the consumer API, which
// serves consumers only (../../../v1/templates/[templateId]/render/route.test.ts).
//
// Seed facts used: Maya is an Author on Coral Offers, Eli an Author on Deposits only, Morgan has no
// team. Annual Fee Waiver (Coral Offers) has an open draft; Cash Back has v1 Superseded, v2 Active, v3
// In review; Balance Transfer has v2 Active.

const env = vi.hoisted(() => ({ now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-preview-route-");
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

let db: Db;
const ids = seededDatabasePerTest({ base: env.now });
const people: Record<string, Viewer> = {};

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

beforeEach(async () => {
  for (const id of ["maya", "eli", "morgan"])
    people[id] = await loadPersona(db, id);
  vi.mocked(getViewer).mockReset().mockResolvedValue(people.maya!);
});

const CUSTOMER = {
  first_name: "Maya",
  last_name: "Chen",
  purchase_apr: "21.99",
  home_state: "NJ",
};
const FEE = { ...CUSTOMER, annual_fee: "95" };

function post(
  template: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const templateId = ids[template] ?? template;
  const request = new Request(
    `http://localhost/api/templates/${templateId}/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
      duplex: "half",
    } as RequestInit,
  ) as NextRequest;
  return POST(request, {
    params: Promise.resolve({ templateId }),
  } as Parameters<typeof POST>[1]);
}

async function expectError(
  res: Response,
  status: number,
  code: string,
  message?: string,
) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("X-Correlation-Id")).toBeTruthy();
  const body = (await res.json()) as RenderErrorBody;
  expect(body.error.code).toBe(code);
  if (message !== undefined) expect(body.error.message).toBe(message);
  return body.error;
}

const logRows = (correlationId: string) =>
  db.select().from(renderLog).where(eq(renderLog.correlationId, correlationId));

// ── Who may preview ──────────────────────────────────────────────────────────

describe("POST /api/templates/[templateId]/preview: the session's person", () => {
  it("previews the open draft as the signed-in person, tagged in the headers and in render_log", async () => {
    const res = await post(
      "annual-fee-waiver",
      { version: "draft", channel: "pdf", values: CUSTOMER },
      { "X-Correlation-Id": "pv-draft" },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("X-Stencil-Version")).toBe("draft");
    expect(res.headers.get("X-Stencil-Preview")).toBe("true");
    expect(res.headers.get("X-Stencil-Template-Id")).toBe(
      ids["annual-fee-waiver"],
    );
    expect(res.headers.get("X-Correlation-Id")).toBe("pv-draft");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toBe(
      `inline; filename="${ids["annual-fee-waiver"]}-draft.pdf"`,
    );
    expect(
      Buffer.from(new Uint8Array(await res.arrayBuffer()).slice(0, 5)).toString(
        "latin1",
      ),
    ).toBe("%PDF-");
    expect(getViewer).toHaveBeenCalledTimes(1);
    expect(await logRows("pv-draft")).toEqual([
      expect.objectContaining({
        isPreview: true,
        consumerId: null,
        versionNumber: null,
        channel: "pdf",
        platform: null,
        outcome: "ok",
      }),
    ]);
  }, 30_000);

  it("previews a version in review, which the consumer API never serves, and says it is a preview", async () => {
    const res = await post(
      "cash-back",
      { version: 3, channel: "web", values: FEE },
      { "X-Correlation-Id": "pv-review" },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("X-Stencil-Version")).toBe("3");
    expect(res.headers.get("X-Stencil-Preview")).toBe("true");
    expect((await res.text()).startsWith("<!doctype html>")).toBe(true);
    expect(await logRows("pv-review")).toEqual([
      expect.objectContaining({
        isPreview: true,
        consumerId: null,
        versionNumber: 3,
        outcome: "ok",
      }),
    ]);
  });

  it("a Superseded version still names the Active one that replaced it", async () => {
    const res = await post("cash-back", {
      version: 1,
      channel: "web",
      values: FEE,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stencil-Newer-Version")).toBe("2");
  });

  it("is forbidden (403) for a person outside the template's team, and logged as a preview", async () => {
    for (const who of ["morgan", "eli"]) {
      vi.mocked(getViewer).mockResolvedValue(people[who]!);
      const res = await post(
        "balance-transfer",
        { version: 2, channel: "web", values: CUSTOMER },
        { "X-Correlation-Id": `pv-no-${who}` },
      );
      await expectError(
        res,
        403,
        "preview_forbidden",
        "You can't preview this template.",
      );
      expect(res.headers.get("X-Stencil-Preview")).toBeNull();
      expect(await logRows(`pv-no-${who}`)).toEqual([
        expect.objectContaining({
          isPreview: true,
          consumerId: null,
          outcome: "error",
          errorCode: "preview_forbidden",
        }),
      ]);
    }
  });

  it("takes the person from the session alone: an X-Consumer-Id header neither widens nor narrows it", async () => {
    const asConsumer = await post(
      "balance-transfer",
      { version: 2, channel: "web", values: CUSTOMER },
      { "X-Consumer-Id": "coral", "X-Correlation-Id": "pv-hdr" },
    );
    expect(asConsumer.status).toBe(200);
    expect(await logRows("pv-hdr")).toEqual([
      expect.objectContaining({ isPreview: true, consumerId: null }),
    ]);

    vi.mocked(getViewer).mockResolvedValue(people.morgan!);
    const forbidden = await post(
      "balance-transfer",
      { version: 2, channel: "web", values: CUSTOMER },
      { "X-Consumer-Id": "coral" },
    );
    await expectError(forbidden, 403, "preview_forbidden");
  });
});

// ── Rounds ───────────────────────────────────────────────────────────────────

describe("POST …/preview: rounds", () => {
  it("a preview of a round renders that round, labelled in the filename; the version header stays the number", async () => {
    const res = await post("cash-back", {
      version: 3,
      round: 1,
      channel: "pdf",
      values: FEE,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stencil-Version")).toBe("3");
    expect(res.headers.get("Content-Disposition")).toBe(
      `inline; filename="${ids["cash-back"]}-v3-round-1.pdf"`,
    );
  }, 30_000);

  it("a round must be a whole number from 1", async () => {
    for (const round of [0, "1", 1.5, null]) {
      const res = await post("cash-back", {
        version: 3,
        round,
        channel: "web",
        values: FEE,
      });
      await expectError(
        res,
        400,
        "bad_request",
        "round must be a whole number from 1.",
      );
    }
  });
});

// ── Bodies and errors, as the consumer API gives them ────────────────────────

describe("POST …/preview: bodies and errors", () => {
  it("email: JSON with subject, preheader, html, text and the newer-version flag", async () => {
    const res = await post("rate-change-notice", {
      version: 1,
      channel: "email",
      values: { ...CUSTOMER, effective_date: "3/4/2027" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EmailResponseBody;
    expect(Object.keys(body).sort()).toEqual([
      "html",
      "newerVersion",
      "preheader",
      "subject",
      "text",
    ]);
    expect(body.subject).toBe("Your purchase APR is changing on March 4, 2027");
  });

  it("base64 wraps the web document in JSON, as the consumer API does", async () => {
    const res = await post("balance-transfer", {
      version: 2,
      channel: "web",
      values: CUSTOMER,
      encoding: "base64",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { encoding: string; data: string };
    expect(body.encoding).toBe("base64");
    expect(
      Buffer.from(body.data, "base64")
        .toString("utf8")
        .startsWith("<!doctype html>"),
    ).toBe(true);
  });

  it("an error is `{ error: { code, message, details } }` with the engine's status, and the values never echo", async () => {
    const missing = await post("balance-transfer", {
      version: 2,
      channel: "web",
      values: {},
    });
    const error = await expectError(missing, 422, "missing_variables");
    expect(error.details).toMatchObject({
      missing: expect.arrayContaining(["first_name"]),
    });

    const wrong = await post("balance-transfer", {
      version: 2,
      channel: "web",
      values: { ...CUSTOMER, purchase_apr: "not-a-number" },
    });
    const invalid = await expectError(wrong, 422, "invalid_values");
    expect(JSON.stringify(invalid)).not.toContain("not-a-number");
  });

  it("a channel the version hasn't turned on is 422, a version or template that isn't there is 404 and isn't logged", async () => {
    await expectError(
      await post("balance-transfer", {
        version: 2,
        channel: "email",
        values: CUSTOMER,
      }),
      422,
      "channel_not_enabled",
    );
    await expectError(
      await post(
        "balance-transfer",
        { version: 99, channel: "web", values: CUSTOMER },
        { "X-Correlation-Id": "pv-none" },
      ),
      404,
      "version_not_found",
    );
    await expectError(
      await post(
        "UC-ZZZZZZ",
        { version: 1, channel: "web", values: CUSTOMER },
        { "X-Correlation-Id": "pv-none-2" },
      ),
      404,
      "template_not_found",
    );
    expect(await logRows("pv-none")).toEqual([]);
    expect(await logRows("pv-none-2")).toEqual([]);
  });

  it("a draft of a template with no open draft is 404", async () => {
    await expectError(
      await post("balance-transfer", {
        version: "draft",
        channel: "web",
        values: CUSTOMER,
      }),
      404,
      "version_not_found",
    );
  });

  it.each([
    [
      "a body that isn't JSON",
      "{nope",
      "The body must be JSON with version, channel and values.",
    ],
    [
      "no values",
      { version: 2, channel: "web" },
      "The body must be JSON with version, channel and values.",
    ],
    [
      "an unknown channel",
      { version: 2, channel: "fax", values: CUSTOMER },
      "channel must be one of pdf, web, email, push, sms.",
    ],
    [
      "a version as a string",
      { version: "2", channel: "web", values: CUSTOMER },
      "version must be a version number.",
    ],
    [
      "a platform on a document",
      { version: 2, channel: "web", platform: "ios", values: CUSTOMER },
      "platform is only for channel push.",
    ],
  ])("400 bad_request: %s", async (_, body, message) => {
    await expectError(
      await post("balance-transfer", body),
      400,
      "bad_request",
      message,
    );
  });

  it("413 body_too_large when Content-Length says so, before the body is read", async () => {
    const res = await post(
      "balance-transfer",
      { version: 2, channel: "web", values: CUSTOMER },
      { "Content-Length": String(MAX_BODY_BYTES + 1) },
    );
    await expectError(res, 413, "body_too_large");
    expect(getViewer).not.toHaveBeenCalled();
  });

  it("generates a correlation id when none is sent", async () => {
    const res = await post("balance-transfer", {
      version: 2,
      channel: "fax",
      values: CUSTOMER,
    });
    expect(res.headers.get("X-Correlation-Id")).toMatch(/^req_[0-9a-z]{12}$/);
  });
});

// ── Push and SMS ─────────────────────────────────────────────────────────────

describe("POST …/preview: push and SMS", () => {
  const ALERT_ID = "UC-ALERT1";
  const t = (text: string): JSONContent => ({ type: "text", text });
  const chip = (key: string): JSONContent => ({
    type: "variable",
    attrs: { key },
  });
  const field = (...inline: JSONContent[]): JSONContent => ({
    type: "doc",
    content: [{ type: "paragraph", content: inline }],
  });
  const VALUES = { first_name: "Maya", amount_due: "35.00" };

  beforeEach(async () => {
    // An alert with an Active version and an open draft, made from a seeded version's row: the seed has no alert yet.
    const [base] = await db
      .select()
      .from(versions)
      .where(
        and(
          eq(versions.templateId, ids["balance-transfer"]!),
          eq(versions.number, 2),
        ),
      );
    await db.insert(templates).values({
      id: ALERT_ID,
      teamId: "coral-offers",
      contentTypeId: "ct_alert",
      createdBy: "maya",
      createdAt: env.now,
      starterKey: null,
    });
    const alert = {
      ...base!,
      templateId: ALERT_ID,
      name: "Payment due",
      body: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
      variables: [
        {
          key: "first_name",
          label: "First name",
          type: "text",
          required: true,
          sample: "Maya",
        },
        {
          key: "amount_due",
          label: "Amount due",
          type: "currency",
          required: true,
          sample: "35",
        },
      ] as (typeof base)["variables"],
      channels: ["push", "sms"] as (typeof base)["channels"],
      channelFields: {
        push: {
          title: field(t("Payment due")),
          subtitle: field(t("Coral Card")),
          body: field(
            t("Hi "),
            chip("first_name"),
            t(", your payment of "),
            chip("amount_due"),
            t(" is due."),
          ),
        },
        sms: {
          text: field(t("Coral Offers: "), chip("amount_due"), t(" is due.")),
        },
      },
      sunsetAt: null,
      revoke: null,
    };
    // Frozen at submit, as the Alert content type's footer stood then.
    await db.insert(versions).values({
      ...alert,
      id: "v_alert_1",
      number: 1,
      state: "active",
      smsFooter: "Coral: Reply STOP to opt out, HELP for help.",
    });
    await db.insert(versions).values({
      ...alert,
      id: "v_alert_draft",
      number: null,
      state: "draft",
      smsFooter: null,
    });
  });

  it("push for a platform: the title, the subtitle (iPhone only) and the body in full, logged with its platform", async () => {
    const ios = await post(
      ALERT_ID,
      { version: 1, channel: "push", platform: "ios", values: VALUES },
      { "X-Correlation-Id": "pv-ios" },
    );
    expect(ios.status).toBe(200);
    expect(ios.headers.get("X-Stencil-Preview")).toBe("true");
    expect(await ios.json()).toMatchObject({
      title: "Payment due",
      subtitle: "Coral Card",
      body: "Hi Maya, your payment of $35.00 is due.",
      newerVersion: null,
    });

    const android = await post(
      ALERT_ID,
      { version: 1, channel: "push", platform: "android", values: VALUES },
      { "X-Correlation-Id": "pv-android" },
    );
    expect(android.status).toBe(200);
    expect(await android.json()).not.toHaveProperty("subtitle");

    expect(await logRows("pv-ios")).toEqual([
      expect.objectContaining({
        isPreview: true,
        channel: "push",
        platform: "ios",
        outcome: "ok",
      }),
    ]);
    expect(await logRows("pv-android")).toEqual([
      expect.objectContaining({
        isPreview: true,
        channel: "push",
        platform: "android",
        outcome: "ok",
      }),
    ]);
  });

  it("a push without a platform, or a platform on a document, is 400 and leaves no row", async () => {
    await expectError(
      await post(
        ALERT_ID,
        { version: 1, channel: "push", values: VALUES },
        { "X-Correlation-Id": "pv-plat-none" },
      ),
      400,
      "bad_request",
      "platform must be ios or android.",
    );
    await expectError(
      await post(ALERT_ID, {
        version: 1,
        channel: "push",
        platform: "windows",
        values: VALUES,
      }),
      400,
      "bad_request",
      "platform must be ios or android.",
    );
    expect(await logRows("pv-plat-none")).toEqual([]);
  });

  it("previews the open draft's SMS with the content type's footer as it stands, and a released version's with its own", async () => {
    const NEW = "Coral: Reply STOP to end, HELP for help.";
    await db
      .update(contentTypes)
      .set({ smsFooter: NEW })
      .where(eq(contentTypes.id, "ct_alert"));
    try {
      const draft = await post(ALERT_ID, {
        version: "draft",
        channel: "sms",
        values: VALUES,
      });
      expect(((await draft.json()) as { text: string }).text).toBe(
        `Coral Offers: $35.00 is due.\n${NEW}`,
      );
      const active = await post(ALERT_ID, {
        version: 1,
        channel: "sms",
        values: VALUES,
      });
      expect(((await active.json()) as { text: string }).text).toBe(
        "Coral Offers: $35.00 is due.\nCoral: Reply STOP to opt out, HELP for help.",
      );
    } finally {
      await db
        .update(contentTypes)
        .set({ smsFooter: "Coral: Reply STOP to opt out, HELP for help." })
        .where(eq(contentTypes.id, "ct_alert"));
    }
  });

  it("an alert doesn't render to PDF: its content type is messages", async () => {
    await expectError(
      await post(ALERT_ID, { version: 1, channel: "pdf", values: VALUES }),
      422,
      "channel_not_allowed",
    );
  });
});
