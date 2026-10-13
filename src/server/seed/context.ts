// Shared state while the seed is built in memory. Modules push rows into the sink; index.ts inserts
// them in foreign-key order at the end. Nothing here touches the database.

import type { InferInsertModel } from "drizzle-orm";
import type { Channel, Variable, VersionState } from "@/domain/types";
import type * as ucomp from "@/server/db/schema/ucomp";
import type * as sim from "@/server/db/schema/sim";
import { seededId } from "@/server/ids";
import { fnv1a, mulberry32, type Rng } from "./rng";
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
  vars: VariableKit;
  sink: Sink;
  templates: Map<string, TemplateRef>;
  /** A Date `days` before base (negative = in the future). */
  at(days: number): Date;
  /**
   * A random sequence of its own, named `name`: the same numbers every run, whatever else the seed draws.
   * Asking for the same name again carries on from where it was.
   */
  random(name: string): Rng;
  /**
   * A unique seeded id for a row of `scope`, e.g. `ae_k3f9a2x7q1`, drawn from the sequence of that scope and
   * prefix (`random`). A scope is a template (`template:balance-transfer`), a team, or a module, so adding a row
   * to one moves the ids of its own later rows and nothing else's.
   */
  id(scope: string, prefix: string): string;
  /** Takes an id the spec spells out (a template's, a version's), so no other id repeats it. Throws if it's taken. */
  claimId(id: string): string;
  template(key: string): TemplateRef;
}

export function createContext(base: number): SeedCtx {
  const used = new Set<string>();
  const claimId = (id: string) => {
    if (used.has(id)) throw new Error(`Seed: the id ${id} is used twice`);
    used.add(id);
    return id;
  };
  const sequences = new Map<string, Rng>();
  const random = (name: string) => {
    const existing = sequences.get(name);
    if (existing) return existing;
    const created = mulberry32(fnv1a(name));
    sequences.set(name, created);
    return created;
  };
  const templates = new Map<string, TemplateRef>();
  return {
    base,
    vars: new VariableKit(base),
    sink: emptySink(),
    templates,
    at: (days) => new Date(base - days * DAY),
    random,
    id(scope, prefix) {
      const sequence = random(`id:${scope}:${prefix}`);
      for (;;) {
        const id = seededId(sequence, prefix);
        if (!used.has(id)) return claimId(id);
      }
    },
    claimId,
    template(key) {
      const t = templates.get(key);
      if (!t) throw new Error(`Seed: unknown template "${key}"`);
      return t;
    },
  };
}
