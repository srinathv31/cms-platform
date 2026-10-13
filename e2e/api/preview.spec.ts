import { expect, test } from "@playwright/test";
import { allVersions, renderLogFor } from "../helpers/state";
import {
  LABEL,
  LOG_FIELDS,
  andList,
  asPersona,
  correlation,
  expectError,
  isDocument,
  pick,
  preview,
  validValues,
  type Channel,
  type SeedVersion,
} from "./helpers";

// Stencil's own preview route (decision 0047): POST /api/templates/{templateId}/preview, called the way
// the app's Preview does, with the persona cookie that stands in for the session. It renders through
// the same engine as the consumer API (render.spec.ts), tags every answer a preview, and is open only to
// people who can see the template's team. The seeded database is read to find what to preview and to
// look inside render_log.

const PERSONA_CAN_SEE = "maya"; // Coral Offers author
const PERSONA_CANNOT_SEE_DEPOSITS = "maya";
const PERSONA_WITH_NO_TEAM = "morgan";

const DOCUMENT_CHANNELS: readonly Channel[] = ["pdf", "web", "email"];

const versions = async () => (await allVersions()).filter(isDocument);
const required = (v: SeedVersion) => v.variables.filter((x) => x.required);
const pdfMagic = (bytes: Buffer) => bytes.subarray(0, 4).toString("latin1");

test.describe("the preview route", () => {
  test("a draft previews as the persona and is tagged a preview", async ({
    playwright,
    baseURL,
  }) => {
    const draft = pick(
      await versions(),
      "open draft in Coral Offers with web on",
      (v) =>
        v.state === "draft" &&
        v.teamId === "coral-offers" &&
        v.channels.includes("web"),
    );
    const cid = correlation("preview-draft");
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (request) => {
      // A consumer header is not a say in who previews: it is ignored, even one that names nobody registered.
      const { res } = await preview(request, {
        templateId: draft.templateId,
        correlationId: cid,
        headers: { "X-Consumer-Id": "acme" },
        body: {
          version: "draft",
          channel: "web",
          values: validValues(draft.variables),
        },
      });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("text/html; charset=utf-8");
      expect(res.headers()["x-stencil-preview"]).toBe("true");
      expect(res.headers()["x-stencil-version"]).toBe("draft");
      expect(res.headers()["x-stencil-template-id"]).toBe(draft.templateId);
      expect(res.headers()["cache-control"]).toBe("no-store");
      expect(res.headers()["x-correlation-id"]).toBe(cid);
      expect(await res.text()).toMatch(/<!doctype html>/i);
    });

    const rows = await renderLogFor(cid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      templateId: draft.templateId,
      versionId: draft.id,
      versionNumber: null,
      channel: "web",
      isPreview: true,
      consumerId: null,
      outcome: "ok",
      errorCode: null,
    });
  });

  test("a draft's PDF preview is named for the draft", async ({
    playwright,
    baseURL,
  }) => {
    const draft = pick(
      await versions(),
      "open draft in Coral Offers with pdf on",
      (v) =>
        v.state === "draft" &&
        v.teamId === "coral-offers" &&
        v.channels.includes("pdf"),
    );
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (request) => {
      const { res } = await preview(request, {
        templateId: draft.templateId,
        body: {
          version: "draft",
          channel: "pdf",
          values: validValues(draft.variables),
        },
      });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("application/pdf");
      expect(res.headers()["content-disposition"]).toBe(
        `inline; filename="${draft.templateId}-draft.pdf"`,
      );
      expect(res.headers()["x-stencil-preview"]).toBe("true");
      expect(pdfMagic(await res.body())).toBe("%PDF");
    });
  });

  test("any state previews: in review, revoked and Superseded skip the version rules", async ({
    playwright,
    baseURL,
  }) => {
    const all = await versions();
    const unreleased = [
      pick(
        all,
        "Coral Offers version in review",
        (v) => v.state === "in_review" && v.teamId === "coral-offers",
      ),
      pick(
        all,
        "Coral Offers revoked version",
        (v) => v.state === "revoked" && v.teamId === "coral-offers",
      ),
      pick(
        all,
        "Coral Offers Superseded version with an Active successor",
        (v) =>
          v.state === "superseded" &&
          v.teamId === "coral-offers" &&
          v.activeNumber !== null,
      ),
    ];
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (request) => {
      for (const v of unreleased) {
        const cid = correlation(`preview-${v.state}`);
        const { res } = await preview(request, {
          templateId: v.templateId,
          correlationId: cid,
          body: {
            version: v.number,
            channel: v.channels[0],
            values: validValues(v.variables),
          },
        });
        expect(res.status(), v.state).toBe(200);
        expect(res.headers()["x-stencil-preview"], v.state).toBe("true");
        expect(res.headers()["x-stencil-version"], v.state).toBe(
          String(v.number),
        );
        // A Superseded version still points to the version that replaced it.
        expect(res.headers()["x-stencil-newer-version"], v.state).toBe(
          v.state === "superseded" ? String(v.activeNumber) : undefined,
        );
        expect((await renderLogFor(cid))[0], v.state).toMatchObject({
          isPreview: true,
          consumerId: null,
          outcome: "ok",
        });
      }
    });
  });

  test("a preview still checks the version's channels and the values", async ({
    playwright,
    baseURL,
  }) => {
    const draft = pick(
      await versions(),
      "open draft in Coral Offers without email",
      (v) =>
        v.state === "draft" &&
        v.teamId === "coral-offers" &&
        !v.channels.includes("email"),
    );
    const enabled = DOCUMENT_CHANNELS.filter((c) => draft.channels.includes(c));
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (request) => {
      const notEnabled = await preview(request, {
        templateId: draft.templateId,
        body: {
          version: "draft",
          channel: "email",
          values: validValues(draft.variables),
        },
      });
      await expectError(
        notEnabled.res,
        422,
        "channel_not_enabled",
        `This draft doesn't render to Email. Its channels are ${andList(enabled.map((c) => LABEL[c]))}.`,
      );

      const missing = await preview(request, {
        templateId: draft.templateId,
        body: { version: "draft", channel: "web", values: {} },
      });
      await expectError(
        missing.res,
        422,
        "missing_variables",
        `Missing required variables: ${required(draft)
          .map((x) => x.key)
          .join(", ")}.`,
      );
    });
  });

  test("a person who can't see the template's team gets a 403 preview_forbidden, and it is logged as a preview", async ({
    playwright,
    baseURL,
  }) => {
    const all = await versions();
    const deposits = pick(
      all,
      "open draft in Deposits",
      (v) => v.state === "draft" && v.teamId === "deposits",
    );
    const coral = pick(
      all,
      "open draft in Coral Offers",
      (v) => v.state === "draft" && v.teamId === "coral-offers",
    );

    for (const [persona, draft] of [
      [PERSONA_CANNOT_SEE_DEPOSITS, deposits],
      [PERSONA_WITH_NO_TEAM, coral],
    ] as const) {
      const cid = correlation(`forbidden-${persona}`);
      await asPersona(playwright, baseURL!, persona, async (request) => {
        const { res } = await preview(request, {
          templateId: draft.templateId,
          correlationId: cid,
          body: {
            version: "draft",
            channel: "web",
            values: validValues(draft.variables),
          },
        });
        await expectError(
          res,
          403,
          "preview_forbidden",
          "You can't preview this template.",
        );
        expect(res.headers()["x-stencil-preview"]).toBeUndefined();
      });
      const rows = await renderLogFor(cid);
      expect(rows, persona).toHaveLength(1);
      expect(rows[0], persona).toMatchObject({
        isPreview: true,
        consumerId: null,
        outcome: "error",
        errorCode: "preview_forbidden",
      });
    }
  });

  test("a push previews for the platform asked, and the log row names the phone and no value", async ({
    playwright,
    baseURL,
  }) => {
    const alert = pick(
      await allVersions(),
      "Active Coral Offers alert with push and SMS on",
      (v) =>
        v.state === "active" &&
        v.teamId === "coral-offers" &&
        v.channels.includes("push") &&
        v.channels.includes("sms"),
    );
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (request) => {
      for (const platform of ["ios", "android"] as const) {
        const cid = correlation(`preview-push-${platform}`);
        const { res } = await preview(request, {
          templateId: alert.templateId,
          correlationId: cid,
          body: {
            version: alert.number,
            channel: "push",
            platform,
            values: validValues(alert.variables),
          },
        });
        expect(res.status(), platform).toBe(200);
        expect(res.headers()["x-stencil-preview"], platform).toBe("true");
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.payloadBytes, platform).toEqual(expect.any(Number));
        // The subtitle is the iPhone's alone.
        if (platform === "android") expect(body).not.toHaveProperty("subtitle");
        expect((await renderLogFor(cid))[0], platform).toMatchObject({
          isPreview: true,
          consumerId: null,
          channel: "push",
          platform,
          outcome: "ok",
        });
      }
      // A push asks for its platform; without it nothing is logged.
      const cid = correlation("preview-push-none");
      const { res } = await preview(request, {
        templateId: alert.templateId,
        correlationId: cid,
        body: {
          version: alert.number,
          channel: "push",
          values: validValues(alert.variables),
        },
      });
      await expectError(
        res,
        400,
        "bad_request",
        "platform must be ios or android.",
      );
      expect(await renderLogFor(cid)).toHaveLength(0);
    });
  });

  test("no variable value is ever in render_log, previews included", async ({
    playwright,
    baseURL,
  }) => {
    const SENTINEL = "Zyxwvut-Sentinel";
    const draft = pick(
      await versions(),
      "open draft in Coral Offers with web on",
      (v) =>
        v.state === "draft" &&
        v.teamId === "coral-offers" &&
        v.channels.includes("web"),
    );
    const wrongOnDraft = required(draft).find((x) => x.type !== "text")!;
    const values = (overrides: Record<string, unknown> = {}) => ({
      ...Object.fromEntries(
        draft.variables.map((x) => [
          x.key,
          x.type === "text" ? SENTINEL : validValues([x])[x.key],
        ]),
      ),
      ...overrides,
    });
    const sent: string[] = [];
    await asPersona(playwright, baseURL!, PERSONA_CAN_SEE, async (request) => {
      for (const [what, body, status] of [
        ["ok", values(), 200],
        ["invalid", values({ [wrongOnDraft.key]: `${SENTINEL}-wrong` }), 422],
      ] as const) {
        const cid = correlation(`sentinel-${what}`);
        const { res } = await preview(request, {
          templateId: draft.templateId,
          correlationId: cid,
          body: { version: "draft", channel: "web", values: body },
        });
        expect(res.status(), what).toBe(status);
        if (status === 200)
          expect(
            await res.text(),
            "the value did go through the renderer",
          ).toContain(SENTINEL);
        sent.push(cid);
      }
    });
    for (const cid of sent) {
      const rows = await renderLogFor(cid);
      expect(rows, cid).toHaveLength(1);
      expect(Object.keys(rows[0]).sort(), cid).toEqual([...LOG_FIELDS].sort());
      expect(JSON.stringify(Object.values(rows[0])), cid).not.toContain(
        "Zyxwvut",
      );
    }
  });
});
