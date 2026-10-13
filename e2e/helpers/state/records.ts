import { randomUUID } from "node:crypto";
import type { InValue, Row } from "./db";

// What the state helpers hand to a spec: one record type per thing Stencil stores, in camelCase, with JSON
// columns parsed, booleans as booleans and times as milliseconds since the epoch. A spec never sees a column
// name or a JSON string, so another backend can return the same records without a table behind them.
// `fromRow` and `toColumns` are the only places that know the table layout.

/** A TipTap document node, as a version stores its body and a channel field. */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface VariableRecord {
  key: string;
  label?: string;
  type: string;
  required: boolean;
  sample?: string;
}

export interface SampleSetRecord {
  id: string;
  name?: string;
  values: Record<string, string>;
}

export interface TemplateRecord {
  id: string;
  teamId: string;
  contentTypeId: string;
  createdBy: string;
  createdAt: number;
  /** Which starter the template began from; null for one made from nothing or imported. */
  starterKey: string | null;
}

export interface RevokeRecord {
  reason: string;
  startedBy: string;
  startedAt: string;
  /** Set when a second approver confirms the revoke. */
  confirmedBy?: string;
  confirmedAt?: string;
}

export interface VersionRecord {
  id: string;
  templateId: string;
  /** Null on an open draft. */
  number: number | null;
  /** Null on an open draft; a resubmission after a send-back is the next round of the same number. */
  round: number | null;
  state: string;
  name: string;
  basedOnVersionId: string | null;
  body: DocNode;
  channelFields: Record<string, Record<string, DocNode>>;
  channels: string[];
  smsFooter: string | null;
  variables: VariableRecord[];
  sampleSets: SampleSetRecord[];
  contractChanges: Record<string, unknown>[] | null;
  /** The approval stages recorded at submit; null on a draft. */
  stages: { id: string; name: string }[] | null;
  currentStage: number;
  rev: number;
  createdBy: string;
  writers: string[];
  createdAt: number;
  updatedAt: number;
  submittedBy: string | null;
  submittedAt: number | null;
  submitNote: string | null;
  activatedAt: number | null;
  supersededAt: number | null;
  sunsetAt: number | null;
  sunsetSetBy: string | null;
  revoke: RevokeRecord | null;
  importUploadId: string | null;
}

export interface ApprovalRecord {
  id: string;
  versionId: string;
  stageId: string | null;
  stagePosition: number;
  stageName: string;
  actorId: string;
  decision: "approved" | "changes_requested";
  reason: string | null;
  sampleSetsSeen: string[] | null;
  decidedAt: number;
}

export interface CommentThreadRecord {
  id: string;
  templateId: string;
  originVersionId: string;
  /** A block id, or `doc` for a thread about the whole version. */
  blockId: string;
  quote: string | null;
  status: "open" | "resolved";
  resolvedBy: string | null;
  resolvedAt: number | null;
  createdAt: number;
}

export interface CommentRecord {
  id: string;
  threadId: string;
  authorId: string;
  body: string;
  kind: "comment" | "change_request";
  createdAt: number;
}

export interface AuditEventRecord {
  id: string;
  at: number;
  actorId: string | null;
  teamId: string | null;
  templateId: string | null;
  versionId: string | null;
  action: string;
  details: Record<string, unknown> | null;
  sessionKey: string | null;
}

/**
 * A notification as stored (decision 0055): its kind's facts (names as they were) and a link descriptor that
 * names its team by id. The bell words it and builds its href when it reads it; `body` is a person's own words.
 */
export interface NotificationRecord {
  id: string;
  userId: string;
  teamId: string | null;
  kind: string;
  facts: Record<string, unknown>;
  link: { to: string; teamId?: string; templateId?: string } & Record<
    string,
    unknown
  >;
  body: string | null;
  createdAt: number;
  readAt: number | null;
}

export interface ConsumerNoticeRecord {
  id: string;
  /** The notice's place in the outbox, across all consumers. */
  seq: number;
  consumerId: string;
  templateId: string;
  versionId: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

/** One render the API logged. Never holds variable values. */
export interface RenderLogRecord {
  id: string;
  at: number;
  templateId: string;
  versionId: string;
  versionNumber: number | null;
  consumerId: string | null;
  channel: string;
  platform: string | null;
  isPreview: boolean;
  correlationId: string;
  outcome: "ok" | "error";
  errorCode: string | null;
  durationMs: number | null;
}

export interface UploadRecord {
  id: string;
  templateId: string | null;
  filename: string;
  mime: string;
  size: number;
  path: string;
  createdBy: string;
  createdAt: number;
}

export interface ApprovalStageRecord {
  id: string;
  contentTypeId: string;
  position: number;
  name: string;
  approverRule: Record<string, unknown>;
}

export interface ContentTypeRecord {
  id: string;
  key: string;
  name: string;
  allowedChannels: string[];
}

export interface MembershipRecord {
  id: string;
  userId: string;
  teamId: string;
  status: string;
  roles: string[];
}

/** Coral's link of an offer to a template. */
export interface SimLinkRecord {
  id: string;
  offerId: string;
  templateId: string;
  templateName: string;
  pinnedVersion: number;
  channels: string[];
  mapping: Record<string, string>;
  linkedAt: number;
}

/** One render per customer and channel of a Coral send. */
export interface SimDeliveryRecord {
  id: string;
  batchId: string;
  offerId: string;
  customerId: string;
  templateId: string | null;
  versionNumber: number | null;
  channel: string;
  platform: string | null;
  status: "delivered" | "failed";
  error: { status: number; code: string; message: string } | null;
  newerVersion: number | null;
  correlationId: string;
  output: string | null;
  at: number;
}

// ── Rows to records and back ─────────────────────────────────────────────────

const JSON_COLUMNS: Record<string, readonly string[]> = {
  versions: [
    "body",
    "channel_fields",
    "channels",
    "variables",
    "sample_sets",
    "contract_changes",
    "stages",
    "writers",
    "revoke",
  ],
  approvals: ["sample_sets_seen"],
  audit_events: ["details"],
  notifications: ["facts", "link"],
  consumer_notices: ["payload"],
  approval_stages: ["approver_rule"],
  content_types: ["required_sections", "allowed_channels"],
  settings: ["value"],
  sim_links: ["channels", "mapping"],
  sim_deliveries: ["error"],
  sim_customers: ["statement", "last_purchase"],
};

const BOOLEAN_COLUMNS: Record<string, readonly string[]> = {
  render_log: ["is_preview"],
  users: ["is_persona"],
};

const camel = (name: string) =>
  name.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
const snake = (name: string) =>
  name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** A row of `table` as a record: camelCase keys, JSON parsed, booleans as booleans. Works on a partial select too. */
export function fromRow<T>(table: string, row: Row): T {
  const json = JSON_COLUMNS[table] ?? [];
  const booleans = BOOLEAN_COLUMNS[table] ?? [];
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      camel(column),
      value === null || value === undefined
        ? null
        : json.includes(column)
          ? JSON.parse(String(value))
          : booleans.includes(column)
            ? Number(value) !== 0
            : value,
    ]),
  ) as T;
}

/** A record's fields (any of them) as `table`'s columns: snake_case keys, JSON stringified. */
export function toColumns(
  table: string,
  record: Record<string, unknown>,
): Record<string, InValue> {
  const json = JSON_COLUMNS[table] ?? [];
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        const column = snake(key);
        const stored =
          value === null
            ? null
            : json.includes(column)
              ? JSON.stringify(value)
              : typeof value === "boolean"
                ? Number(value)
                : value;
        return [column, stored as InValue];
      }),
  );
}

/** A fresh id for a row a spec writes: `v_e2e` and nine hex digits for a version, `th_e2e…` for a thread, and so on. */
export const newId = (prefix: string) =>
  `${prefix}_e2e${randomUUID().replaceAll("-", "").slice(0, 9)}`;
