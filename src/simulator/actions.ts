"use server";

import { eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import type { ApiChannel, ApiTemplateSummary } from "@/contracts/api-v1";
import { simCustomers, simDeliveries, simLinks, simNoticeReads, simOffers } from "@/server/db/schema/sim";
import { simDb, withBusyRetry } from "./db";
import { isSimFieldPath } from "./fields";
import { blockedSentence, missingRequired, valuesFor } from "./mapping";
import { customerRecord, getSimDeliveryView, loadBatch, offerRecord } from "./queries";
import type { SimApiError, SimBatch, SimDeliveryView, SimFieldPath, SimResult } from "./types";
import { ucompApi } from "./ucomp-api";

// Coral's actions. Coral is an outside system acting as itself, so there is no UCOMP persona or
// permission here: the API's X-Consumer-Id is the only identity. Mutations call refresh(); reads don't.
// Values never reach a log: nothing below prints customer data.

const fail = (reason: string) => ({ ok: false as const, reason });
const CHANNEL_LABEL: Record<ApiChannel, string> = { pdf: "PDF", web: "Web", email: "Email" };
/** At most this many renders in flight per send. */
const RENDER_CONCURRENCY = 3;
const MAX_CUSTOMERS = 50;

const Channel = z.enum(["pdf", "web", "email"]);
const Mapping = z.record(z.string().min(1).max(100), z.string().nullable());

const randomPart = (length: number) => crypto.randomUUID().replace(/-/g, "").slice(0, length);

/** The stored mapping: known field paths only. */
function cleanMapping(mapping: Readonly<Record<string, string | null>>): Record<string, SimFieldPath> {
  const out: Record<string, SimFieldPath> = {};
  for (const [key, path] of Object.entries(mapping)) if (isSimFieldPath(path)) out[key] = path;
  return out;
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchTemplates(input: { q: string }): Promise<SimResult<{ results: ApiTemplateSummary[] }>> {
  const parsed = z.object({ q: z.string().max(200) }).safeParse(input);
  if (!parsed.success) return fail("Search for a template name or ID.");
  const result = await (await ucompApi()).searchTemplates({ q: parsed.data.q, limit: 20 });
  return result.ok ? { ok: true, results: result.data.results } : fail(result.error.message);
}

// ── Link / relink ────────────────────────────────────────────────────────────

const LinkInput = z.object({
  offerId: z.string().min(1),
  templateId: z.string().min(1).max(64),
  version: z.int().min(1),
  channels: z.array(Channel).min(1, "Choose at least one channel."),
  mapping: Mapping,
});

/**
 * Links (or relinks) an offer to a template's Active version. Unmapped optional keys are dropped;
 * unmapped required keys may be saved (Send then names them).
 */
export async function linkTemplate(input: {
  offerId: string;
  templateId: string;
  version: number;
  channels: ApiChannel[];
  mapping: Record<string, SimFieldPath | null>;
}): Promise<SimResult> {
  const parsed = LinkInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.path[0] === "channels" ? "Choose at least one channel." : "That link isn't complete.");
  const { offerId, templateId, version, channels, mapping } = parsed.data;

  const [offer] = await simDb.select({ id: simOffers.id }).from(simOffers).where(eq(simOffers.id, offerId));
  if (!offer) return fail("That offer doesn't exist.");

  const detail = await (await ucompApi()).getTemplate(templateId);
  if (!detail.ok) return fail(detail.error.message);
  const { activeVersion, contract, name } = detail.data;
  if (activeVersion === null || contract === null) return fail("This template has no Active version to link.");
  if (version !== activeVersion) return fail(`v${version} isn't the Active version. Link v${activeVersion}.`);
  const outside = channels.filter((c) => !contract.channels.includes(c));
  if (outside.length > 0) return fail(`v${activeVersion} doesn't render ${CHANNEL_LABEL[outside[0]]}.`);

  const keys = new Set(contract.variables.map((v) => v.key));
  const kept = cleanMapping(Object.fromEntries(Object.entries(mapping).filter(([key]) => keys.has(key))));
  const row = {
    templateId: detail.data.id,
    templateName: name,
    pinnedVersion: activeVersion,
    channels: contract.channels.filter((c) => channels.includes(c)),
    mapping: kept,
    linkedAt: new Date(),
  };
  await withBusyRetry(() =>
    simDb
      .insert(simLinks)
      .values({ id: `lnk_${randomPart(10)}`, offerId, ...row })
      .onConflictDoUpdate({ target: simLinks.offerId, set: row }),
  );
  refresh();
  return { ok: true };
}

/** Changes the mapping of an existing link (the offer page's rows). Null clears a key. */
export async function saveMapping(input: { offerId: string; mapping: Record<string, SimFieldPath | null> }): Promise<SimResult> {
  const parsed = z.object({ offerId: z.string().min(1), mapping: Mapping }).safeParse(input);
  if (!parsed.success) return fail("That mapping isn't complete.");
  const { offerId, mapping } = parsed.data;
  const [link] = await simDb.select().from(simLinks).where(eq(simLinks.offerId, offerId));
  if (!link) return fail("Link a template first.");

  const detail = await (await ucompApi()).getTemplate(link.templateId, { version: link.pinnedVersion });
  if (!detail.ok) return fail(detail.error.message);
  const keys = new Set(detail.data.contract?.variables.map((v) => v.key) ?? []);
  const unknown = Object.keys(mapping).find((key) => !keys.has(key));
  if (unknown) return fail(`v${link.pinnedVersion} has no variable ${unknown}.`);
  const bad = Object.entries(mapping).find(([, path]) => path !== null && !isSimFieldPath(path));
  if (bad) return fail(`${bad[1]} isn't one of Coral's fields.`);

  const next: Record<string, string | null> = { ...link.mapping, ...mapping };
  await withBusyRetry(() =>
    simDb.update(simLinks).set({ mapping: cleanMapping(next) }).where(eq(simLinks.id, link.id)),
  );
  refresh();
  return { ok: true };
}

// ── Send ─────────────────────────────────────────────────────────────────────

/** Runs `work` over `items` with at most `limit` in flight; results keep the items' order. */
async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runner = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return out;
}

/**
 * Renders every linked channel for each chosen customer on the pinned version, as Coral. Failed renders
 * are results (the API's error kept verbatim); the action fails only when nothing could be sent.
 */
export async function sendToCustomers(input: { offerId: string; customerIds: string[] }): Promise<SimResult<{ batch: SimBatch }>> {
  const parsed = z
    .object({ offerId: z.string().min(1), customerIds: z.array(z.string().min(1)).min(1).max(MAX_CUSTOMERS) })
    .safeParse(input);
  if (!parsed.success) return fail("Choose customers to send to.");
  const { offerId } = parsed.data;
  const customerIds = [...new Set(parsed.data.customerIds)];

  const [[offer], [link], customerRows] = await Promise.all([
    simDb.select().from(simOffers).where(eq(simOffers.id, offerId)),
    simDb.select().from(simLinks).where(eq(simLinks.offerId, offerId)),
    simDb.select().from(simCustomers).where(inArray(simCustomers.id, customerIds)),
  ]);
  if (!offer) return fail("That offer doesn't exist.");
  if (!link) return fail("Link a template to send.");
  const customers = customerIds.flatMap((id) => customerRows.filter((c) => c.id === id));
  if (customers.length === 0) return fail("Choose customers to send to.");

  const api = await ucompApi();
  // Coral checks its own mapping against the pinned contract before sending anything.
  const detail = await api.getTemplate(link.templateId, { version: link.pinnedVersion });
  if (!detail.ok && detail.error.status === 0) return fail(detail.error.message);
  if (detail.ok && detail.data.contract) {
    const missing = missingRequired(detail.data.contract.variables, link.mapping);
    if (missing.length > 0) return fail(blockedSentence(missing));
  }

  const mapping = cleanMapping(link.mapping);
  const offerRec = offerRecord(offer);
  const jobs = customers.flatMap((customer) => link.channels.map((channel) => ({ customer, channel })));
  const results = await pool(jobs, RENDER_CONCURRENCY, async ({ customer, channel }) => {
    const correlationId = `coral_${randomPart(16)}`;
    const values = valuesFor(mapping, customerRecord(customer), offerRec);
    const rendered = await api.render(link.templateId, { version: link.pinnedVersion, channel, values }, correlationId);
    // Stamped with UCOMP's answer time (its HTTP Date header: the demo's clock), real time without one.
    return { customer, channel, correlationId, rendered, at: rendered.at };
  });

  const unreachable = results.every((r) => !r.rendered.ok && r.rendered.error.status === 0);
  if (unreachable) return fail((results[0].rendered as { error: SimApiError }).error.message);

  const batchKey = randomPart(12);
  const batchId = `bat_${batchKey}`;
  const rows = results.map((r, i) => ({
    // The index keeps the send order: loadBatch orders a batch by id.
    id: `dlv_${batchKey}_${String(i).padStart(3, "0")}`,
    batchId,
    offerId,
    customerId: r.customer.id,
    templateId: link.templateId,
    versionNumber: link.pinnedVersion,
    channel: r.channel,
    status: r.rendered.ok ? ("delivered" as const) : ("failed" as const),
    error: r.rendered.ok ? null : r.rendered.error,
    newerVersion: r.rendered.ok ? r.rendered.data.newerVersion : null,
    correlationId: r.correlationId,
    output: r.rendered.ok ? r.rendered.data.output : null,
    at: r.at,
  }));
  await withBusyRetry(() => simDb.insert(simDeliveries).values(rows));

  const batch = await loadBatch(batchId);
  refresh();
  return batch ? { ok: true, batch } : fail("The send couldn't be saved.");
}

// ── Notices ──────────────────────────────────────────────────────────────────

export async function markNoticesRead(input: { noticeIds: string[] }): Promise<SimResult> {
  const parsed = z.object({ noticeIds: z.array(z.string().min(1).max(64)).min(1).max(500) }).safeParse(input);
  if (!parsed.success) return fail("Choose notices to mark read.");
  const readAt = new Date();
  const rows = [...new Set(parsed.data.noticeIds)].map((noticeId) => ({ noticeId, readAt }));
  await withBusyRetry(() => simDb.insert(simNoticeReads).values(rows).onConflictDoNothing());
  refresh();
  return { ok: true };
}

// ── Customer view ────────────────────────────────────────────────────────────

export async function getDeliveryView(input: { deliveryId: string }): Promise<SimResult<{ view: SimDeliveryView }>> {
  const parsed = z.object({ deliveryId: z.string().min(1).max(64) }).safeParse(input);
  if (!parsed.success) return fail("That delivery doesn't exist.");
  const view = await getSimDeliveryView(parsed.data.deliveryId);
  return view ? { ok: true, view } : fail("That delivery doesn't exist.");
}
