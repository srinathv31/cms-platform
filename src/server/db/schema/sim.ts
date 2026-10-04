// Consumer simulator ("Coral — simulated"). These tables stand in for Coral's own system.
// UCOMP code must never import this file (enforced by ESLint). The simulator reaches
// UCOMP only through /api/v1, like a real consumer.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

type Channel = "pdf" | "web" | "email";
const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

export const simOffers = sqliteTable("sim_offers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(), // "Spring Travel Rewards"
  headline: text("headline").notNull(), // "Spend $1,000 in 3 months, get $200 back"
  terms: json<{ spend: number; bonus: number; months: number; annualFee?: number }>(
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
  annualFee: text("annual_fee"),
});

export const simLinks = sqliteTable("sim_links", {
  id: text("id").primaryKey(),
  offerId: text("offer_id")
    .notNull()
    .references(() => simOffers.id),
  templateId: text("template_id").notNull(),
  templateName: text("template_name").notNull(),
  pinnedVersion: integer("pinned_version").notNull(),
  channels: json<Channel[]>("channels").notNull(),
  mapping: json<Record<string, string>>("mapping").notNull(), // variable key → customer/offer field
  linkedAt: ts("linked_at").notNull(),
});

export const simDeliveries = sqliteTable("sim_deliveries", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  offerId: text("offer_id").notNull(),
  customerId: text("customer_id").notNull(),
  channel: text("channel").$type<Channel>().notNull(),
  status: text("status").$type<"delivered" | "failed">().notNull(),
  error: json<{ code: string; message: string }>("error"),
  correlationId: text("correlation_id").notNull(),
  output: text("output"), // what Coral received (kept on Coral's side, not UCOMP's)
  at: ts("at").notNull(),
});

export const simNoticeReads = sqliteTable("sim_notice_reads", {
  noticeId: text("notice_id").primaryKey(),
  readAt: ts("read_at").notNull(),
});
