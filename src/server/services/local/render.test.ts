import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@/domain/types";
import type { RequestContext } from "@/server/context/request";
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
import type { PreviewRequest, RenderResult } from "../render";
import { localServices } from "./index";

// Stencil's preview on this app's database (`render.preview`): the render pipeline with `preview: true`, for the
// context's viewer and under its correlation id, against the real seed on a database of its own per test. The
// pipeline's own cases are in ./render/render-template.test.ts; the preview route's HTTP is tested on facts beside
// it. The preview is a read no contract case needs, so the fake doesn't render (decision 0072's slim fake).
//
// Seed facts used: Maya is an Author on Coral Offers, Eli an Author on Deposits only, Morgan has no team. Annual Fee
// Waiver (Coral Offers) has an open draft; Cash Back has v1 Superseded, v2 Active, v3 In review; Balance Transfer
// has v2 Active.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-local-render-");
});

const NOW = new Date("2026-10-04T12:00:00.000Z");
const ids = seededDatabasePerTest({ base: NOW });
const services = localServices({ clock: async () => NOW });
let db: Db;

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

const CUSTOMER = {
  first_name: "Maya",
  last_name: "Chen",
  purchase_apr: "21.99",
  home_state: "NJ",
};
const FEE = { ...CUSTOMER, annual_fee: "95" };

let counter = 0;
async function preview(
  userId: string,
  input: Partial<PreviewRequest> & { template: string },
) {
  const correlationId = `pv_${++counter}`;
  const ctx: RequestContext = {
    viewer: await loadPersona(db, userId),
    correlationId,
    credential: { kind: "in_process", userId },
  };
  const { template, ...rest } = input;
  const result = await services.render.preview(ctx, {
    templateId: ids[template] ?? template,
    version: 1,
    channel: "web",
    values: CUSTOMER,
    ...rest,
  });
  const rows = await db
    .select()
    .from(renderLog)
    .where(eq(renderLog.correlationId, correlationId));
  return { result, rows };
}

function ok(result: RenderResult) {
  if (!result.ok)
    throw new Error(
      `expected ok, got ${result.error.code}: ${result.error.message}`,
    );
  return result;
}

describe("render.preview on the database", () => {
  it("previews the open draft for the context's viewer, logged as a preview under the context's correlation id", async () => {
    const { result, rows } = await preview("maya", {
      template: "annual-fee-waiver",
      version: "draft",
      channel: "pdf",
    });
    const out = ok(result);
    expect(out.versionNumber).toBeNull();
    expect(out.filename).toBe(`${ids["annual-fee-waiver"]}-draft.pdf`);
    expect(
      Buffer.from((out.body as Uint8Array).slice(0, 5)).toString("latin1"),
    ).toBe("%PDF-");
    expect(rows).toEqual([
      expect.objectContaining({
        at: NOW,
        isPreview: true,
        consumerId: null,
        versionNumber: null,
        channel: "pdf",
        platform: null,
        outcome: "ok",
      }),
    ]);
  }, 30_000);

  it("previews a version in review, which the consumer API never serves, and a Superseded one naming its successor", async () => {
    expect(
      ok(
        (
          await preview("maya", {
            template: "cash-back",
            version: 3,
            values: FEE,
          })
        ).result,
      ).versionNumber,
    ).toBe(3);
    expect(
      ok(
        (
          await preview("maya", {
            template: "cash-back",
            version: 1,
            values: FEE,
          })
        ).result,
      ).newerVersion,
    ).toBe(2);
  });

  it("previews a round, labelled in the filename", async () => {
    const out = ok(
      (
        await preview("maya", {
          template: "cash-back",
          version: 3,
          round: 1,
          channel: "pdf",
          values: FEE,
        })
      ).result,
    );
    expect(out.filename).toBe(`${ids["cash-back"]}-v3-round-1.pdf`);
  }, 30_000);

  it("refuses preview_forbidden to a person outside the template's team, logged as a preview", async () => {
    for (const userId of ["morgan", "eli"]) {
      const { result, rows } = await preview(userId, {
        template: "balance-transfer",
        version: 2,
      });
      expect(result).toEqual({
        ok: false,
        error: {
          code: "preview_forbidden",
          message: "You can't preview this template.",
        },
      });
      expect(rows).toEqual([
        expect.objectContaining({
          isPreview: true,
          consumerId: null,
          outcome: "error",
          errorCode: "preview_forbidden",
        }),
      ]);
    }
  });

  it("answers a version or template that isn't there 404, unlogged", async () => {
    const none = await preview("maya", {
      template: "balance-transfer",
      version: 99,
    });
    expect(!none.result.ok && none.result.error.code).toBe("version_not_found");
    const gone = await preview("maya", { template: "UC-ZZZZZZ" });
    expect(!gone.result.ok && gone.result.error.code).toBe(
      "template_not_found",
    );
    expect([...none.rows, ...gone.rows]).toEqual([]);
  });
});

describe("render.preview on the database: push and SMS", () => {
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
  const FOOTER = "Coral: Reply STOP to opt out, HELP for help.";

  beforeEach(async () => {
    // An alert with an Active version and an open draft, made from a seeded version's row.
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
      teamId: "t_coral",
      contentTypeId: "ct_alert",
      createdBy: "maya",
      createdAt: NOW,
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
      smsFooter: FOOTER,
    });
    await db.insert(versions).values({
      ...alert,
      id: "v_alert_draft",
      number: null,
      state: "draft",
      smsFooter: null,
    });
  });

  it("a push for a platform: the iPhone's subtitle, never Android's, each logged with its platform", async () => {
    const ios = await preview("maya", {
      template: ALERT_ID,
      channel: "push",
      platform: "ios",
      values: VALUES,
    });
    expect(ok(ios.result).body).toMatchObject({
      title: "Payment due",
      subtitle: "Coral Card",
      body: "Hi Maya, your payment of $35.00 is due.",
    });
    const android = await preview("maya", {
      template: ALERT_ID,
      channel: "push",
      platform: "android",
      values: VALUES,
    });
    expect(ok(android.result).body).not.toHaveProperty("subtitle");
    expect([...ios.rows, ...android.rows]).toEqual([
      expect.objectContaining({
        isPreview: true,
        channel: "push",
        platform: "ios",
      }),
      expect.objectContaining({
        isPreview: true,
        channel: "push",
        platform: "android",
      }),
    ]);
  });

  it("the open draft's SMS takes the content type's footer as it stands; a released version keeps its own", async () => {
    const NEW = "Coral: Reply STOP to end, HELP for help.";
    await db
      .update(contentTypes)
      .set({ smsFooter: NEW })
      .where(eq(contentTypes.id, "ct_alert"));
    const draft = await preview("maya", {
      template: ALERT_ID,
      version: "draft",
      channel: "sms",
      values: VALUES,
    });
    expect((ok(draft.result).body as { text: string }).text).toBe(
      `Coral Offers: $35.00 is due.\n${NEW}`,
    );
    const active = await preview("maya", {
      template: ALERT_ID,
      channel: "sms",
      values: VALUES,
    });
    expect((ok(active.result).body as { text: string }).text).toBe(
      `Coral Offers: $35.00 is due.\n${FOOTER}`,
    );
  });

  it("an alert doesn't render to PDF: its content type is messages", async () => {
    const { result } = await preview("maya", {
      template: ALERT_ID,
      channel: "pdf",
      values: VALUES,
    });
    expect(!result.ok && result.error.code).toBe("channel_not_allowed");
  });
});
