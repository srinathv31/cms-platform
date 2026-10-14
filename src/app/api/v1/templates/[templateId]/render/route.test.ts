import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BODY_BYTES,
  MAX_VALUE_LENGTH,
  type Base64ResponseBody,
  type EmailResponseBody,
  type RenderErrorBody,
} from "@/domain/render/types";
import type { JSONContent, Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { contentTypes, renderLog, versions } from "@/server/db/schema/ucomp";
import { seededDatabasePerTest } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { POST } from "./route";

// The route end to end: HTTP in, the real pipeline and adapters, a temporary database filled by the
// real seed, HTTP out. Only the database handle, the demo clock and the persona are swapped.

const env = vi.hoisted(() => ({ now: new Date("2026-10-04T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-render-route-");
});
vi.mock("@/server/services/local/clock", () => ({
  now: vi.fn(async () => env.now),
}));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

let db: Db;
const ids = seededDatabasePerTest({ base: env.now });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

const persona = (userId: string, teamIds: string[]): Viewer => ({
  userId,
  name: userId,
  initials: userId.slice(0, 2).toUpperCase(),
  title: "Tester",
  platformRole: null,
  memberships: teamIds.map((teamId) => ({
    teamId,
    teamSlug: `slug-of-${teamId}`,
    teamName: teamId,
    roles: ["author"],
    status: "active",
  })),
});
const maya = persona("maya", ["t_coral"]);

beforeEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(maya);
});

const CUSTOMER = {
  first_name: "Maya",
  last_name: "Chen",
  purchase_apr: "21.99",
  home_state: "NJ",
};
const CORAL = { "X-Consumer-Id": "coral" };

function requestOf(
  templateId: string,
  body: BodyInit,
  headers: Record<string, string> = CORAL,
) {
  return new Request(`http://localhost/api/v1/templates/${templateId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit) as NextRequest;
}

function post(
  template: string,
  body: unknown,
  headers: Record<string, string> = CORAL,
) {
  const templateId = ids[template] ?? template;
  const request = requestOf(
    templateId,
    typeof body === "string" ? body : JSON.stringify(body),
    headers,
  );
  return POST(request, { params: Promise.resolve({ templateId }) });
}

/** A body with no Content-Length (as a chunked request): `megabytes` of 1 MB chunks, counting what was pulled. */
function chunkedBody(megabytes: number) {
  const pulled = { mb: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.mb >= megabytes) return controller.close();
      pulled.mb += 1;
      controller.enqueue(new Uint8Array(1024 * 1024).fill(0x20));
    },
  });
  return { stream, pulled };
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

// ── Success, per channel ─────────────────────────────────────────────────────

describe("POST /api/v1/templates/[templateId]/render: channels", () => {
  it("web: a text/html document with the X-Stencil headers", async () => {
    const res = await post(
      "balance-transfer",
      { version: 2, channel: "web", values: CUSTOMER },
      { ...CORAL, "X-Correlation-Id": "abc-123" },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Correlation-Id")).toBe("abc-123");
    expect(res.headers.get("X-Stencil-Template-Id")).toBe(
      ids["balance-transfer"],
    );
    expect(res.headers.get("X-Stencil-Version")).toBe("2");
    expect(res.headers.get("X-Stencil-Newer-Version")).toBeNull();
    expect(res.headers.get("X-Stencil-Preview")).toBeNull();
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );
    const html = await res.text();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("21.99%");
  });

  it("pdf: application/pdf bytes, inline, with the version's filename", async () => {
    const res = await post("balance-transfer", {
      version: 2,
      channel: "pdf",
      values: CUSTOMER,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe(
      `inline; filename="${ids["balance-transfer"]}-v2.pdf"`,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  }, 30_000);

  it("email: JSON with subject, preheader, html, text and the newer-version flag", async () => {
    const res = await post("rate-change-notice", {
      version: 1,
      channel: "email",
      values: { ...CUSTOMER, effective_date: "3/4/2027" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    const body = (await res.json()) as EmailResponseBody;
    expect(Object.keys(body).sort()).toEqual([
      "html",
      "newerVersion",
      "preheader",
      "subject",
      "text",
    ]);
    expect(body.subject).toBe("Your purchase APR is changing on March 4, 2027");
    expect(body.newerVersion).toBeNull();
    expect(body.html).toContain("<!doctype html>");
    expect(body.text).toContain("Hi Maya");
  });
});

describe("POST …/render: base64 opt-in", () => {
  it("pdf comes back as a JSON envelope", async () => {
    const res = await post("balance-transfer", {
      version: 2,
      channel: "pdf",
      values: CUSTOMER,
      encoding: "base64",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(res.headers.get("Content-Disposition")).toBeNull();
    const body = (await res.json()) as Base64ResponseBody;
    expect(body).toMatchObject({
      channel: "pdf",
      contentType: "application/pdf",
      encoding: "base64",
      newerVersion: null,
    });
    expect(
      Buffer.from(body.data, "base64").subarray(0, 5).toString("latin1"),
    ).toBe("%PDF-");
  }, 30_000);

  it("web comes back as a JSON envelope of the UTF-8 document", async () => {
    const res = await post("balance-transfer", {
      version: 2,
      channel: "web",
      values: CUSTOMER,
      encoding: "base64",
    });
    const body = (await res.json()) as Base64ResponseBody;
    expect(body).toMatchObject({
      channel: "web",
      contentType: "text/html; charset=utf-8",
      encoding: "base64",
    });
    const html = Buffer.from(body.data, "base64").toString("utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("—"); // non-ASCII survives the round trip (the title has an em dash)
  });

  it("email base64-encodes html and text, and says so", async () => {
    const res = await post("rate-change-notice", {
      version: 1,
      channel: "email",
      values: { ...CUSTOMER, effective_date: "2027-03-04" },
      encoding: "base64",
    });
    const body = (await res.json()) as EmailResponseBody;
    expect(body.encoding).toBe("base64");
    expect(body.subject).toBe("Your purchase APR is changing on March 4, 2027");
    expect(Buffer.from(body.html, "base64").toString("utf8")).toContain(
      "<!doctype html>",
    );
    expect(Buffer.from(body.text, "base64").toString("utf8")).toContain(
      "Hi Maya",
    );
  });
});

describe("POST …/render: superseded versions", () => {
  it("a Superseded version renders with X-Stencil-Newer-Version", async () => {
    const res = await post("balance-transfer", {
      version: 1,
      channel: "web",
      values: CUSTOMER,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stencil-Version")).toBe("1");
    expect(res.headers.get("X-Stencil-Newer-Version")).toBe("2");
  });

  it("the email JSON carries newerVersion too", async () => {
    // No seeded Superseded version has email on, so turn it on for this one.
    const id = ids["high-yield-savings"]!;
    const where = and(eq(versions.templateId, id), eq(versions.number, 1));
    const [v1] = await db.select().from(versions).where(where);
    const subject = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Your savings rate" }],
        },
      ],
    };
    await db
      .update(versions)
      .set({
        channels: ["pdf", "web", "email"],
        channelFields: { email: { subject } },
      })
      .where(where);
    try {
      const values = Object.fromEntries(
        v1!.variables.map((v) => [v.key, v.sample]),
      );
      const res = await post(
        "high-yield-savings",
        { version: 1, channel: "email", values },
        { "X-Consumer-Id": "deposits-online" },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Stencil-Newer-Version")).toBe("2");
      const body = (await res.json()) as EmailResponseBody;
      expect(body).toMatchObject({
        subject: "Your savings rate",
        preheader: "",
        newerVersion: 2,
      });
    } finally {
      await db
        .update(versions)
        .set({ channels: v1!.channels, channelFields: v1!.channelFields })
        .where(where);
    }
  });

  it("a Superseded version past its sunset is 410 with what happened and which version is active", async () => {
    const saved = env.now;
    env.now = new Date(saved.getTime() + 22 * 86_400_000);
    try {
      const res = await post("balance-transfer", {
        version: 1,
        channel: "web",
        values: CUSTOMER,
      });
      const error = await expectError(res, 410, "version_sunset");
      expect(error.message).toMatch(
        /^Version 1 was sunset on \w+ \d+, \d{4}\. Version 2 is active\.$/,
      );
      expect(
        error.details,
        "the day and zone beside the instant",
      ).toMatchObject({
        version: 1,
        activeVersion: 2,
        sunsetDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        zone: "America/New_York",
      });
    } finally {
      env.now = saved;
    }
  });
});

// /api/v1 serves consumers only (decision 0047): a request that looks like a CMS preview is refused like any
// consumer request that names no consumer, a draft, or a version that isn't released. The route never
// reads the session, so a signed-in person gets nothing a consumer wouldn't. Stencil's own preview is
// POST /api/templates/[templateId]/preview.
describe("POST …/render: consumers only", () => {
  const FEE = { ...CUSTOMER, annual_fee: "95" };

  it("refuses the open draft, with or without `preview` and a consumer, and never asks who is signed in", async () => {
    for (const [body, headers] of [
      [
        { version: "draft", channel: "pdf", values: CUSTOMER, preview: true },
        {},
      ],
      [
        { version: "draft", channel: "pdf", values: CUSTOMER, preview: true },
        CORAL,
      ],
      [{ version: "draft", channel: "pdf", values: CUSTOMER }, CORAL],
    ] as const) {
      const res = await post("annual-fee-waiver", body, {
        ...headers,
        "X-Correlation-Id": "no-draft",
      });
      await expectError(
        res,
        400,
        "bad_request",
        "version must be a version number.",
      );
    }
    expect(getViewer).not.toHaveBeenCalled();
    expect(await logRows("no-draft")).toEqual([]);
  });

  it("refuses a preview of a released version that names no consumer: the cookie's person is not a consumer", async () => {
    const res = await post(
      "balance-transfer",
      { version: 2, channel: "web", values: CUSTOMER, preview: true },
      { "X-Correlation-Id": "no-consumer" },
    );
    await expectError(
      res,
      400,
      "consumer_required",
      "X-Consumer-Id is required.",
    );
    expect(getViewer).not.toHaveBeenCalled();
    expect(await logRows("no-consumer")).toEqual([]);
  });

  it("serves a version in review to nobody, `preview` or not: a consumer is refused it, and it is logged as a consumer's", async () => {
    for (const preview of [true, false, "yes"]) {
      const res = await post(
        "cash-back",
        { version: 3, channel: "web", values: FEE, preview },
        { ...CORAL, "X-Correlation-Id": `in-review-${preview}` },
      );
      await expectError(
        res,
        409,
        "version_not_released",
        "Version 3 is in review. Version 2 is active.",
      );
      expect(await logRows(`in-review-${preview}`)).toEqual([
        expect.objectContaining({
          isPreview: false,
          consumerId: "coral",
          outcome: "error",
          errorCode: "version_not_released",
        }),
      ]);
    }
    expect(getViewer).not.toHaveBeenCalled();
  });

  it("renders a released version as a consumer whatever `preview` says, with no preview header and no session read", async () => {
    const res = await post(
      "balance-transfer",
      { version: 2, channel: "web", values: CUSTOMER, preview: true },
      { ...CORAL, "X-Correlation-Id": "released" },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Stencil-Preview")).toBeNull();
    expect(getViewer).not.toHaveBeenCalled();
    expect(await logRows("released")).toEqual([
      expect.objectContaining({
        isPreview: false,
        consumerId: "coral",
        outcome: "ok",
      }),
    ]);
  });

  // A consumer never sees rounds: the field is dropped unread and the number is its head.
  it("a consumer's round is ignored, whatever it holds: the number's head answers", async () => {
    for (const round of [1, "x", 0]) {
      const res = await post("cash-back", {
        version: 3,
        round,
        channel: "web",
        values: FEE,
      });
      await expectError(
        res,
        409,
        "version_not_released",
        "Version 3 is in review. Version 2 is active.",
      );
    }
    const released = await post("balance-transfer", {
      version: 2,
      round: 7,
      channel: "web",
      values: CUSTOMER,
    });
    expect(released.status).toBe(200);
  });
});

// ── Errors ───────────────────────────────────────────────────────────────────

describe("POST …/render: 400 bad requests", () => {
  const good = { version: 2, channel: "web", values: CUSTOMER };
  const BODY = "The body must be JSON with version, channel and values.";

  it.each([
    ["a body that isn't JSON", "{nope", BODY],
    ["a JSON array", "[]", BODY],
    ["no values", { version: 2, channel: "web" }, BODY],
    ["no version", { channel: "web", values: {} }, BODY],
    [
      "an unknown channel",
      { ...good, channel: "fax" },
      "channel must be one of pdf, web, email, push, sms.",
    ],
    [
      "a version as a string",
      { ...good, version: "2" },
      "version must be a version number.",
    ],
    ["version 0", { ...good, version: 0 }, "version must be a version number."],
    [
      "a fractional version",
      { ...good, version: 1.5 },
      "version must be a version number.",
    ],
    [
      "values as an array",
      { ...good, values: [] },
      "values must be an object.",
    ],
    ["values as null", { ...good, values: null }, "values must be an object."],
    [
      "another encoding",
      { ...good, encoding: "hex" },
      "encoding must be base64.",
    ],
    [
      "the draft",
      { ...good, version: "draft" },
      "version must be a version number.",
    ],
  ])("%s", async (_, body, message) => {
    await expectError(
      await post("balance-transfer", body),
      400,
      "bad_request",
      message,
    );
  });

  it("a missing X-Consumer-Id is consumer_required", async () => {
    await expectError(
      await post("balance-transfer", good, {}),
      400,
      "consumer_required",
      "X-Consumer-Id is required.",
    );
  });

  it("generates a correlation id when none is sent, and replaces an unusable one", async () => {
    const res = await post("balance-transfer", { ...good, channel: "fax" });
    expect(res.headers.get("X-Correlation-Id")).toMatch(/^req_[0-9a-z]{12}$/);
    const odd = await post("balance-transfer", good, {
      ...CORAL,
      "X-Correlation-Id": "x".repeat(200),
    });
    expect(odd.headers.get("X-Correlation-Id")).toMatch(/^req_/);
  });
});

describe("POST …/render: 413 body_too_large", () => {
  const TOO_LARGE = "The body must be at most 1,000,000 bytes.";

  it("when Content-Length says the body is too large, before reading it", async () => {
    const templateId = ids["balance-transfer"]!;
    const body = JSON.stringify({
      version: 2,
      channel: "web",
      values: CUSTOMER,
    });
    const request = requestOf(templateId, body, {
      ...CORAL,
      "Content-Length": String(MAX_BODY_BYTES + 1),
    });
    await expectError(
      await POST(request, { params: Promise.resolve({ templateId }) }),
      413,
      "body_too_large",
      TOO_LARGE,
    );
    expect(request.bodyUsed).toBe(false);
  });

  it("for a chunked body with no Content-Length, as soon as it passes the limit: the rest is never read", async () => {
    const templateId = ids["balance-transfer"]!;
    const { stream, pulled } = chunkedBody(64);
    const res = await POST(
      requestOf(templateId, stream, {
        ...CORAL,
        "X-Correlation-Id": "chunked",
      }),
      { params: Promise.resolve({ templateId }) },
    );
    await expectError(res, 413, "body_too_large", TOO_LARGE);
    expect(pulled.mb).toBeLessThan(4); // the limit is 1,000,000 bytes: one 1 MB chunk and a bit
    expect(await logRows("chunked")).toEqual([]);
  });

  it("counts bytes, not characters: a body one byte over is refused, a body at the limit is read", async () => {
    const json = JSON.stringify({
      version: 2,
      channel: "web",
      values: CUSTOMER,
    });
    await expectError(
      await post(
        "balance-transfer",
        json + " ".repeat(MAX_BODY_BYTES - json.length + 1),
      ),
      413,
      "body_too_large",
    );
    expect(
      (
        await post(
          "balance-transfer",
          json + " ".repeat(MAX_BODY_BYTES - json.length),
        )
      ).status,
    ).toBe(200);
    // 500,000 two-byte characters: half the limit counted in characters, over it in bytes.
    const wide = {
      version: 2,
      channel: "web",
      values: { ...CUSTOMER, unused: "é".repeat(500_000) },
    };
    await expectError(
      await post("balance-transfer", wide),
      413,
      "body_too_large",
    );
  });
});

describe("POST …/render: the value length limit", () => {
  it("a value at the limit renders, exactly as sent, in every channel the version has", async () => {
    const name = `${"Maya".repeat(MAX_VALUE_LENGTH / 4 - 1)}Chen`;
    expect([...name]).toHaveLength(MAX_VALUE_LENGTH);
    const web = await post("balance-transfer", {
      version: 2,
      channel: "web",
      values: { ...CUSTOMER, first_name: name },
    });
    expect(web.status).toBe(200);
    expect(await web.text()).toContain(name);
    const pdf = await post("balance-transfer", {
      version: 2,
      channel: "pdf",
      values: { ...CUSTOMER, first_name: name },
    });
    expect(pdf.status).toBe(200);
  }, 30_000);

  it("a value one character over is 422 invalid_values that names the limit, never the value, and isn't cut", async () => {
    const res = await post(
      "balance-transfer",
      {
        version: 2,
        channel: "web",
        values: {
          ...CUSTOMER,
          first_name: `Zq9${"x".repeat(MAX_VALUE_LENGTH - 2)}`,
        },
      },
      { ...CORAL, "X-Correlation-Id": "too-long" },
    );
    const error = await expectError(
      res,
      422,
      "invalid_values",
      "first_name must be at most 1,000 characters.",
    );
    expect(error.details).toEqual({
      missing: [],
      invalid: [{ key: "first_name", expected: "text", maxLength: 1000 }],
    });
    expect(JSON.stringify(error)).not.toContain("Zq9");
    expect(await logRows("too-long")).toEqual([
      expect.objectContaining({
        outcome: "error",
        errorCode: "invalid_values",
      }),
    ]);
  });
});

describe("POST …/render: 403, 404 and 422", () => {
  it("an unregistered consumer is 403", async () => {
    await expectError(
      await post(
        "balance-transfer",
        { version: 2, channel: "web", values: CUSTOMER },
        { "X-Consumer-Id": "acme" },
      ),
      403,
      "unknown_consumer",
      'Consumer "acme" isn\'t registered.',
    );
  });

  it("an unknown template is 404, and isn't logged", async () => {
    const res = await post(
      "UC-ZZZZZZ",
      { version: 1, channel: "web", values: {} },
      { ...CORAL, "X-Correlation-Id": "no-template" },
    );
    await expectError(
      res,
      404,
      "template_not_found",
      "Template UC-ZZZZZZ doesn't exist.",
    );
    expect(await logRows("no-template")).toEqual([]);
  });

  it("an unknown version is 404", async () => {
    await expectError(
      await post("balance-transfer", {
        version: 9,
        channel: "web",
        values: CUSTOMER,
      }),
      404,
      "version_not_found",
      `Template ${ids["balance-transfer"]} has no version 9.`,
    );
  });

  it("missing required variables are 422, listed by key", async () => {
    const error = await expectError(
      await post("balance-transfer", {
        version: 2,
        channel: "web",
        values: { first_name: "Maya" },
      }),
      422,
      "missing_variables",
      "Missing required variables: last_name, purchase_apr, home_state.",
    );
    expect(error.details).toEqual({
      missing: ["last_name", "purchase_apr", "home_state"],
      invalid: [],
    });
  });

  it("a wrong type is 422, naming the variable and the type, never the value", async () => {
    const res = await post("balance-transfer", {
      version: 2,
      channel: "web",
      values: { ...CUSTOMER, home_state: "Atlantis" },
    });
    const error = await expectError(
      res,
      422,
      "invalid_values",
      "home_state must be a US state, like NJ.",
    );
    expect(JSON.stringify(error)).not.toContain("Atlantis");
  });

  it('a JSON number in values is refused whatever its digits: send the string "21.90" (decision 0058)', async () => {
    const body = (apr: string) =>
      `{"version":2,"channel":"web","values":{"first_name":"Maya","last_name":"Chen","purchase_apr":${apr},"home_state":"NJ"}}`;
    for (const number of ["21.90", "21", "1e1", "1000000000000000000000"]) {
      const error = await expectError(
        await post("balance-transfer", body(number)),
        422,
        "invalid_values",
        'purchase_apr must be a JSON string, like "21.90", not a number.',
      );
      expect(error.details).toEqual({
        missing: [],
        invalid: [{ key: "purchase_apr", expected: "percent", sent: "number" }],
      });
    }
    // The same digits as a string render, every one kept.
    const res = await post("balance-transfer", body('"21.90"'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("21.90%");
  });

  it("a channel the version hasn't turned on is 422", async () => {
    await expectError(
      await post("balance-transfer", {
        version: 2,
        channel: "email",
        values: CUSTOMER,
      }),
      422,
      "channel_not_enabled",
      "Version 2 doesn't render to Email. Its channels are PDF and Web.",
    );
  });

  it("a channel the content type doesn't allow is 422", async () => {
    await db
      .update(contentTypes)
      .set({ allowedChannels: ["pdf", "web"] })
      .where(eq(contentTypes.key, "disclosure"));
    try {
      await expectError(
        await post("rate-change-notice", {
          version: 1,
          channel: "email",
          values: { ...CUSTOMER, effective_date: "2027-03-04" },
        }),
        422,
        "channel_not_allowed",
        "Disclosures don't render to Email.",
      );
    } finally {
      await db
        .update(contentTypes)
        .set({ allowedChannels: ["pdf", "web", "email"] })
        .where(eq(contentTypes.key, "disclosure"));
    }
  });

  it("a disclosure doesn't render to push or SMS: its content type is documents", async () => {
    await expectError(
      await post("balance-transfer", {
        version: 2,
        channel: "sms",
        values: CUSTOMER,
      }),
      422,
      "channel_not_allowed",
      "Disclosures don't render to SMS.",
    );
  });
});

// ── Push and SMS: an Alert ───────────────────────────────────────────────────

describe("POST …/render: push and SMS", () => {
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
    // An Active Alert version, made from a seeded version's row: the seed has no alert yet.
    const [base] = await db
      .select()
      .from(versions)
      .where(
        and(
          eq(versions.templateId, ids["balance-transfer"]!),
          eq(versions.number, 2),
        ),
      );
    const { templates: templatesTable } =
      await import("@/server/db/schema/ucomp");
    await db.insert(templatesTable).values({
      id: ALERT_ID,
      teamId: "t_coral",
      contentTypeId: "ct_alert",
      createdBy: "maya",
      createdAt: env.now,
      starterKey: null,
    });
    await db.insert(versions).values({
      ...base!,
      id: "v_alert_1",
      templateId: ALERT_ID,
      number: 1,
      state: "active",
      name: "Payment due",
      body: { type: "doc", content: [{ type: "paragraph" }] },
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
      ],
      channels: ["push", "sms"],
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
          text: field(
            t("Coral Offers: "),
            chip("amount_due"),
            t(" is due."),
            { type: "hardBreak" },
            t("coral.example/pay"),
          ),
        },
      },
      // Frozen at submit, as the Alert content type's footer stood then.
      smsFooter: "Coral: Reply STOP to opt out, HELP for help.",
      sunsetAt: null,
      revoke: null,
    });
  });

  it("push for iPhone: JSON with the title, the subtitle and the body in full, and the payload's size", async () => {
    const res = await post(
      ALERT_ID,
      { version: 1, channel: "push", platform: "ios", values: VALUES },
      { ...CORAL, "X-Correlation-Id": "push-ios" },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(res.headers.get("X-Stencil-Version")).toBe("1");
    expect(await res.json()).toEqual({
      title: "Payment due",
      subtitle: "Coral Card",
      body: "Hi Maya, your payment of $35.00 is due.",
      payloadBytes: 114,
      newerVersion: null,
    });
    // The log holds the channel, the platform and the outcome, never a value.
    const [row] = await logRows("push-ios");
    expect(row).toMatchObject({
      channel: "push",
      platform: "ios",
      outcome: "ok",
      errorCode: null,
      consumerId: "coral",
    });
    expect(JSON.stringify(row)).not.toContain("Maya");
  });

  it("push for Android: never a subtitle", async () => {
    const res = await post(
      ALERT_ID,
      { version: 1, channel: "push", platform: "android", values: VALUES },
      { ...CORAL, "X-Correlation-Id": "push-android" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      title: "Payment due",
      body: "Hi Maya, your payment of $35.00 is due.",
      payloadBytes: 101,
      newerVersion: null,
    });
    expect(await logRows("push-android")).toEqual([
      expect.objectContaining({
        channel: "push",
        platform: "android",
        outcome: "ok",
      }),
    ]);
  });

  it("logs the platform of a push and of a failed push, and none for any other channel", async () => {
    const asked = [
      {
        id: "plat-sms",
        body: { version: 1, channel: "sms", values: VALUES },
        headers: CORAL,
        platform: null,
      },
      {
        id: "plat-ios",
        body: { version: 1, channel: "push", platform: "ios", values: VALUES },
        headers: CORAL,
        platform: "ios",
      },
      {
        id: "plat-failed",
        body: { version: 1, channel: "push", platform: "android", values: {} },
        headers: CORAL,
        platform: "android",
      },
    ] as const;
    for (const { id, body, headers } of asked)
      await post(ALERT_ID, body, { ...headers, "X-Correlation-Id": id });
    for (const { id, platform } of asked)
      expect(await logRows(id), id).toEqual([
        expect.objectContaining({ platform }),
      ]);
    // A failed push is logged by its code and its phone, no value.
    expect((await logRows("plat-failed"))[0]).toMatchObject({
      channel: "push",
      platform: "android",
      outcome: "error",
      errorCode: "missing_variables",
    });
  });

  it("a request refused before it is logged leaves no row, so a push without a platform never writes a null one", async () => {
    await expectError(
      await post(
        ALERT_ID,
        { version: 1, channel: "push", values: VALUES },
        { ...CORAL, "X-Correlation-Id": "plat-none" },
      ),
      400,
      "bad_request",
      "platform must be ios or android.",
    );
    expect(await logRows("plat-none")).toEqual([]);
  });

  it("SMS: JSON with the text as sent, the footer on its last line, and its encoding and parts", async () => {
    const res = await post(ALERT_ID, {
      version: 1,
      channel: "sms",
      values: VALUES,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "Coral Offers: $35.00 is due.\ncoral.example/pay\nCoral: Reply STOP to opt out, HELP for help.",
      encoding: "GSM-7",
      parts: 1,
      characters: 91,
      newerVersion: null,
    });
  });

  it("ends with the footer the version was submitted with: a later change to the content type's reaches only a draft", async () => {
    const { contentTypes } = await import("@/server/db/schema/ucomp");
    await db
      .update(contentTypes)
      .set({ smsFooter: "Coral: Reply STOP to end, HELP for help." })
      .where(eq(contentTypes.id, "ct_alert"));
    try {
      const active = await post(ALERT_ID, {
        version: 1,
        channel: "sms",
        values: VALUES,
      });
      expect(((await active.json()) as { text: string }).text).toMatch(
        /\nCoral: Reply STOP to opt out, HELP for help\.$/,
      );
    } finally {
      await db
        .update(contentTypes)
        .set({ smsFooter: "Coral: Reply STOP to opt out, HELP for help." })
        .where(eq(contentTypes.id, "ct_alert"));
    }
  });

  it("a value outside GSM-7 switches the SMS to UCS-2; it is never transliterated", async () => {
    await db
      .update(versions)
      .set({
        channelFields: {
          push: { title: field(t("Payment due")), body: field(t("Hi")) },
          sms: { text: field(t("Hi "), chip("first_name")) },
        },
      })
      .where(eq(versions.id, "v_alert_1"));
    const res = await post(ALERT_ID, {
      version: 1,
      channel: "sms",
      values: { ...VALUES, first_name: "Gómez" },
    });
    expect(await res.json()).toEqual({
      text: "Hi Gómez\nCoral: Reply STOP to opt out, HELP for help.",
      encoding: "UCS-2",
      parts: 1,
      characters: 53,
      newerVersion: null,
    });
  });

  it("a push without a platform, or with a platform that isn't one, is 400", async () => {
    await expectError(
      await post(ALERT_ID, { version: 1, channel: "push", values: VALUES }),
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
  });

  it("any other channel with a platform is 400, and push and SMS refuse an encoding", async () => {
    await expectError(
      await post(ALERT_ID, {
        version: 1,
        channel: "sms",
        platform: "ios",
        values: VALUES,
      }),
      400,
      "bad_request",
      "platform is only for channel push.",
    );
    await expectError(
      await post("balance-transfer", {
        version: 2,
        channel: "pdf",
        platform: "android",
        values: CUSTOMER,
      }),
      400,
      "bad_request",
      "platform is only for channel push.",
    );
    await expectError(
      await post(ALERT_ID, {
        version: 1,
        channel: "sms",
        encoding: "base64",
        values: VALUES,
      }),
      400,
      "bad_request",
      "encoding is only for channels pdf, web and email.",
    );
  });

  it("an alert doesn't render to PDF: its content type is messages", async () => {
    await expectError(
      await post(ALERT_ID, { version: 1, channel: "pdf", values: VALUES }),
      422,
      "channel_not_allowed",
      "Alerts don't render to PDF.",
    );
  });

  it("a push over 4,096 bytes is 422 and logged by its code, never cut and never echoing the value", async () => {
    const long = "x".repeat(1000);
    await db
      .update(versions)
      .set({
        channelFields: {
          push: {
            title: field(chip("first_name")),
            body: field(
              chip("first_name"),
              chip("first_name"),
              chip("first_name"),
              chip("first_name"),
            ),
          },
          sms: { text: field(chip("first_name")) },
        },
      })
      .where(eq(versions.id, "v_alert_1"));
    const res = await post(
      ALERT_ID,
      {
        version: 1,
        channel: "push",
        platform: "ios",
        values: { ...VALUES, first_name: long },
      },
      { ...CORAL, "X-Correlation-Id": "push-big" },
    );
    const error = await expectError(
      res,
      422,
      "push_payload_too_large",
      "The push is 5,040 bytes on iPhone. It can be at most 4,096 bytes.",
    );
    expect(error.details).toEqual({
      platform: "ios",
      payloadBytes: 5040,
      maxBytes: 4096,
    });
    const [row] = await logRows("push-big");
    expect(row).toMatchObject({
      channel: "push",
      platform: "ios",
      outcome: "error",
      errorCode: "push_payload_too_large",
    });
    expect(JSON.stringify(row)).not.toContain("xxxx");
  });

  it("an SMS over 10 parts is 422, never cut", async () => {
    // The version's SMS is the first name alone, so the value sets its length.
    await db
      .update(versions)
      .set({
        channelFields: {
          push: {
            title: field(chip("first_name")),
            body: field(
              chip("first_name"),
              chip("first_name"),
              chip("first_name"),
              chip("first_name"),
            ),
          },
          sms: { text: field(chip("first_name")) },
        },
      })
      .where(eq(versions.id, "v_alert_1"));
    const res = await post(ALERT_ID, {
      version: 1,
      channel: "sms",
      values: { ...VALUES, first_name: "é".repeat(699) + "😀" },
    });
    await expectError(
      res,
      422,
      "sms_too_long",
      "The SMS is 12 parts in UCS-2. It can be at most 10 parts.",
    );
  });
});
