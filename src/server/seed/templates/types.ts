import type { ChannelFields } from "@/domain/channel-fields";
import type { Channel, ContractChange, JSONContent, Variable, VersionState } from "@/domain/types";
import type { ConsumerId } from "../platform";
import type { TeamId } from "../teams";

// Declarative description of a seeded template. `build.ts` turns it into rows: the template, its
// versions, approvals, comment threads, audit events and consumer notices, all derived from this
// one description so they cannot disagree. Times are "days before the reset" (positive = past).

export interface SeedApproval {
  actor: string;
  decision: "approved" | "changes_requested";
  reason?: string;
  at: number;
  /** Sample-set ids the approver looked at. */
  seen?: string[];
}

export interface SeedComment {
  author: string;
  body: string;
  kind?: "comment" | "change_request";
  at: number;
}

export interface SeedThread {
  /** Ref of the version the thread started on. */
  origin: string;
  /** Block key (see content.ts); resolved to the stable block id. */
  block: string;
  quote?: string;
  comments: SeedComment[];
  resolved?: { by: string; at: number };
}

export interface SeedVersion {
  /** Local label, e.g. "v1". Unique within the template. */
  ref: string;
  /** Null for a draft. */
  number: number | null;
  state: VersionState;
  basedOn?: string;
  /** Ref of the version this one replaced when it went Active. */
  supersedes?: string;
  body: JSONContent;
  variables: Variable[];
  channels: Channel[];
  /** Each channel's own fields (src/domain/channel-fields.ts): email's subject and preheader. Only for channels it renders. */
  channelFields?: ChannelFields;
  /** Null for a first version; [] when nothing changed. */
  contractChanges?: ContractChange[] | null;

  createdBy: string;
  createdAt: number;
  /** Required for drafts; derived from the lifecycle otherwise. */
  updatedAt?: number;
  /** Number of editing sessions to record in the audit log before submit. */
  editSessions?: number;
  rev?: number;

  submittedBy?: string;
  submittedAt?: number;
  submitNote?: string;
  approvals?: SeedApproval[];
  activatedAt?: number;
  supersededAt?: number;
  sunset?: { inDays: number; setBy: string; setAt: number };
  revoke?: {
    reason: string;
    startedBy: string;
    startedAt: number;
    confirmedBy: string;
    confirmedAt: number;
  };
}

export interface SeedTemplate {
  /** Local key, e.g. "balance-transfer". Also the scope for block ids. */
  key: string;
  teamId: TeamId;
  name: string;
  createdBy: string;
  createdAt: number;
  starterKey?: string;
  /** Consumers that render it; they receive the outbound notices. */
  consumers?: ConsumerId[];
  versions: SeedVersion[];
  threads?: SeedThread[];
}
