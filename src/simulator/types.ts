// Phase 5 contract, Coral's side: the consumer simulator's read models and actions ("Coral — simulated").
//
// The simulator is an outside system. It reaches UCOMP ONLY over /api/v1 (src/contracts/api-v1.ts) and
// keeps its data in its own sim_* tables (src/server/db/schema/sim.ts) through its own DB handle
// (src/simulator/db.ts). It may not import @/server (except the sim schema), @/domain or @/editor
// (ESLint). Nothing here is UCOMP's: customer data never reaches UCOMP's tables or its render log.
// Dates are ISO strings. Who implements what is in docs/phase-5-brief.md.

import type {
  ApiChannel,
  ApiContractDiff,
  ApiNoticeKind,
  ApiTemplateDetail,
  ApiTemplateSummary,
  ApiVariable,
  ApiVariableType,
  ApiVersionState,
} from "@/contracts/api-v1";

// ── Mapping fields (src/simulator/fields.ts holds the runtime list) ─────────────────────────────

/** A field Coral can feed into a template variable. */
export type SimFieldPath =
  | "customer.firstName"
  | "customer.lastName"
  | "customer.fullName"
  | "customer.email"
  | "customer.homeState"
  | "customer.purchaseApr"
  | "customer.annualFee"
  | "offer.name"
  | "offer.headline"
  | "offer.spend"
  | "offer.bonus"
  | "offer.months"
  | "offer.annualFee"
  | "offer.endsOn";

export interface SimField {
  path: SimFieldPath;
  source: "customer" | "offer";
  label: string; // "Customer · First name", "Offer · Annual fee"
  /** Variable types this field's values are valid for (canonical forms). */
  fits: readonly ApiVariableType[];
}

// SIM_FIELDS: readonly SimField[]                                         (fields.ts)
// suggestMapping(variables: readonly ApiVariable[], current?: Record<string, SimFieldPath>): Record<string, SimFieldPath>
//   Keeps current mappings that still fit; then auto-maps by key (first_name → customer.firstName, last_name,
//   purchase_apr, home_state, offer_end_date → offer.endsOn). Never auto-maps a key it isn't sure of
//   (annual_fee stays unmapped: the person picks customer or offer).
// missingRequired(variables: readonly ApiVariable[], mapping: Record<string, SimFieldPath | null>): ApiVariable[]
// valuesFor(mapping: Record<string, SimFieldPath>, customer: SimCustomerRecord, offer: SimOfferRecord): Record<string, string>
//   Canonical strings only (customer.purchaseApr "21.99", offer.annualFee "95", offer.endsOn "2027-06-30").
// blockedSentence(missing: readonly ApiVariable[]): string     // "Map First name and Annual fee to send."
// All four are pure (src/simulator/mapping.ts + mapping.test.ts).

/** Raw records the pure helpers read (rows of sim_customers / sim_offers). */
export interface SimCustomerRecord {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  homeState: string;
  purchaseApr: string;
  annualFee: string | null;
}

export interface SimOfferRecord {
  id: string;
  name: string;
  headline: string;
  terms: { spend: number; bonus: number; months: number; annualFee?: number; endsOn?: string };
}

// ── Read models (src/simulator/queries.ts; server-only; each reads sim_* and calls /api/v1) ─────────

/** /sim — Coral's offers and its notice inbox. */
export interface SimHome {
  offers: SimOfferCard[];
  notices: SimNoticeView[]; // newest first, all of Coral's
  unread: number;
  /** Set when /api/v1 couldn't be reached; the page still renders the sim's own data. */
  apiError: SimApiError | null;
}

export interface SimOfferCard {
  id: string;
  name: string;
  headline: string;
  link: SimLinkSummary | null;
  /** "v3 available" when the linked template's Active version is newer than the pin. */
  upgrade: SimUpgrade | null;
  lastSend: { at: string; delivered: number; failed: number } | null;
}

export interface SimLinkSummary {
  templateId: string;
  templateName: string;
  pinnedVersion: number;
  /** From GET /api/v1/templates/{id}: the pinned version's state today. */
  pinnedState: ApiVersionState;
  sunsetAt: string | null;
  sunsetPassed: boolean;
  revokedAt: string | null;
  /** False when a send would fail today (sunset passed, revoked). */
  renders: boolean;
  channels: ApiChannel[];
  linkedAt: string;
}

export interface SimUpgrade {
  toVersion: number;
  /** GET /api/v1/templates/{id}?since={pinned}: the contract changes and the keys to map. */
  diff: ApiContractDiff;
}

/** /sim/offers/[offerId] — one offer: link, mapping, send, results. */
export interface SimOfferPage {
  offer: { id: string; name: string; headline: string; terms: SimOfferRecord["terms"] };
  link: (SimLinkSummary & { mapping: SimMappingRow[] }) | null;
  upgrade: SimUpgrade | null;
  /** Unmapped required variables. When non-empty, Send is disabled and `blocked.sentence` says why. */
  blocked: { missing: { key: string; label: string }[]; sentence: string } | null;
  customers: SimCustomerRow[];
  /** The newest send of this offer, if any. */
  lastBatch: SimBatch | null;
  /** Notices about the linked template, newest first. */
  notices: SimNoticeView[];
  apiError: SimApiError | null;
}

export interface SimMappingRow {
  key: string;
  label: string;
  type: ApiVariableType;
  required: boolean;
  field: SimFieldPath | null;
  fieldLabel: string | null;
}

export interface SimCustomerRow {
  id: string;
  name: string; // "First Last" (the long one included, untruncated in data)
  email: string;
  homeState: string;
  purchaseApr: string; // "21.99"
  annualFee: string | null;
}

export interface SimBatch {
  id: string;
  at: string;
  templateId: string;
  versionNumber: number;
  channels: ApiChannel[];
  counts: { delivered: number; failed: number };
  /** One row per customer, in the order sent; one result per channel, in `channels` order. */
  rows: SimResultRow[];
}

export interface SimResultRow {
  customerId: string;
  customerName: string;
  results: SimDeliveryResult[];
}

export interface SimDeliveryResult {
  deliveryId: string;
  channel: ApiChannel;
  status: "delivered" | "failed";
  /** The API's error, verbatim: the grid shows `message` exactly as UCOMP wrote it. */
  error: SimApiError | null;
  /** X-UCOMP-Newer-Version on a delivered render of a Superseded version. */
  newerVersion: number | null;
}

export interface SimApiError {
  status: number;
  code: string;
  message: string;
}

/** The customer view of one delivery (a dialog over the results grid). */
export interface SimDeliveryView {
  id: string;
  customer: { name: string; email: string };
  offerName: string;
  templateName: string;
  versionNumber: number;
  channel: ApiChannel;
  at: string;
  status: "delivered" | "failed";
  error: SimApiError | null;
  /**
   * web   → phone frame: an iframe on `src` (the stored HTML)
   * email → inbox: subject, preheader and an iframe on `src` (the stored email HTML)
   * pdf   → the PDF: an iframe/embed on `src` plus "Open PDF" (new tab)
   * null when the delivery failed.
   */
  view:
    | { kind: "phone"; src: string }
    | { kind: "inbox"; src: string; from: string; subject: string; preheader: string }
    | { kind: "pdf"; src: string }
    | null;
}

export interface SimNoticeView {
  id: string;
  kind: ApiNoticeKind;
  createdAt: string;
  templateId: string;
  templateName: string;
  versionNumber: number;
  /** ApiNotice.message, verbatim. */
  message: string;
  /** ApiNotice.changes[].text. */
  lines: string[];
  read: boolean;
  /** Coral's offers linked to this template (the notice links to them). */
  offerIds: string[];
}

/** The link / relink flow (/sim/offers/[offerId]/link). */
export interface SimLinkFlow {
  offer: { id: string; name: string };
  current: SimLinkSummary | null;
  /** Set once a template is chosen (?template=UC-…): its detail at the Active version, and the diff from the pin. */
  candidate: {
    template: ApiTemplateDetail;
    version: number;
    variables: ApiVariable[];
    /** suggestMapping() over the current mapping when relinking. */
    mapping: Record<string, SimFieldPath>;
    /** Relink only: the changes since the pinned version; `newRequired` keys are highlighted. */
    diff: ApiContractDiff | null;
  } | null;
  fields: readonly SimField[];
  /** S3 addition: the chosen template couldn't be read (bad id, no Active version) or /api/v1 was down. */
  apiError: SimApiError | null;
}

// ── Actions (src/simulator/actions.ts, "use server"; each returns SimResult and calls refresh()) ────

export type SimResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; reason: string };

// searchTemplates(input: { q: string }): Promise<SimResult<{ results: ApiTemplateSummary[] }>>
//   GET /api/v1/templates?q=… (debounced by the UI; empty q lists every Active template).
// linkTemplate(input: { offerId: string; templateId: string; version: number; channels: ApiChannel[];
//                       mapping: Record<string, SimFieldPath | null> }): Promise<SimResult>
//   Upserts sim_links (one per offer). Unmapped OPTIONAL keys are dropped; unmapped REQUIRED keys are
//   allowed to save (Send is then blocked and names them). `version` must be the Active one
//   (re-checked against GET /api/v1/templates/{id}); channels ⊆ that version's channels, non-empty.
// sendToCustomers(input: { offerId: string; customerIds: string[] }): Promise<SimResult<{ batch: SimBatch }>>
//   Refuses with blockedSentence() when required keys are unmapped. Otherwise POSTs
//   /api/v1/templates/{id}/render once per customer × linked channel, `X-Consumer-Id: coral`, a fresh
//   X-Correlation-Id each, `version: pinnedVersion`, pdf with `encoding: "base64"`; at most 3 in flight.
//   Writes one sim_deliveries row per render (output kept on Coral's side; failures keep the error body).
//   Failures are results, not action errors: the action is ok unless nothing could be sent.
// saveMapping(input: { offerId: string; mapping: Record<string, SimFieldPath | null> }): Promise<SimResult>
//   S3 addition (the offer page's mapping rows): merges into the link's mapping; null clears a key.
//   Keys must be variables of the pinned version (re-read over /api/v1).
// markNoticesRead(input: { noticeIds: string[] }): Promise<SimResult>   // inserts sim_notice_reads
// getDeliveryView(input: { deliveryId: string }): Promise<SimResult<{ view: SimDeliveryView }>>

// Signatures re-exported for the UI's convenience.
export type { ApiChannel, ApiTemplateSummary, ApiVariable };
