// Shared state while the seed is built in memory. Modules push rows into the sink; index.ts inserts
// them in foreign-key order at the end. Nothing here touches the database.

import type { InferInsertModel } from "drizzle-orm";
import type { Channel, Variable, VersionState } from "@/domain/types";
import type * as ucomp from "@/server/db/schema/ucomp";
import type * as sim from "@/server/db/schema/sim";
import { seededId, seededTemplateId } from "@/server/ids";
import { mulberry32, SEED, type Rng } from "./rng";
import { VariableKit } from "./variables";

export { DAY, HOUR } from "./time";
import { DAY } from "./time";

type Row<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export interface Sink {
  settings: Row<typeof ucomp.settings>[];
  users: Row<typeof ucomp.users>[];
  teams: Row<typeof ucomp.teams>[];
  memberships: Row<typeof ucomp.memberships>[];
  membershipRoles: Row<typeof ucomp.membershipRoles>[];
  contentTypes: Row<typeof ucomp.contentTypes>[];
  approvalStages: Row<typeof ucomp.approvalStages>[];
  consumers: Row<typeof ucomp.consumers>[];
  templates: Row<typeof ucomp.templates>[];
  versions: Row<typeof ucomp.versions>[];
  approvals: Row<typeof ucomp.approvals>[];
  commentThreads: Row<typeof ucomp.commentThreads>[];
  comments: Row<typeof ucomp.comments>[];
  /** Numbered (`seq`) when inserted, oldest first: modules push them in build order, not time order. */
  consumerNotices: Omit<Row<typeof ucomp.consumerNotices>, "seq">[];
  auditEvents: Row<typeof ucomp.auditEvents>[];
  notifications: Row<typeof ucomp.notifications>[];
  accessRequests: Row<typeof ucomp.accessRequests>[];
  recertifications: Row<typeof ucomp.recertifications>[];
  recertItems: Row<typeof ucomp.recertItems>[];
  renderLog: Row<typeof ucomp.renderLog>[];
  simOffers: InferInsertModel<typeof sim.simOffers>[];
  simCustomers: InferInsertModel<typeof sim.simCustomers>[];
  simLinks: InferInsertModel<typeof sim.simLinks>[];
  simNoticeReads: InferInsertModel<typeof sim.simNoticeReads>[];
}

export function emptySink(): Sink {
  return {
    settings: [],
    users: [],
    teams: [],
    memberships: [],
    membershipRoles: [],
    contentTypes: [],
    approvalStages: [],
    consumers: [],
    templates: [],
    versions: [],
    approvals: [],
    commentThreads: [],
    comments: [],
    consumerNotices: [],
    auditEvents: [],
    notifications: [],
    accessRequests: [],
    recertifications: [],
    recertItems: [],
    renderLog: [],
    simOffers: [],
    simCustomers: [],
    simLinks: [],
    simNoticeReads: [],
  };
}

/** What other modules need to know about a template after it has been built. */
export interface VersionRef {
  id: string;
  number: number | null;
  /** Null for a draft. */
  round: number | null;
  state: VersionState;
  channels: Channel[];
  variables: Variable[];
  /** Days before `base` that the version was submitted (undefined for drafts). */
  submittedDaysAgo?: number;
}

export interface TemplateRef {
  id: string;
  key: string;
  name: string;
  teamId: string;
  versions: Record<string, VersionRef>;
}

export interface SeedCtx {
  /** The moment of the reset, in epoch ms. Every timestamp is relative to this. */
  base: number;
  rng: Rng;
  vars: VariableKit;
  sink: Sink;
  templates: Map<string, TemplateRef>;
  /** A Date `days` before base (negative = in the future). */
  at(days: number): Date;
  /** Unique seeded id, e.g. `m_k3f9a2x7q1`. */
  id(prefix: string): string;
  /** Unique seeded template id, e.g. `UC-4F7K2Q`. */
  templateId(): string;
  template(key: string): TemplateRef;
}

export function createContext(base: number): SeedCtx {
  const rng = mulberry32(SEED);
  const used = new Set<string>();
  const unique = (make: () => string) => {
    for (;;) {
      const id = make();
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
  const templates = new Map<string, TemplateRef>();
  return {
    base,
    rng,
    vars: new VariableKit(base),
    sink: emptySink(),
    templates,
    at: (days) => new Date(base - days * DAY),
    id: (prefix) => unique(() => seededId(rng, prefix)),
    templateId: () => unique(() => seededTemplateId(rng)),
    template(key) {
      const t = templates.get(key);
      if (!t) throw new Error(`Seed: unknown template "${key}"`);
      return t;
    },
  };
}
