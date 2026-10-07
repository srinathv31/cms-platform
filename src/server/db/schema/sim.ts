// Consumer simulator ("Coral — simulated"). These tables stand in for Coral's own system.
// UCOMP code must never import this file (enforced by ESLint). The simulator reaches
// UCOMP only through /api/v1, like a real consumer.

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

type Channel = "pdf" | "web" | "email";
const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

export const simOffers = sqliteTable("sim_offers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(), // "Spring Travel Rewards"
  headline: text("headline").notNull(), // "Spend $1,000 in 3 months, get $200 back"
  // annualFee in dollars ("95" when mapped); endsOn is a YYYY-MM-DD day (Phase 5: offer.* mapping fields).
  terms: json<{ spend: number; bonus: number; months: number; annualFee?: number; endsOn?: string }>(
    "terms",
  ).notNull(),
});

export const simCustomers = sqliteTable("sim_customers", {
  id: text("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  homeState: text("home_state").notNull(), // "NJ"
  purchaseApr: text("purchase_apr").notNull(), // "21.99"
  annualFee: text("annual_fee"), // canonical currency ("95", "0"); every seeded customer has one
});

/** One link per offer. Relinking updates the row (new pinned version, mapping, channels). */
export const simLinks = sqliteTable(
  "sim_links",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id")
      .notNull()
      .references(() => simOffers.id),
    templateId: text("template_id").notNull(),
    templateName: text("template_name").notNull(),
    pinnedVersion: integer("pinned_version").notNull(),
    channels: json<Channel[]>("channels").notNull(),
    mapping: json<Record<string, string>>("mapping").notNull(), // variable key → customer/offer field path
    linkedAt: ts("linked_at").notNull(),
  },
  (t) => [uniqueIndex("sim_links_offer").on(t.offerId)],
);

/**
 * One render per customer × channel of a send ("batch"). `output` is what Coral received, kept on
 * Coral's side: pdf = base64 of the PDF bytes, web = the HTML document, email = the JSON body.
 * Failed rows keep the API's error verbatim (status, code, message) and no output.
 */
export const simDeliveries = sqliteTable(
  "sim_deliveries",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    offerId: text("offer_id").notNull(),
    customerId: text("customer_id").notNull(),
    // Phase 5: what was asked for. Nullable only so the column can be added; always written.
    templateId: text("template_id"),
    versionNumber: integer("version_number"),
    channel: text("channel").$type<Channel>().notNull(),
    status: text("status").$type<"delivered" | "failed">().notNull(),
    error: json<{ status: number; code: string; message: string }>("error"),
    /** X-Stencil-Newer-Version on a delivered render of a Superseded version. */
    newerVersion: integer("newer_version"),
    correlationId: text("correlation_id").notNull(),
    output: text("output"),
    at: ts("at").notNull(),
  },
  (t) => [index("sim_deliveries_offer_at").on(t.offerId, t.at), index("sim_deliveries_batch").on(t.batchId)],
);

export const simNoticeReads = sqliteTable("sim_notice_reads", {
  noticeId: text("notice_id").primaryKey(),
  readAt: ts("read_at").notNull(),
});
