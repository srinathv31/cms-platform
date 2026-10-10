import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { Extension, Node as TipTapNode, getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sunsetDay, sunsetInstant, todayIn } from "@/domain/business-zone";
import { ALL_CHANNEL_FIELDS, channelFieldValue, normalizeAndCheckChannelField, type ChannelFields } from "@/domain/channel-fields";
import type { JSONContent } from "@/domain/types";
import * as ucomp from "@/server/db/schema/ucomp";
import * as sim from "@/server/db/schema/sim";
import { TEMPLATE_ID_PATTERN, newId, newTemplateId, seededId, seededTemplateId } from "@/server/ids";
import { trySubmit } from "@/server/testing/submit-check";
import { seedDatabase, type SeedResult } from "./index";
import { mulberry32 } from "./rng";

const DAY = 86_400_000;
const REQUIRED = ["offer_details", "rates_and_fees", "legal_notices"];
const ALERTS = ["payment-due-reminder", "card-used-abroad", "rate-change-heads-up"];
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "table",
  "callout",
  "horizontalRule",
]);
const ALL_NODE_TYPES = new Set([
  "doc",
  ...BLOCK_TYPES,
  "text",
  "variable",
  "listItem",
  "tableRow",
  "tableHeader",
  "tableCell",
]);
const MARKS = new Set(["bold", "italic", "underline", "link"]);

// A stand-in for the editor's schema (src/editor/schema.ts): the contract's blocks and attributes.
const contractSchema = getSchema([
  StarterKit,
  TableKit,
  TipTapNode.create({ name: "callout", group: "block", content: "paragraph+" }),
  TipTapNode.create({
    name: "variable",
    group: "inline",
    inline: true,
    atom: true,
    addAttributes: () => ({ key: { default: null } }),
  }),
  Extension.create({
    name: "blockIds",
    addGlobalAttributes: () => [
      {
        types: ["paragraph", "heading", "bulletList", "orderedList", "table", "callout", "horizontalRule"],
        attributes: { id: { default: null } },
      },
      { types: ["heading"], attributes: { requiredKey: { default: null } } },
    ],
  }),
]);

const dirs: string[] = [];

async function freshDb(base: Date) {
  const dir = mkdtempSync(join(tmpdir(), "ucomp-seed-"));
  dirs.push(dir);
  const client: Client = createClient({ url: `file:${join(dir, "seed.db")}` });
  const db = drizzle(client, { schema: ucomp });
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  const result = await seedDatabase(db, { base });
  return { client, db, result };
}

function walk(node: JSONContent, visit: (n: JSONContent) => void) {
  visit(node);
  node.content?.forEach((child) => walk(child, visit));
}

/** Every channel field a version has a value for. */
const fieldDocs = (fields: ChannelFields): JSONContent[] =>
  ALL_CHANNEL_FIELDS.flatMap((field) => channelFieldValue(fields, field) ?? []);

const base = new Date();
let db: Awaited<ReturnType<typeof freshDb>>["db"];
let client: Client;
let result: SeedResult;

let users: (typeof ucomp.users.$inferSelect)[];
let teams: (typeof ucomp.teams.$inferSelect)[];
let templates: (typeof ucomp.templates.$inferSelect)[];
let versions: (typeof ucomp.versions.$inferSelect)[];

const tpl = (key: string) => {
  const id = result.templates[key];
  if (!id) throw new Error(`no template ${key}`);
  return id;
};
const versionsOf = (key: string) => versions.filter((v) => v.templateId === tpl(key));
/** The versions of templates on one content type. */
const versionsOn = (contentTypeId: string) => {
  const ids = new Set(templates.filter((t) => t.contentTypeId === contentTypeId).map((t) => t.id));
  return versions.filter((v) => ids.has(v.templateId));
};
const version = (key: string, n: number | null) => {
  const found = versionsOf(key).find((v) => v.number === n);
  if (!found) throw new Error(`no ${key} v${n}`);
  return found;
};

beforeAll(async () => {
  ({ client, db, result } = await freshDb(base));
  users = await db.select().from(ucomp.users);
  teams = await db.select().from(ucomp.teams);
  templates = await db.select().from(ucomp.templates);
  versions = await db.select().from(ucomp.versions);
}, 60_000);

afterAll(() => {
  client?.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("ids", () => {
  it("makes copy-friendly template ids", () => {
    expect(newTemplateId()).toMatch(TEMPLATE_ID_PATTERN);
    expect(seededTemplateId(mulberry32(1))).toMatch(TEMPLATE_ID_PATTERN);
    expect(newId("th")).toMatch(/^th_[0-9a-hjkmnp-tv-z]{10}$/);
    expect(seededId(mulberry32(7), "v")).toBe(seededId(mulberry32(7), "v"));
  });

  it("gives every seeded template a valid, unique id", () => {
    expect(templates.length).toBe(14);
    for (const t of templates) expect(t.id).toMatch(TEMPLATE_ID_PATTERN);
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
  });
});

describe("people, teams and access", () => {
  it("has the nine personas with the fixed ids (the build plan's eight, plus Dana Park in Phase 6)", () => {
    const personas = users.filter((u) => u.isPersona).map((u) => u.id).sort();
    expect(personas).toEqual(["alex", "dana", "jordan", "maya", "morgan", "priya", "riley", "sam", "taylor"]);
    expect(users.find((u) => u.id === "riley")?.platformRole).toBe("platform_admin");
    expect(users.find((u) => u.id === "taylor")?.platformRole).toBe("auditor");
    expect(users.find((u) => u.id === "maya")?.name).toBe("Maya Chen");
  });

  it("has the three teams, with slugs as ids", () => {
    expect(teams.map((t) => t.id).sort()).toEqual(["card-statements", "coral-offers", "deposits"]);
    for (const t of teams) expect(t.slug).toBe(t.id);
  });

  it("matches the persona table in the build plan", async () => {
    const members = await db.select().from(ucomp.memberships);
    const roles = await db.select().from(ucomp.membershipRoles);
    const byUser = new Map<string, string[]>();
    for (const m of members) {
      const r = roles.filter((x) => x.membershipId === m.id).map((x) => x.role).sort();
      byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), `${m.teamId}:${r.join("+")}`].sort());
    }
    expect(byUser.get("maya")).toEqual(["coral-offers:author"]);
    expect(byUser.get("jordan")).toEqual(["coral-offers:approver"]);
    expect(byUser.get("alex")).toEqual(["coral-offers:approver+team_admin"]);
    expect(byUser.get("priya")).toEqual(["coral-offers:author", "deposits:viewer"]);
    expect(byUser.get("sam")).toEqual(["coral-offers:viewer"]);
    expect(byUser.get("dana")).toEqual(["coral-offers:viewer"]);
    for (const none of ["riley", "taylor", "morgan"]) expect(byUser.has(none)).toBe(false);

    // Card Statements has no switchable persona; Coral Offers has 7 members (Dana Park joined in Phase 6).
    const personaIds = new Set(users.filter((u) => u.isPersona).map((u) => u.id));
    expect(members.filter((m) => m.teamId === "card-statements").some((m) => personaIds.has(m.userId))).toBe(false);
    expect(members.filter((m) => m.teamId === "coral-offers")).toHaveLength(7);
  });

  it("seeds the inactivity story and the stretch persona", () => {
    const devon = users.find((u) => u.id === "devon");
    const lastActive = devon?.lastActiveAt?.getTime() ?? 0;
    expect(Math.abs(base.getTime() - lastActive - 95 * DAY)).toBeLessThan(2 * 3_600_000);
    expect(users.find((u) => u.id === "dana")?.isPersona).toBe(true);
    expect(users.find((u) => u.id === "chris")?.name).toBe("Chris Morales");
  });

  it("flags Devon for inactivity 5 days ago, and nobody else", async () => {
    const members = await db.select().from(ucomp.memberships);
    const flagged = members.filter((m) => m.inactivityFlaggedAt !== null);
    expect(flagged.map((m) => m.userId)).toEqual(["devon"]);
    expect(flagged[0].inactivityFlaggedAt?.getTime()).toBe(base.getTime() - 5 * DAY);
    for (const m of members) expect(m).toMatchObject({ status: "active", statusReason: null, inactivityKeptAt: null });
    const events = (await db.select().from(ucomp.auditEvents)).filter((e) => e.action === "access.flagged_inactive");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: null, teamId: "coral-offers" });
  });

  it("configures the Disclosure and Alert content types, each with a single approval stage", async () => {
    const types = await db.select().from(ucomp.contentTypes);
    expect(types.map((t) => t.key)).toEqual(["disclosure", "alert"]);
    const [disclosure, alert] = types;
    expect(disclosure!.requiredSections.map((s) => s.key)).toEqual(REQUIRED);
    expect(disclosure!.allowedChannels).toEqual(["pdf", "web", "email"]);
    expect(disclosure!.smsFooter).toBeNull();
    // An Alert is a message: Push and SMS, no document and so no sections, and every SMS ends with the footer.
    expect(alert).toMatchObject({
      name: "Alert",
      requiredSections: [],
      allowedChannels: ["push", "sms"],
      smsFooter: "Coral Offers: Reply STOP to opt out, HELP for help.",
      smsMaxParts: 3,
    });
    const stages = await db.select().from(ucomp.approvalStages);
    expect(stages).toHaveLength(2);
    for (const stage of stages) {
      expect(stage).toMatchObject({ position: 0, name: "Team approver", approverRule: { kind: "team_role", role: "approver" } });
    }
    expect(stages.map((s) => s.contentTypeId)).toEqual(["ct_disclosure", "ct_alert"]);
    const consumers = await db.select().from(ucomp.consumers);
    expect(consumers.map((c) => c.id).sort()).toEqual(["coral", "deposits-online"]);
  });

  it("gives Coral Offers the app name and short code its messages come from", async () => {
    const rows = await db.select({ id: ucomp.teams.id, appName: ucomp.teams.appName, smsSender: ucomp.teams.smsSender }).from(ucomp.teams);
    expect(rows.find((t) => t.id === "coral-offers")).toEqual({ id: "coral-offers", appName: "Coral", smsSender: "26725" });
    expect(rows.filter((t) => t.id !== "coral-offers").every((t) => t.appName === null && t.smsSender === null)).toBe(true);
  });
});

describe("lifecycle states", () => {
  it("shows every state among the Coral Offers versions", () => {
    const coralTemplates = new Set(templates.filter((t) => t.teamId === "coral-offers").map((t) => t.id));
    const states = new Set(versions.filter((v) => coralTemplates.has(v.templateId)).map((v) => v.state));
    expect([...states].sort()).toEqual(
      ["active", "changes_requested", "draft", "in_review", "revoked", "superseded"],
    );
  });

  it("has at most one draft and one active version per template", () => {
    for (const t of templates) {
      const own = versions.filter((v) => v.templateId === t.id);
      expect(own.filter((v) => v.state === "draft").length).toBeLessThanOrEqual(1);
      expect(own.filter((v) => v.state === "active").length).toBeLessThanOrEqual(1);
    }
  });

  it("numbers versions only after submit, once each", () => {
    for (const t of templates) {
      const numbers = versions
        .filter((v) => v.templateId === t.id && v.state !== "draft")
        .map((v) => v.number)
        .sort();
      numbers.forEach((n, i) => expect(n).toBe(i + 1));
    }
    for (const v of versions.filter((x) => x.state === "draft")) expect(v.number).toBeNull();
  });

  it("matches the five Coral templates in the build plan", () => {
    const states = (key: string) => versionsOf(key).map((v) => `${v.number ?? "draft"}:${v.state}`).sort();
    expect(states("balance-transfer")).toEqual(["1:superseded", "2:active"]);
    expect(states("cash-back")).toEqual(["1:superseded", "2:active", "3:in_review"]);
    expect(states("annual-fee-waiver")).toEqual(["1:changes_requested", "draft:draft"]);
    expect(states("holiday-points")).toEqual(["1:revoked", "2:active"]);
    expect(states("rate-change-notice")).toEqual(["1:active"]);
    expect(templates.find((t) => t.id === tpl("rate-change-notice"))?.starterKey).toBe("rate_change_notice");
  });

  it("gives Coral Offers three alerts, on the Alert content type: Active, In review and a Draft", () => {
    const states = (key: string) => versionsOf(key).map((v) => `${v.number ?? "draft"}:${v.state}`);
    expect(states("payment-due-reminder")).toEqual(["1:active"]);
    expect(states("card-used-abroad")).toEqual(["1:in_review"]);
    expect(states("rate-change-heads-up")).toEqual(["draft:draft"]);
    for (const key of ALERTS) {
      const template = templates.find((t) => t.id === tpl(key))!;
      expect(template).toMatchObject({ teamId: "coral-offers", contentTypeId: "ct_alert" });
      for (const v of versionsOf(key)) expect(v.channels).toEqual(["push", "sms"]);
    }
    expect(versionsOf("payment-due-reminder")[0]).toMatchObject({ name: "Payment Due Reminder", stages: [{ id: "stage_alert_0" }] });
    expect(templates.find((t) => t.id === tpl("payment-due-reminder"))?.starterKey).toBe("payment_reminder");
    expect(templates.find((t) => t.id === tpl("card-used-abroad"))?.starterKey).toBe("card_activity");
    // Only alerts are on the Alert content type, and every other template is a document.
    expect(new Set(versionsOn("ct_alert").map((v) => v.templateId)).size).toBe(3);
    for (const v of versionsOn("ct_disclosure")) expect(v.channels.every((c) => ["pdf", "web", "email"].includes(c))).toBe(true);
  });

  it("gives Deposits and Card Statements templates in Active and Draft", () => {
    for (const team of ["deposits", "card-statements"]) {
      const ids = new Set(templates.filter((t) => t.teamId === team).map((t) => t.id));
      expect(ids.size).toBeGreaterThanOrEqual(2);
      const states = new Set(versions.filter((v) => ids.has(v.templateId)).map((v) => v.state));
      expect(states.has("active")).toBe(true);
      expect(states.has("draft")).toBe(true);
    }
  });

  it("sets the sunset 21 days out, by Jordan, on Balance Transfer v1: 00:00 Eastern on that day", () => {
    const v1 = version("balance-transfer", 1);
    expect(v1.sunsetSetBy).toBe("jordan");
    const day = todayIn(new Date(base.getTime() + 21 * DAY), "America/New_York");
    expect(v1.sunsetAt).toEqual(sunsetInstant(day, "America/New_York"));
    expect(sunsetDay(v1.sunsetAt!, "America/New_York")).toBe(day);
    expect(version("balance-transfer", 2).sunsetAt).toBeNull();
    expect(version("cash-back", 1).sunsetAt).toBeNull();
  });

  it("records the Holiday Points revoke with two different approvers", async () => {
    const v1 = version("holiday-points", 1);
    expect(v1.revoke).toMatchObject({ reason: "Wrong bonus amount", startedBy: "jordan", confirmedBy: "alex" });
    expect(v1.revoke?.confirmedAt).toBeTruthy();
    expect(v1.revoke?.startedBy).not.toBe(v1.revoke?.confirmedBy);
  });

  it("keeps the maker-checker rule: nobody approves what they submitted or wrote", async () => {
    const approvals = await db.select().from(ucomp.approvals);
    expect(approvals.length).toBeGreaterThan(0);
    for (const a of approvals) {
      const v = versions.find((x) => x.id === a.versionId)!;
      expect(a.actorId).not.toBe(v.submittedBy);
      expect(v.writers).not.toContain(a.actorId);
    }
  });

  it("records who wrote each version: its creator and submitter, and a returned round's writers in its draft", () => {
    for (const v of versions) {
      expect(v.writers).toContain(v.createdBy);
      if (v.submittedBy) expect(v.writers).toContain(v.submittedBy);
    }
    expect(version("annual-fee-waiver", null).writers).toEqual(version("annual-fee-waiver", 1).writers);
    // Cash Back v3 was copied from the Active v2: it starts afresh.
    expect(version("cash-back", 3).writers).toEqual(["maya"]);
  });

  it("gives frozen versions the timestamps their state implies", () => {
    for (const v of versions) {
      if (["active", "superseded", "revoked"].includes(v.state)) expect(v.activatedAt).toBeTruthy();
      if (["superseded", "revoked"].includes(v.state) && v.revoke === null) expect(v.supersededAt).toBeTruthy();
      if (v.state !== "draft") expect(v.submittedAt).toBeTruthy();
      expect(v.createdAt.getTime()).toBeLessThanOrEqual(base.getTime());
      expect(v.updatedAt.getTime()).toBeLessThanOrEqual(base.getTime());
    }
  });

  it("puts the breaking annual_fee change on Cash Back v3, submitted by Maya", () => {
    const v3 = version("cash-back", 3);
    expect(v3.submittedBy).toBe("maya");
    expect(v3.contractChanges).toEqual([
      { kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true },
    ]);
    expect(v3.variables.map((v) => v.key)).toContain("annual_fee");
    expect(version("cash-back", 2).variables.map((v) => v.key)).not.toContain("annual_fee");
  });
});

describe("bodies", () => {
  it("gives every top-level block a unique id", () => {
    for (const v of versions) {
      const blocks = v.body.content ?? [];
      expect(blocks.length).toBeGreaterThan(0);
      const ids = blocks.map((b) => b.attrs?.id);
      for (const id of ids) expect(typeof id === "string" && id.length > 0).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      for (const b of blocks) expect(BLOCK_TYPES.has(b.type!)).toBe(true);
    }
  });

  it("parses as valid TipTap documents under the contract schema", () => {
    for (const v of versions) {
      for (const doc of [v.body, ...fieldDocs(v.channelFields)]) {
        if (doc) expect(() => PMNode.fromJSON(contractSchema, doc).check()).not.toThrow();
      }
    }
  });

  it("keeps the ids of surviving blocks stable between versions", () => {
    const ids = (n: number) => new Set((version("cash-back", n).body.content ?? []).map((b) => b.attrs?.id));
    const v2 = ids(2);
    const shared = [...ids(3)].filter((id) => v2.has(id));
    expect(shared.length).toBeGreaterThan(8);
  });

  it("declares every variable that the body and the channel fields use", () => {
    for (const v of versions) {
      const declared = new Set(v.variables.map((x) => x.key));
      for (const doc of [v.body, ...fieldDocs(v.channelFields)]) {
        if (!doc) continue;
        walk(doc, (n) => {
          if (n.type === "variable") {
            expect(Object.keys(n.attrs ?? {})).toEqual(["key"]);
            expect(declared.has(n.attrs!.key)).toBe(true);
          }
        });
      }
    }
  });

  it("has the required sections as ordered H2s in every disclosure", () => {
    for (const v of versionsOn("ct_disclosure")) {
      const required = (v.body.content ?? []).filter((b) => b.type === "heading" && b.attrs?.requiredKey);
      expect(required.map((b) => b.attrs!.requiredKey)).toEqual(REQUIRED);
      for (const h of required) expect(h.attrs!.level).toBe(2);
    }
  });

  it("gives every alert a body of one empty paragraph: nothing renders from it", () => {
    const alerts = versionsOn("ct_alert");
    expect(alerts).toHaveLength(3);
    for (const v of alerts) {
      expect(v.body.content).toHaveLength(1);
      expect(v.body.content?.[0]).toEqual({ type: "paragraph", attrs: { id: expect.stringMatching(/^b_/) } });
    }
  });

  it("stores every channel field as a save would: normalized for its shape, nothing to refuse", () => {
    for (const v of versions) {
      for (const field of ALL_CHANNEL_FIELDS) {
        const value = channelFieldValue(v.channelFields, field);
        if (!value) continue;
        const checked = normalizeAndCheckChannelField(field, value);
        expect(checked.problem, `${v.name} ${field.id}`).toBeNull();
        expect(checked.doc, `${v.name} ${field.id}`).toEqual(value);
      }
    }
  });

  it("uses only node and mark types from the contract", () => {
    const seen = new Set<string>();
    for (const v of versions) {
      walk(v.body, (n) => {
        expect(ALL_NODE_TYPES.has(n.type!)).toBe(true);
        seen.add(n.type!);
        for (const m of n.marks ?? []) expect(MARKS.has(m.type)).toBe(true);
      });
    }
    // The set shows every block kind the editor supports.
    for (const type of ["table", "bulletList", "orderedList", "callout", "horizontalRule", "variable"]) {
      expect(seen.has(type)).toBe(true);
    }
  });

  it("puts a callout in Legal notices and a table in Rates and fees", () => {
    const v = version("cash-back", 2);
    const blocks = v.body.content ?? [];
    const at = (key: string) => blocks.findIndex((b) => b.attrs?.requiredKey === key);
    const between = (from: number, to: number) => blocks.slice(from + 1, to < 0 ? undefined : to).map((b) => b.type);
    expect(between(at("rates_and_fees"), at("legal_notices"))).toContain("table");
    expect(between(at("legal_notices"), -1)).toContain("callout");
  });

  it("has the same variable list as the version's sample sets cover", () => {
    for (const v of versions) {
      expect(v.sampleSets.map((s) => s.id)).toEqual(["typical", "long", "minimum"]);
      for (const set of v.sampleSets) {
        expect(Object.keys(set.values).sort()).toEqual(v.variables.map((x) => x.key).sort());
      }
    }
  });

  it("sets a channel's fields only on versions with that channel, and every required one when it is on", () => {
    for (const v of versions) {
      for (const field of ALL_CHANNEL_FIELDS) {
        const value = channelFieldValue(v.channelFields, field);
        if (value) expect(v.channels, field.id).toContain(field.channel);
        if (field.required && v.channels.includes(field.channel)) expect(value, field.id).toBeTruthy();
      }
    }
  });
});

describe("alerts", () => {
  // Every seeded alert could be submitted as it stands, with the Alert content type's footer and part
  // budget: GSM-7 as typed, within 3 parts with the long sample values, no public shortener, and a push
  // inside 4,096 bytes on both platforms (decisions 0033 and 0034). The draft too, so the demo can submit it.
  it("pass every submit rule, with the Alert content type's footer and part budget", async () => {
    const [alert] = await db.select().from(ucomp.contentTypes).where(eq(ucomp.contentTypes.id, "ct_alert"));
    const rules = { smsFooter: alert!.smsFooter, smsMaxParts: alert!.smsMaxParts };
    for (const v of versionsOn("ct_alert")) {
      expect(trySubmit(v, rules, base), v.name).toMatchObject({ ok: true });
    }
  });

  it("keep variables out of every push title, and show an iPhone-only subtitle on two of them", () => {
    const alerts = versionsOn("ct_alert");
    const keys = (doc: JSONContent | undefined) => {
      const found: string[] = [];
      if (doc) walk(doc, (n) => n.type === "variable" && found.push(n.attrs!.key));
      return found;
    };
    for (const v of alerts) expect(keys(v.channelFields.push?.title), v.name).toEqual([]);
    expect(alerts.filter((v) => v.channelFields.push?.subtitle).map((v) => v.name).sort()).toEqual([
      "Card Used Abroad",
      "Payment Due Reminder",
    ]);
  });

  it("use every variable they declare, in the push or the SMS", () => {
    for (const v of versionsOn("ct_alert")) {
      const used = new Set<string>();
      for (const doc of fieldDocs(v.channelFields)) walk(doc, (n) => n.type === "variable" && used.add(n.attrs!.key));
      expect([...used].sort(), v.name).toEqual(v.variables.map((x) => x.key).sort());
    }
  });
});

describe("comments", () => {
  it("anchors every thread to a real block in its origin version and in the draft", async () => {
    const threads = await db.select().from(ucomp.commentThreads);
    expect(threads.length).toBeGreaterThanOrEqual(3);
    for (const t of threads) {
      const origin = versions.find((v) => v.id === t.originVersionId)!;
      const blocks = (v: typeof origin) => (v.body.content ?? []).map((b) => b.attrs?.id);
      expect(blocks(origin)).toContain(t.blockId);
      for (const draft of versions.filter((v) => v.basedOnVersionId === origin.id && v.state === "draft")) {
        expect(blocks(draft)).toContain(t.blockId);
      }
    }
  });

  it("gives Annual Fee Waiver one resolved and one open thread, with Jordan's change request", async () => {
    const threads = (await db.select().from(ucomp.commentThreads)).filter((t) => t.templateId === tpl("annual-fee-waiver"));
    expect(threads.map((t) => t.status).sort()).toEqual(["open", "resolved"]);
    const comments = await db.select().from(ucomp.comments);
    const change = comments.filter(
      (c) => c.kind === "change_request" && threads.some((t) => t.id === c.threadId),
    );
    expect(change).toHaveLength(1);
    expect(change[0].authorId).toBe("jordan");
  });
});

describe("render history", () => {
  it("stays well under 40k rows and never sits in the future", async () => {
    const rows = await db.select().from(ucomp.renderLog);
    expect(rows.length).toBeGreaterThan(20_000);
    expect(rows.length).toBeLessThan(40_000);
    const newest = Math.max(...rows.map((r) => r.at.getTime()));
    const oldest = Math.min(...rows.map((r) => r.at.getTime()));
    expect(newest).toBeLessThanOrEqual(base.getTime());
    expect(base.getTime() - oldest).toBeLessThanOrEqual(90 * DAY);
    expect(base.getTime() - oldest).toBeGreaterThan(80 * DAY);
  });

  it("holds no customer data: no value columns and no customer names", async () => {
    const info = await client.execute("PRAGMA table_info(render_log)");
    expect(info.rows.map((r) => String(r.name)).sort()).toEqual(
      [
        "at", "channel", "consumer_id", "correlation_id", "duration_ms", "error_code", "id",
        "is_preview", "outcome", "template_id", "version_id", "version_number",
      ].sort(),
    );

    const simCustomers = await db.select().from(sim.simCustomers);
    expect(simCustomers.length).toBeGreaterThanOrEqual(10);

    const rows = await db.select().from(ucomp.renderLog);
    const dump = JSON.stringify(rows);
    for (const c of simCustomers) {
      for (const name of [c.firstName, c.lastName]) {
        if (name.length >= 4) expect(dump).not.toContain(name);
      }
    }
  });

  it("only references real templates, versions and consumers", async () => {
    const rows = await db.select().from(ucomp.renderLog);
    const versionById = new Map(versions.map((v) => [v.id, v]));
    for (const r of rows) {
      const v = versionById.get(r.versionId);
      expect(v?.templateId).toBe(r.templateId);
      if (r.consumerId !== null) expect(["coral", "deposits-online"]).toContain(r.consumerId);
    }
  });

  it("marks previews with no consumer, and has a few errors", async () => {
    const rows = await db.select().from(ucomp.renderLog);
    const previews = rows.filter((r) => r.isPreview);
    expect(previews.length).toBeGreaterThanOrEqual(10);
    for (const p of previews) expect(p.consumerId).toBeNull();
    for (const r of rows.filter((x) => !x.isPreview)) expect(r.consumerId).not.toBeNull();
    const errors = rows.filter((r) => r.outcome === "error");
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.length).toBeLessThan(40);
    for (const e of errors) expect(e.errorCode).toBeTruthy();
  });

  it("has Coral rendering Balance Transfer v1 today and v2 as well", async () => {
    const rows = await db.select().from(ucomp.renderLog);
    const v1 = version("balance-transfer", 1);
    const v2 = version("balance-transfer", 2);
    const last = (id: string) => Math.max(...rows.filter((r) => r.versionId === id && r.consumerId === "coral").map((r) => r.at.getTime()));
    expect(base.getTime() - last(v1.id)).toBeLessThan(DAY);
    expect(base.getTime() - last(v2.id)).toBeLessThan(DAY);
  });

  it("has Coral rendering Payment Due Reminder v1 as push and SMS every day, and nothing else on those channels", async () => {
    const rows = await db.select().from(ucomp.renderLog);
    const v1 = version("payment-due-reminder", 1);
    const mine = rows.filter((r) => r.versionId === v1.id && !r.isPreview && r.outcome === "ok");
    const push = mine.filter((r) => r.channel === "push").length;
    const sms = mine.filter((r) => r.channel === "sms").length;
    expect(push).toBeGreaterThan(1000);
    expect(sms).toBeGreaterThan(700);
    expect(push + sms).toBe(mine.length);
    expect(new Set(mine.map((r) => r.consumerId))).toEqual(new Set(["coral"]));
    expect(Math.min(...mine.map((r) => r.at.getTime()))).toBeGreaterThanOrEqual(v1.activatedAt!.getTime());
    expect(base.getTime() - Math.max(...mine.map((r) => r.at.getTime()))).toBeLessThan(DAY);

    // A version renders only its own channels: messages for alerts, documents for the rest.
    const alertIds = new Set(versionsOn("ct_alert").map((v) => v.id));
    for (const r of rows) {
      expect(["push", "sms"].includes(r.channel), `${r.channel} on ${r.versionId}`).toBe(alertIds.has(r.versionId));
    }
  });

  it("stops Holiday Points v1 renders at the revoke, and renders nothing for unreleased versions as a consumer", async () => {
    const rows = await db.select().from(ucomp.renderLog);
    const v1 = version("holiday-points", 1);
    const mine = rows.filter((r) => r.versionId === v1.id);
    expect(mine.length).toBeGreaterThan(100);
    const revokedAt = new Date(v1.revoke!.confirmedAt!).getTime();
    expect(Math.max(...mine.map((r) => r.at.getTime()))).toBeLessThanOrEqual(revokedAt);

    for (const state of ["draft", "in_review", "changes_requested"]) {
      for (const v of versions.filter((x) => x.state === state)) {
        expect(rows.filter((r) => r.versionId === v.id && !r.isPreview)).toHaveLength(0);
      }
    }
  });
});

describe("notifications, access and audit", () => {
  it("gives Jordan two pending reviews: Cash Back v3, and the Card Used Abroad alert", async () => {
    const pending = [version("cash-back", 3), version("card-used-abroad", 1)];
    const approvals = await db.select().from(ucomp.approvals);
    for (const v of pending) {
      expect(v.state).toBe("in_review");
      expect(v.submittedBy).not.toBe("jordan");
      expect(approvals.filter((a) => a.versionId === v.id)).toHaveLength(0);
    }

    const notes = (await db.select().from(ucomp.notifications)).filter((n) => n.userId === "jordan");
    expect(notes).toHaveLength(2);
    for (const n of notes) expect(n).toMatchObject({ kind: "review_requested", readAt: null, teamId: "coral-offers" });
    expect(notes.map((n) => n.href).sort()).toEqual(
      [`/coral-offers/review/${tpl("card-used-abroad")}/1`, `/coral-offers/review/${tpl("cash-back")}/3`].sort(),
    );

    const waiting = versions.filter((v) => v.state === "in_review" && v.submittedBy !== "jordan");
    expect(waiting.map((v) => v.id).sort()).toEqual(pending.map((v) => v.id).sort());
  });

  it("gives Alex an access request and a recertification due in 30 days", async () => {
    const [request] = await db.select().from(ucomp.accessRequests);
    expect(request).toMatchObject({ userId: "chris", teamId: "coral-offers", role: "author", status: "pending" });

    const [recert] = await db.select().from(ucomp.recertifications);
    expect(recert.teamId).toBe("coral-offers");
    expect(recert.dueAt.getTime()).toBe(base.getTime() + 30 * DAY);
    expect(recert.label).toMatch(/^Q[1-4] \d{4}$/);
    expect(recert.completedAt).toBeNull();

    // Everyone but the Team Admin: Jordan, Maya, Priya, Sam, Devon and Dana.
    const items = await db.select().from(ucomp.recertItems);
    expect(items.map((i) => i.userId).sort()).toEqual(["dana", "devon", "jordan", "maya", "priya", "sam"]);
    for (const i of items) expect(i.decision).toBeNull();

    const kinds = (await db.select().from(ucomp.notifications))
      .filter((n) => n.userId === "alex" && !n.readAt)
      .map((n) => n.kind)
      .sort();
    expect(kinds).toEqual(["access_requested", "recert_due"]);
  });

  it("gives Maya a changes-requested notification, and only Coral Offers people get any", async () => {
    const notes = await db.select().from(ucomp.notifications);
    expect(notes.some((n) => n.userId === "maya" && n.kind === "changes_requested" && !n.readAt)).toBe(true);
    for (const n of notes) expect(["maya", "jordan", "alex", "priya"]).toContain(n.userId);
  });

  it("records an audit event for each lifecycle step", async () => {
    const events = await db.select().from(ucomp.auditEvents);
    const forVersion = (id: string) => events.filter((e) => e.versionId === id).map((e) => e.action);
    expect(forVersion(version("cash-back", 3).id)).toContain("version.submitted");
    expect(forVersion(version("annual-fee-waiver", 1).id)).toContain("version.changes_requested");
    expect(forVersion(version("balance-transfer", 1).id)).toContain("version.sunset_set");
    expect(forVersion(version("holiday-points", 1).id)).toEqual(
      expect.arrayContaining(["version.revoke_started", "version.revoke_confirmed"]),
    );
    for (const v of versions.filter((x) => x.number !== null)) {
      expect(forVersion(v.id)).toContain("version.submitted");
    }
    for (const e of events) expect(e.at.getTime()).toBeLessThanOrEqual(base.getTime());
    expect(events.filter((e) => e.action === "draft.edited").every((e) => e.sessionKey)).toBe(true);
  });

  it("sends consumer notices for new versions, the sunset and the revoke", async () => {
    const notices = await db.select().from(ucomp.consumerNotices);
    const kinds = (templateKey: string) => notices.filter((n) => n.templateId === tpl(templateKey)).map((n) => n.kind).sort();
    expect(kinds("balance-transfer")).toEqual(["new_version", "sunset_scheduled"]);
    expect(kinds("holiday-points")).toEqual(["new_version", "revoked"]);
    expect(kinds("rate-change-notice")).toEqual([]);
  });

  it("starts the clock at offset zero", async () => {
    const rows = await db.select().from(ucomp.settings);
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(settings.clock_offset_days).toBe(0);
    expect(settings.seed_version).toBeTruthy();
  });
});

describe("simulator data", () => {
  it("has Spring Travel Rewards unlinked and three linked offers pinned correctly", async () => {
    const offers = await db.select().from(sim.simOffers);
    const links = await db.select().from(sim.simLinks);
    const spring = offers.find((o) => o.name === "Spring Travel Rewards");
    expect(spring?.headline).toBe("Spend $1,000 in 3 months, get $200 back");
    expect(links.some((l) => l.offerId === spring!.id)).toBe(false);
    expect(links).toHaveLength(3);

    const pinned = Object.fromEntries(links.map((l) => [l.templateId, l.pinnedVersion]));
    expect(pinned[tpl("balance-transfer")]).toBe(1);
    expect(pinned[tpl("cash-back")]).toBe(2);
    expect(pinned[tpl("holiday-points")]).toBe(2);

    for (const l of links) {
      const v = versions.find((x) => x.templateId === l.templateId && x.number === l.pinnedVersion)!;
      expect(["active", "superseded"]).toContain(v.state);
      const mapped = new Set(Object.keys(l.mapping));
      for (const variable of v.variables.filter((x) => x.required)) expect(mapped.has(variable.key)).toBe(true);
      for (const key of mapped) expect(v.variables.map((x) => x.key)).toContain(key);
    }
  });

  it("has about ten customers, including one very long name", async () => {
    const customers = await db.select().from(sim.simCustomers);
    expect(customers.length).toBeGreaterThanOrEqual(10);
    expect(new Set(customers.map((c) => c.homeState)).size).toBeGreaterThanOrEqual(6);
    expect(customers.some((c) => `${c.firstName} ${c.lastName}`.length > 40)).toBe(true);
  });

  it("gives every customer an annual fee and Spring Travel an offer fee and end date (Phase 5 mapping)", async () => {
    const customers = await db.select().from(sim.simCustomers);
    for (const c of customers) expect(c.annualFee).toMatch(/^\d+$/);
    const spring = (await db.select().from(sim.simOffers)).find((o) => o.id === "offer_spring_travel")!;
    expect(spring.terms.annualFee).toBe(95);
    expect(spring.terms.endsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has Coral's seeded notices read, except Balance Transfer v1's sunset", async () => {
    const notices = (await db.select().from(ucomp.consumerNotices)).filter((n) => n.consumerId === "coral");
    const reads = new Set((await db.select().from(sim.simNoticeReads)).map((r) => r.noticeId));
    const unread = notices.filter((n) => !reads.has(n.id));
    expect(unread).toHaveLength(1);
    expect(unread[0].kind).toBe("sunset_scheduled");
    expect(unread[0].templateId).toBe(tpl("balance-transfer"));
    expect(reads.size).toBe(notices.length - 1);
  });
});

describe("determinism", () => {
  it("builds the same structure whatever day the reset runs", async () => {
    const other = await freshDb(new Date(base.getTime() + 37 * DAY));
    try {
      expect(other.result.templates).toEqual(result.templates);
      const otherVersions = await other.db.select().from(ucomp.versions);
      const shape = (rows: typeof versions) =>
        rows
          .map((v) => ({
            id: v.id,
            state: v.state,
            number: v.number,
            body: v.body,
            // Date samples are relative to the base, so compare the contract without them.
            variables: v.variables.map(({ key, label, type, required }) => ({ key, label, type, required })),
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
      expect(shape(otherVersions)).toEqual(shape(versions));

      // Timestamps move with the base; offsets from it do not (a sunset is 00:00 Eastern on its day).
      const sunset = otherVersions.find((v) => v.sunsetAt)!;
      const day = todayIn(new Date(base.getTime() + 37 * DAY + 21 * DAY), "America/New_York");
      expect(sunset.sunsetAt).toEqual(sunsetInstant(day, "America/New_York"));
    } finally {
      other.client.close();
    }
  }, 60_000);
});
