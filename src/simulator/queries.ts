import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import type { ApiChannel, ApiContract, ApiNotice, ApiTemplateDetail } from "@/contracts/api-v1";
import { simCustomers, simDeliveries, simLinks, simNoticeReads, simOffers } from "@/server/db/schema/sim";
import { simDb } from "./db";
import { SIM_FIELDS, simField } from "./fields";
import { blockedSentence, missingRequired, suggestMapping } from "./mapping";
import type {
  SimApiError,
  SimBatch,
  SimCustomerRecord,
  SimCustomerRow,
  SimDeliveryView,
  SimHome,
  SimLinkFlow,
  SimLinkSummary,
  SimMappingRow,
  SimNoticeView,
  SimOfferCard,
  SimOfferPage,
  SimOfferRecord,
  SimResultRow,
  SimUpgrade,
} from "./types";
import { ucompApi, type EmailOutput, type UcompApi } from "./ucomp-api";

// The simulator's read models. Each reads Coral's own sim_* rows and asks UCOMP over /api/v1 for
// what only UCOMP knows (version states, contracts, notices). Server-only: pages call these inside
// <Stream>. If /api/v1 can't be reached the sim's own data still renders, with `apiError` set.

export type LinkRow = typeof simLinks.$inferSelect;
export type OfferRow = typeof simOffers.$inferSelect;
export type CustomerRow = typeof simCustomers.$inferSelect;
type DeliveryRow = typeof simDeliveries.$inferSelect;

/** Sender shown in the inbox view. */
export const CORAL_SENDER = "Coral Card <offers@coral.example>";

// ── Small mappers ────────────────────────────────────────────────────────────

export const customerRecord = (c: CustomerRow): SimCustomerRecord => ({
  id: c.id,
  firstName: c.firstName,
  lastName: c.lastName,
  email: c.email,
  homeState: c.homeState,
  purchaseApr: c.purchaseApr,
  annualFee: c.annualFee,
});

export const offerRecord = (o: OfferRow): SimOfferRecord => ({ id: o.id, name: o.name, headline: o.headline, terms: o.terms });

const customerRow = (c: CustomerRow): SimCustomerRow => ({
  id: c.id,
  name: `${c.firstName} ${c.lastName}`,
  email: c.email,
  homeState: c.homeState,
  purchaseApr: c.purchaseApr,
  annualFee: c.annualFee,
});

/** The link as Coral stores it plus what UCOMP says about the pinned version today. */
export function linkSummaryOf(link: LinkRow, detail: ApiTemplateDetail | null): SimLinkSummary {
  const pinned = detail?.versions.find((v) => v.number === link.pinnedVersion) ?? null;
  return {
    templateId: link.templateId,
    templateName: detail?.name ?? link.templateName,
    pinnedVersion: link.pinnedVersion,
    pinnedState: pinned?.state ?? "active",
    sunsetAt: pinned?.sunsetAt ?? null,
    sunsetPassed: pinned?.sunsetPassed ?? false,
    revokedAt: pinned?.revokedAt ?? null,
    // Unknown state (API down) is shown as rendering; the page carries apiError instead.
    renders: pinned ? pinned.renders : detail === null,
    channels: link.channels,
    linkedAt: link.linkedAt.toISOString(),
  };
}

interface LinkState {
  summary: SimLinkSummary;
  /** The pinned version's contract (null when UCOMP couldn't say). */
  contract: ApiContract | null;
  upgrade: SimUpgrade | null;
  error: SimApiError | null;
}

/** GET the template at the pinned version; when a newer version is Active, GET the diff from the pin. */
export async function loadLinkState(api: UcompApi, link: LinkRow): Promise<LinkState> {
  const detail = await api.getTemplate(link.templateId, { version: link.pinnedVersion });
  if (!detail.ok) return { summary: linkSummaryOf(link, null), contract: null, upgrade: null, error: detail.error };

  const active = detail.data.activeVersion;
  let upgrade: SimUpgrade | null = null;
  let error: SimApiError | null = null;
  if (active !== null && active > link.pinnedVersion) {
    const since = await api.getTemplate(link.templateId, { since: link.pinnedVersion });
    if (since.ok && since.data.changes) upgrade = { toVersion: active, diff: since.data.changes };
    else if (!since.ok) error = since.error;
  }
  return { summary: linkSummaryOf(link, detail.data), contract: detail.data.contract, upgrade, error };
}

/** At most this many pages of notices per load (10,000 notices); more is treated as a bad answer. */
export const MAX_NOTICE_PAGES = 50;

/**
 * Every Coral notice (one template's with `templateId`), oldest first as the API serves them: reads
 * page after page until `hasMore` is false. Coral keeps no cursor and reads the whole outbox on each
 * page load, which is fine at a simulator's size; a consumer that polls keeps the last `nextCursor`.
 * An answer that wouldn't end (an empty page that says more follow, or more than MAX_NOTICE_PAGES
 * pages) is an error, not a loop.
 */
export async function allNotices(
  api: UcompApi,
  templateId?: string,
): Promise<{ ok: true; notices: ApiNotice[] } | { ok: false; error: SimApiError }> {
  const notices: ApiNotice[] = [];
  let after: string | undefined;
  for (let pages = 1; pages <= MAX_NOTICE_PAGES; pages++) {
    const page = await api.listNotices({ templateId, limit: 200, after });
    if (!page.ok) return page;
    if (!page.data.hasMore) return { ok: true, notices: [...notices, ...page.data.notices] };
    if (page.data.notices.length === 0) {
      return { ok: false, error: { status: 200, code: "bad_response", message: "Stencil sent an empty page of notices that said more follow." } };
    }
    notices.push(...page.data.notices);
    after = page.data.nextCursor;
  }
  return { ok: false, error: { status: 200, code: "bad_response", message: `Stencil sent more than ${MAX_NOTICE_PAGES} pages of notices.` } };
}

/** Coral's notices, newest first, with Coral's read state and linked offers. */
async function loadNotices(
  api: UcompApi,
  links: readonly LinkRow[],
  templateId?: string,
): Promise<{ notices: SimNoticeView[]; error: SimApiError | null }> {
  const list = await allNotices(api, templateId);
  if (!list.ok) return { notices: [], error: list.error };
  const newestFirst = [...list.notices].reverse();
  const ids = newestFirst.map((n) => n.id);
  const reads = ids.length
    ? await simDb.select({ id: simNoticeReads.noticeId }).from(simNoticeReads).where(inArray(simNoticeReads.noticeId, ids))
    : [];
  const read = new Set(reads.map((r) => r.id));
  const notices = newestFirst.map(
    (n): SimNoticeView => ({
      id: n.id,
      kind: n.kind,
      createdAt: n.createdAt,
      templateId: n.template.id,
      templateName: n.template.name,
      versionNumber: n.versionNumber,
      message: n.message,
      lines: n.changes.map((c) => c.text),
      read: read.has(n.id),
      offerIds: links.filter((l) => l.templateId === n.template.id).map((l) => l.offerId),
    }),
  );
  return { notices, error: null };
}

// ── Batches ──────────────────────────────────────────────────────────────────

async function latestBatchId(offerId: string): Promise<string | null> {
  const [row] = await simDb
    .select({ batchId: simDeliveries.batchId })
    .from(simDeliveries)
    .where(eq(simDeliveries.offerId, offerId))
    .orderBy(desc(simDeliveries.at), desc(simDeliveries.id))
    .limit(1);
  return row?.batchId ?? null;
}

/** One send, rows in the order sent (delivery ids carry the send order). */
export async function loadBatch(batchId: string): Promise<SimBatch | null> {
  const rows = await simDb
    .select({ d: simDeliveries, firstName: simCustomers.firstName, lastName: simCustomers.lastName })
    .from(simDeliveries)
    .leftJoin(simCustomers, eq(simCustomers.id, simDeliveries.customerId))
    .where(eq(simDeliveries.batchId, batchId))
    .orderBy(asc(simDeliveries.id));
  if (rows.length === 0) return null;

  const channels: ApiChannel[] = [];
  const byCustomer = new Map<string, SimResultRow>();
  let at = rows[0].d.at;
  let delivered = 0;
  for (const { d, firstName, lastName } of rows) {
    if (!channels.includes(d.channel)) channels.push(d.channel);
    if (d.at < at) at = d.at;
    if (d.status === "delivered") delivered++;
    let row = byCustomer.get(d.customerId);
    if (!row) {
      row = { customerId: d.customerId, customerName: firstName === null ? d.customerId : `${firstName} ${lastName}`, results: [] };
      byCustomer.set(d.customerId, row);
    }
    row.results.push({ deliveryId: d.id, channel: d.channel, status: d.status, error: d.error ?? null, newerVersion: d.newerVersion ?? null });
  }
  for (const row of byCustomer.values()) row.results.sort((a, b) => channels.indexOf(a.channel) - channels.indexOf(b.channel));
  const first = rows[0].d;
  return {
    id: batchId,
    at: at.toISOString(),
    templateId: first.templateId ?? "",
    versionNumber: first.versionNumber ?? 0,
    channels,
    counts: { delivered, failed: rows.length - delivered },
    rows: [...byCustomer.values()],
  };
}

async function lastSendOf(offerId: string): Promise<SimOfferCard["lastSend"]> {
  const batchId = await latestBatchId(offerId);
  if (!batchId) return null;
  const rows = await simDb
    .select({ status: simDeliveries.status, at: simDeliveries.at })
    .from(simDeliveries)
    .where(eq(simDeliveries.batchId, batchId));
  const delivered = rows.filter((r) => r.status === "delivered").length;
  const at = rows.reduce((min, r) => (r.at < min ? r.at : min), rows[0].at);
  return { at: at.toISOString(), delivered, failed: rows.length - delivered };
}

// ── /sim ─────────────────────────────────────────────────────────────────────

export async function getSimHome(): Promise<SimHome> {
  await connection();
  const api = await ucompApi();
  const [offers, links] = await Promise.all([
    simDb.select().from(simOffers).orderBy(asc(simOffers.name)),
    simDb.select().from(simLinks),
  ]);

  const [cards, inbox] = await Promise.all([
    Promise.all(
      offers.map(async (offer): Promise<{ card: SimOfferCard; error: SimApiError | null }> => {
        const link = links.find((l) => l.offerId === offer.id) ?? null;
        const [state, lastSend] = await Promise.all([link ? loadLinkState(api, link) : null, lastSendOf(offer.id)]);
        return {
          card: {
            id: offer.id,
            name: offer.name,
            headline: offer.headline,
            link: state?.summary ?? null,
            upgrade: state?.upgrade ?? null,
            lastSend,
          },
          error: state?.error ?? null,
        };
      }),
    ),
    loadNotices(api, links),
  ]);

  return {
    offers: cards.map((c) => c.card),
    notices: inbox.notices,
    unread: inbox.notices.filter((n) => !n.read).length,
    apiError: inbox.error ?? cards.find((c) => c.error)?.error ?? null,
  };
}

// ── /sim/offers/[offerId] ────────────────────────────────────────────────────

export function mappingRows(contract: ApiContract, mapping: Readonly<Record<string, string>>): SimMappingRow[] {
  return contract.variables.map((v) => {
    const field = simField(Object.hasOwn(mapping, v.key) ? mapping[v.key] : null);
    return { key: v.key, label: v.label, type: v.type, required: v.required, field: field?.path ?? null, fieldLabel: field?.label ?? null };
  });
}

/** Null when the offer doesn't exist (the page calls notFound()). */
export async function getSimOfferPage(offerId: string): Promise<SimOfferPage | null> {
  await connection();
  const api = await ucompApi();
  const [offer] = await simDb.select().from(simOffers).where(eq(simOffers.id, offerId));
  if (!offer) return null;
  const [[link], customers, batchId] = await Promise.all([
    simDb.select().from(simLinks).where(eq(simLinks.offerId, offerId)),
    simDb.select().from(simCustomers).orderBy(asc(simCustomers.id)),
    latestBatchId(offerId),
  ]);

  const [state, inbox, lastBatch] = await Promise.all([
    link ? loadLinkState(api, link) : null,
    link ? loadNotices(api, [link], link.templateId) : { notices: [], error: null },
    batchId ? loadBatch(batchId) : null,
  ]);

  let blocked: SimOfferPage["blocked"] = null;
  if (state?.contract) {
    const missing = missingRequired(state.contract.variables, link!.mapping);
    if (missing.length > 0) {
      blocked = { missing: missing.map((v) => ({ key: v.key, label: v.label })), sentence: blockedSentence(missing) };
    }
  }

  return {
    offer: { id: offer.id, name: offer.name, headline: offer.headline, terms: offer.terms },
    link: state ? { ...state.summary, mapping: state.contract ? mappingRows(state.contract, link!.mapping) : [] } : null,
    upgrade: state?.upgrade ?? null,
    blocked,
    customers: customers.map(customerRow),
    lastBatch,
    notices: inbox.notices,
    apiError: state?.error ?? inbox.error ?? null,
  };
}

// ── /sim/offers/[offerId]/link ───────────────────────────────────────────────

const NO_ACTIVE: SimApiError = { status: 200, code: "no_active_version", message: "This template has no Active version to link." };

/**
 * The link / relink flow. With `templateId` (the ?template= the person chose): that template at its
 * Active version, a suggested mapping (carrying the current one over), and, when relinking the same
 * template to a newer version, the contract changes since the pin. Null when the offer doesn't exist.
 */
export async function getSimLinkFlow(offerId: string, templateId?: string | null): Promise<SimLinkFlow | null> {
  await connection();
  const api = await ucompApi();
  const [offer] = await simDb.select().from(simOffers).where(eq(simOffers.id, offerId));
  if (!offer) return null;
  const [link] = await simDb.select().from(simLinks).where(eq(simLinks.offerId, offerId));

  const [state, chosen] = await Promise.all([
    link ? loadLinkState(api, link) : null,
    templateId ? api.getTemplate(templateId) : null,
  ]);

  let candidate: SimLinkFlow["candidate"] = null;
  let apiError: SimApiError | null = state?.error ?? null;
  if (chosen && !chosen.ok) apiError = chosen.error;
  else if (chosen?.ok) {
    const template = chosen.data;
    if (template.activeVersion === null || template.contract === null) apiError = NO_ACTIVE;
    else {
      const relinking = link?.templateId === template.id;
      let diff = null;
      if (relinking && template.activeVersion > link.pinnedVersion) {
        diff = state?.upgrade?.toVersion === template.activeVersion ? state.upgrade.diff : null;
        if (!diff) {
          const since = await api.getTemplate(template.id, { since: link.pinnedVersion });
          if (since.ok) diff = since.data.changes ?? null;
          else apiError = since.error;
        }
      }
      candidate = {
        template,
        version: template.activeVersion,
        variables: template.contract.variables,
        mapping: suggestMapping(template.contract.variables, link?.mapping ?? {}),
        diff,
      };
    }
  }

  return { offer: { id: offer.id, name: offer.name }, current: state?.summary ?? null, candidate, fields: SIM_FIELDS, apiError };
}

// ── Deliveries ───────────────────────────────────────────────────────────────

export const deliveryFileHref = (deliveryId: string) => `/sim/deliveries/${encodeURIComponent(deliveryId)}/file`;

function parseEmail(output: string | null): EmailOutput | null {
  if (!output) return null;
  try {
    const email = JSON.parse(output) as EmailOutput;
    return typeof email?.html === "string" ? email : null;
  } catch {
    return null;
  }
}

/** The customer view of one delivery; null when there's no such delivery. */
export async function getSimDeliveryView(deliveryId: string): Promise<SimDeliveryView | null> {
  const [row] = await simDb
    .select({ d: simDeliveries, customer: simCustomers, offerName: simOffers.name })
    .from(simDeliveries)
    .leftJoin(simCustomers, eq(simCustomers.id, simDeliveries.customerId))
    .leftJoin(simOffers, eq(simOffers.id, simDeliveries.offerId))
    .where(eq(simDeliveries.id, deliveryId));
  if (!row) return null;
  const { d, customer } = row;
  const [link] = await simDb.select().from(simLinks).where(eq(simLinks.offerId, d.offerId));

  const src = deliveryFileHref(d.id);
  let view: SimDeliveryView["view"] = null;
  if (d.status === "delivered" && d.output) {
    if (d.channel === "web") view = { kind: "phone", src };
    else if (d.channel === "pdf") view = { kind: "pdf", src };
    else {
      const email = parseEmail(d.output);
      view = { kind: "inbox", src, from: CORAL_SENDER, subject: email?.subject ?? "", preheader: email?.preheader ?? "" };
    }
  }

  return {
    id: d.id,
    customer: customer ? { name: `${customer.firstName} ${customer.lastName}`, email: customer.email } : { name: d.customerId, email: "" },
    offerName: row.offerName ?? d.offerId,
    templateName: link && link.templateId === d.templateId ? link.templateName : (d.templateId ?? ""),
    versionNumber: d.versionNumber ?? 0,
    channel: d.channel,
    at: d.at.toISOString(),
    status: d.status,
    error: d.error ?? null,
    view,
  };
}

/** What /sim/deliveries/[id]/file serves: the stored output as the customer received it. */
export async function loadDeliveryFile(
  deliveryId: string,
): Promise<{ contentType: string; body: string | Uint8Array<ArrayBuffer>; filename: string } | null> {
  const [d]: DeliveryRow[] = await simDb.select().from(simDeliveries).where(eq(simDeliveries.id, deliveryId));
  if (!d || d.status !== "delivered" || !d.output) return null;
  const name = `${d.templateId ?? "delivery"}-v${d.versionNumber ?? 0}-${d.channel}`.replace(/[^\w.-]/g, "_");
  if (d.channel === "pdf") {
    return { contentType: "application/pdf", body: new Uint8Array(Buffer.from(d.output, "base64")), filename: `${name}.pdf` };
  }
  if (d.channel === "web") return { contentType: "text/html; charset=utf-8", body: d.output, filename: `${name}.html` };
  const email = parseEmail(d.output);
  return email ? { contentType: "text/html; charset=utf-8", body: email.html, filename: `${name}.html` } : null;
}
