import type { ChannelFields } from "@/domain/channel-fields";
import type { ApiNotice } from "@/domain/golive-types";
import type {
  Channel,
  JSONContent,
  SampleSet,
  Variable,
  VersionState,
} from "@/domain/types";
import type { IdSource, TestHooks } from "../options";
import type { RequestContext, Services } from "../types";

// What the contract suite needs from an implementation to run its cases (decision 0068). Each implementation
// has one: the fake (services/fake/contract-harness.ts), the local implementation
// (services/local/contract-harness.ts), and later the Java API's, which calls the HTTP implementation against a
// test environment.
//
// A case acts only through the service interfaces, from the seeded world (the same people, teams and template
// ids in every implementation: the seed, or for Java the fixture the seed exports, loaded at the same base
// instant). It sets the backend's clock to an exact instant before it acts (`setClock`; for Java its test-only
// clock, decision 0068), and observes what a command wrote through reads: the service reads (a template's audit
// rows through `audit.activity`, notifications through `notifications.list`), the consumer notices `/api/v1`
// serves, and, until their areas move, the probe. It compares state before and after a command, never finds a
// write by its instant.

/** The implementation under test, as one case sees it. A fresh, seeded backend for every test. */
export interface ContractHarness {
  /** Which implementation, for the test names. */
  readonly name: string;
  /** The seed's template ids by key (`templates["balance-transfer"]`); filled before the first test. */
  readonly templates: Record<string, string>;
  /** The implementation, over this test's data. */
  services(): Services;
  /** Sets the backend's clock to exactly `at`: every write and every `asOf` reads it from then on. */
  setClock(at: Date): void;
  /** A request context for a seeded person. */
  as(userId: string): Promise<RequestContext>;
  /** Sets (or clears) the hooks the next commands run with (`TestHooks`), e.g. a competing compare-and-set write. */
  hooks(hooks: TestHooks): void;
  /**
   * Sets (or clears, for random ids) the source the backend draws a new template's id from, so a case can force a
   * collision (decision 0060). For Java a test hook; a run that can't force one skips those cases.
   */
  ids(source: IdSource | undefined): void;
  /**
   * Runs the backend's scheduled jobs at `at`: the access sweep (recertification lapses, the inactivity flag and
   * suspension), then the sunset sweep. Locally and in the fake a direct call; for Java a test endpoint, since
   * they are its scheduled jobs.
   */
  runScheduledJobs(at: Date): Promise<void>;
  /** A consumer's notices as `GET /api/v1/consumers/{id}/notices` serves them, oldest first (commit order). */
  consumerNotices(
    consumerId: string,
    templateId?: string,
  ): Promise<ApiNotice[]>;
  /** What a command wrote that no moved read serves yet. It shrinks as areas move, and is gone by the end of 2b. */
  readonly probe: ContractProbe;
}

/** An audit row, as facts. */
export interface ProbeAuditEvent {
  action: string;
  /** ISO. */
  at: string;
  actorId: string | null;
  teamId: string | null;
  templateId: string | null;
  versionId: string | null;
  details: Record<string, unknown> | null;
}

/** A version's content, rev and writers, as facts. */
export interface ProbeVersion {
  state: VersionState;
  rev: number;
  name: string;
  body: JSONContent;
  variables: Variable[];
  channels: Channel[];
  channelFields: ChannelFields;
  sampleSets: SampleSet[];
  /** Who wrote it (maker-checker), in the order they first did. */
  writers: string[];
}

/**
 * Reads what a command wrote that no service read serves yet: SQL for the local implementation, the arrays for
 * the fake, test endpoints for Java. A template's audit rows are read through `audit.activity`, notifications
 * through `notifications.list`, consumer notices through `/api/v1`.
 */
export interface ContractProbe {
  /**
   * A version as stored: what an autosave wrote. Its content until `templates.workspaceDocument` serves it (plan
   * P4a); its writers until a moved read shows them (approve's maker-checker, plan P1). Null when there is none.
   */
  version(filter: { versionId: string }): Promise<ProbeVersion | null>;
  /**
   * A template as stored, with its version rows and every audit row that names it (`template.created` names no
   * version). Null when there is none. The rows' facts until a moved read serves them (plan P4a).
   */
  template(filter: { templateId: string }): Promise<ProbeTemplate | null>;
  /** Every template's id: what a refused create must leave as it was. */
  templateIds(): Promise<string[]>;
  /** A template's comment threads with their comments, in the order they were written, until `comments.threads` moves (plan P4a). */
  threads(filter: { templateId: string }): Promise<ProbeThread[]>;
}

/** A template row, its version rows and the audit rows that name it, as facts. */
export interface ProbeTemplate {
  teamId: string;
  contentTypeId: string;
  starterKey: string | null;
  createdBy: string;
  /** ISO. */
  createdAt: string;
  /** In the order they were written. */
  versions: ProbeVersionRow[];
  /** In the order they were written. */
  audit: ProbeAuditEvent[];
}

/** A version row's content and bookkeeping, as facts. */
export interface ProbeVersionRow {
  id: string;
  state: VersionState;
  rev: number;
  name: string;
  body: JSONContent;
  variables: Variable[];
  channels: Channel[];
  channelFields: ChannelFields;
  sampleSets: SampleSet[];
  /** Who wrote it (maker-checker), in the order they first did. */
  writers: string[];
  basedOnVersionId: string | null;
  importUploadId: string | null;
  createdBy: string;
  /** ISO. */
  createdAt: string;
}

/** A comment thread and what was said in it, as facts. */
export interface ProbeThread {
  id: string;
  /** The version it began on. */
  originVersionId: string;
  blockId: string;
  quote: string | null;
  status: "open" | "resolved";
  resolvedBy: string | null;
  /** ISO. */
  resolvedAt: string | null;
  /** ISO. */
  createdAt: string;
  comments: { authorId: string; body: string; kind: string; at: string }[];
}

/** A version row as the probe answers it: the facts a case compares, never its instants. */
export function probeVersion(v: ProbeVersion): ProbeVersion {
  return {
    state: v.state,
    rev: v.rev,
    name: v.name,
    body: v.body,
    variables: v.variables,
    channels: v.channels,
    channelFields: v.channelFields,
    sampleSets: v.sampleSets,
    writers: v.writers,
  };
}

/** A version row as the probe answers it: the facts a case compares, with its instant as ISO. */
export function probeVersionRow(
  v: Omit<ProbeVersionRow, "createdAt"> & { createdAt: Date },
): ProbeVersionRow {
  return {
    id: v.id,
    state: v.state,
    rev: v.rev,
    name: v.name,
    body: v.body,
    variables: v.variables,
    channels: v.channels,
    channelFields: v.channelFields,
    sampleSets: v.sampleSets,
    writers: v.writers,
    basedOnVersionId: v.basedOnVersionId,
    importUploadId: v.importUploadId,
    createdBy: v.createdBy,
    createdAt: v.createdAt.toISOString(),
  };
}
