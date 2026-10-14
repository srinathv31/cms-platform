import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BODY_BYTES,
  missingVariables,
  previewForbidden,
  signedOut,
  type EmailResponseBody,
  type RenderErrorBody,
} from "@/domain/render";
import type { Viewer } from "@/domain/types";
import { findRequestContext } from "@/server/context/request";
import type { RequestContext } from "@/server/context/request";
import type { RenderResult } from "@/server/services/render";
import { POST } from "./route";

// Stencil's preview route as the BFF runs it, on facts: the backend's render (`render.preview`, a read) is stood in
// for by the answers below, so these tests check only what the route adds: who is asking (before the body), the
// body's checks (before the backend is asked), the request it hands the backend, and the HTTP it answers, with the
// same bodies, headers and errors the render API gives a consumer. What the backend decides and renders (who may
// preview, any state, rounds, the log row) is tested on the database in
// src/server/services/local/render.test.ts and ./render/render-template.test.ts beside it.

const preview = vi.hoisted(() => vi.fn());
vi.mock("@/server/services", () => ({
  services: () => ({ render: { preview } }),
}));
vi.mock("@/server/context/request", () => ({ findRequestContext: vi.fn() }));

const TEMPLATE = "UC-4F7K2Q";
const maya: RequestContext = {
  viewer: { userId: "maya" } as Viewer,
  correlationId: "req_context",
  credential: { kind: "in_process", userId: "maya" },
};
const CUSTOMER = { first_name: "Maya" };

const rendered = (
  over: Partial<Extract<RenderResult, { ok: true }>> = {},
): RenderResult => ({
  ok: true,
  channel: "web",
  versionNumber: 2,
  newerVersion: null,
  filename: `${TEMPLATE}-v2.html`,
  body: "<!doctype html><title>Terms</title>",
  ...over,
});

beforeEach(() => {
  preview.mockReset().mockResolvedValue(rendered());
  vi.mocked(findRequestContext).mockReset().mockResolvedValue(maya);
});

function post(body: unknown, headers: Record<string, string> = {}) {
  const request = new Request(
    `http://localhost/api/templates/${TEMPLATE}/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
      duplex: "half",
    } as RequestInit,
  ) as NextRequest;
  return POST(request, {
    params: Promise.resolve({ templateId: TEMPLATE }),
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
  expect(res.headers.get("X-Stencil-Preview")).toBeNull();
  const body = (await res.json()) as RenderErrorBody;
  expect(body.error.code).toBe(code);
  if (message !== undefined) expect(body.error.message).toBe(message);
  return body.error;
}

describe("POST /api/templates/[templateId]/preview: the request the backend gets", () => {
  it("asks as the session's person, under this request's correlation id, for what the body names", async () => {
    await post(
      {
        version: "draft",
        round: 2,
        channel: "push",
        platform: "ios",
        values: CUSTOMER,
        // Not the preview's: the person is the session's, whatever a body or a header says.
        consumerId: "coral",
      },
      { "X-Correlation-Id": "pv-ask", "X-Consumer-Id": "coral" },
    );
    expect(preview).toHaveBeenCalledWith(
      { ...maya, correlationId: "pv-ask" },
      {
        templateId: TEMPLATE,
        version: "draft",
        round: 2,
        channel: "push",
        platform: "ios",
        values: CUSTOMER,
      },
    );
  });

  it("resolves the person before it reads the body", async () => {
    const events: string[] = [];
    vi.mocked(findRequestContext).mockImplementation(async () => {
      events.push("person");
      return maya;
    });
    const json = new TextEncoder().encode(
      JSON.stringify({ version: 2, channel: "web", values: CUSTOMER }),
    );
    // No queue ahead of a read (highWaterMark 0), so `pull` runs only when the route reads the body.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          events.push("body");
          controller.enqueue(json);
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request(
      `http://localhost/api/templates/${TEMPLATE}/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit,
    ) as NextRequest;
    const res = await POST(request, {
      params: Promise.resolve({ templateId: TEMPLATE }),
    } as Parameters<typeof POST>[1]);
    expect(res.status).toBe(200);
    expect(events).toEqual(["person", "body"]);
  });

  it("answers nobody signed in 401 signed_out, whatever the body, without asking the backend", async () => {
    vi.mocked(findRequestContext).mockResolvedValue(null);
    for (const body of [
      { version: 2, channel: "web", values: CUSTOMER },
      // A body the route would refuse 400 is never checked: signed out comes first, as on every route.
      { version: 2, channel: "fax", values: CUSTOMER },
      { version: 2, channel: "push", values: CUSTOMER },
    ])
      await expectError(
        await post(body),
        401,
        "signed_out",
        signedOut().message,
      );
    expect(preview).not.toHaveBeenCalled();
  });

  it("reads no byte of the body when nobody is signed in", async () => {
    vi.mocked(findRequestContext).mockResolvedValue(null);
    let pulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true;
          controller.enqueue(new TextEncoder().encode("{}"));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request(
      `http://localhost/api/templates/${TEMPLATE}/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit,
    ) as NextRequest;
    const res = await POST(request, {
      params: Promise.resolve({ templateId: TEMPLATE }),
    } as Parameters<typeof POST>[1]);
    expect(res.status).toBe(401);
    expect(pulled).toBe(false);
  });
});

describe("POST /api/templates/[templateId]/preview: the answer, as the render API gives it", () => {
  it("a PDF is the file itself, named, and says it is a preview of the draft", async () => {
    preview.mockResolvedValue(
      rendered({
        channel: "pdf",
        versionNumber: null,
        filename: `${TEMPLATE}-draft.pdf`,
        body: new TextEncoder().encode("%PDF-1.7 bytes"),
      }),
    );
    const res = await post(
      { version: "draft", channel: "pdf", values: CUSTOMER },
      { "X-Correlation-Id": "pv-draft" },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("X-Stencil-Version")).toBe("draft");
    expect(res.headers.get("X-Stencil-Preview")).toBe("true");
    expect(res.headers.get("X-Stencil-Template-Id")).toBe(TEMPLATE);
    expect(res.headers.get("X-Correlation-Id")).toBe("pv-draft");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toBe(
      `inline; filename="${TEMPLATE}-draft.pdf"`,
    );
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe(
      "%PDF-1.7 bytes",
    );
  });

  it("a web document is HTML under the render API's content policy; a Superseded version names the newer one", async () => {
    preview.mockResolvedValue(rendered({ versionNumber: 1, newerVersion: 2 }));
    const res = await post({ version: 1, channel: "web", values: CUSTOMER });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toMatch(
      /default-src 'none'/,
    );
    expect(res.headers.get("X-Stencil-Version")).toBe("1");
    expect(res.headers.get("X-Stencil-Newer-Version")).toBe("2");
    expect(await res.text()).toBe("<!doctype html><title>Terms</title>");
  });

  it("base64 wraps the web document in JSON, as the consumer API does", async () => {
    const res = await post({
      version: 2,
      channel: "web",
      values: CUSTOMER,
      encoding: "base64",
    });
    expect(preview.mock.calls[0]![1]).toMatchObject({ encoding: "base64" });
    const body = (await res.json()) as { encoding: string; data: string };
    expect(body.encoding).toBe("base64");
    expect(Buffer.from(body.data, "base64").toString("utf8")).toBe(
      "<!doctype html><title>Terms</title>",
    );
  });

  it("an email is JSON with its subject, preheader, html, text and the newer-version flag", async () => {
    preview.mockResolvedValue(
      rendered({
        channel: "email",
        body: { subject: "S", preheader: "P", html: "<p>H</p>", text: "T" },
      }),
    );
    const res = await post({ version: 2, channel: "email", values: CUSTOMER });
    const body = (await res.json()) as EmailResponseBody;
    expect(body).toEqual({
      subject: "S",
      preheader: "P",
      html: "<p>H</p>",
      text: "T",
      newerVersion: null,
    });
  });

  it("a push and an SMS are their JSON, with the newer-version flag", async () => {
    const push = { title: "Payment due", body: "Hi", payloadBytes: 61 };
    preview.mockResolvedValue(rendered({ channel: "push", body: push }));
    expect(
      await (
        await post({
          version: 1,
          channel: "push",
          platform: "android",
          values: CUSTOMER,
        })
      ).json(),
    ).toEqual({ ...push, newerVersion: null });
    const sms = {
      text: "Coral: due.",
      encoding: "GSM-7" as const,
      parts: 1,
      characters: 11,
    };
    preview.mockResolvedValue(rendered({ channel: "sms", body: sms }));
    expect(
      await (
        await post({ version: 1, channel: "sms", values: CUSTOMER })
      ).json(),
    ).toEqual({ ...sms, newerVersion: null });
  });

  it("the backend's render error is `{ error: { code, message, details } }` with its status", async () => {
    preview.mockResolvedValue({
      ok: false,
      error: missingVariables({ missing: ["first_name"], invalid: [] }),
    });
    const error = await expectError(
      await post({ version: 2, channel: "web", values: {} }),
      422,
      "missing_variables",
    );
    expect(error.details).toEqual({ missing: ["first_name"], invalid: [] });

    preview.mockResolvedValue({ ok: false, error: previewForbidden() });
    await expectError(
      await post({ version: 2, channel: "web", values: CUSTOMER }),
      403,
      "preview_forbidden",
    );
  });

  it("a backend that fails outside the pipeline is 500 render_failed, in the same shape", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    preview.mockRejectedValue(new Error("SQLITE_BUSY"));
    await expectError(
      await post(
        { version: 2, channel: "web", values: CUSTOMER },
        { "X-Correlation-Id": "pv-down" },
      ),
      500,
      "render_failed",
    );
    expect(String(log.mock.calls[0]?.[0])).toContain("pv-down");
    log.mockRestore();
  });

  it("generates a correlation id when none is sent", async () => {
    const res = await post({ version: 2, channel: "web", values: CUSTOMER });
    expect(res.headers.get("X-Correlation-Id")).toMatch(/^req_[0-9a-z]{12}$/);
    expect(preview.mock.calls[0]![0].correlationId).toBe(
      res.headers.get("X-Correlation-Id"),
    );
  });
});

describe("POST /api/templates/[templateId]/preview: the body's checks, before the backend is asked", () => {
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
    [
      "a push without a platform",
      { version: 1, channel: "push", values: CUSTOMER },
      "platform must be ios or android.",
    ],
    [
      "a platform that isn't a phone's",
      { version: 1, channel: "push", platform: "windows", values: CUSTOMER },
      "platform must be ios or android.",
    ],
  ])("400 bad_request: %s", async (_, body, message) => {
    await expectError(await post(body), 400, "bad_request", message);
    expect(preview).not.toHaveBeenCalled();
  });

  it("400 bad_request for a round that isn't a whole number from 1", async () => {
    for (const round of [0, "1", 1.5, null])
      await expectError(
        await post({ version: 3, round, channel: "web", values: CUSTOMER }),
        400,
        "bad_request",
        "round must be a whole number from 1.",
      );
    expect(preview).not.toHaveBeenCalled();
  });

  it("413 body_too_large when Content-Length says so, before the body is read", async () => {
    await expectError(
      await post(
        { version: 2, channel: "web", values: CUSTOMER },
        { "Content-Length": String(MAX_BODY_BYTES + 1) },
      ),
      413,
      "body_too_large",
    );
    expect(preview).not.toHaveBeenCalled();
  });
});
