import type { RequestContext, Services } from "../types";

// What the contract suite needs from an implementation to run its cases (decision 0068). Each implementation
// has one: the fake (services/fake/testing.ts), the local implementation (services/local/testing.ts), and
// later the Java API's, which calls the HTTP implementation against a test environment.
//
// A case acts only through the service interfaces, starting from the seeded world (the same people, teams
// and template ids in every implementation: the seed, or for Java the fixture the seed exports). It travels
// in time by asking for a context at a later instant, which for Java sets the test-only clock offset. What a
// command wrote that no read shows yet (an audit row, a consumer notice, a notification) it reads through
// the probe.

/** The implementation under test, as one case sees it. A fresh, seeded backend for every test. */
export interface ContractHarness {
  /** Which implementation, for the test names. */
  readonly name: string;
  /** The seed's template ids by key (`templates["balance-transfer"]`); filled before the first test. */
  readonly templates: Record<string, string>;
  /** The implementation, over this test's data. */
  services(): Services;
  /** A request context for a seeded person at `at`: the backend's clock reads `at` for this request. */
  as(userId: string, at: Date): Promise<RequestContext>;
  /** What the backend wrote, read beside the service interfaces. */
  readonly probe: ContractProbe;
}

/** An audit row as the probe reads it. */
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

/** A consumer notice as the probe reads it. */
export interface ProbeNotice {
  seq: number;
  consumerId: string;
  templateId: string;
  versionId: string;
  kind: string;
  payload: Record<string, unknown>;
  /** ISO. */
  createdAt: string;
}

/** A notification as the probe reads it. */
export interface ProbeNotification {
  userId: string;
  kind: string;
  title: string;
  href: string | null;
  /** ISO. */
  createdAt: string;
}

/**
 * Reads what a command wrote that the service interfaces don't serve yet. SQL for the local implementation,
 * the arrays for the fake; for Java, test endpoints or JDBC (the e2e state helper's job too). A case reads
 * through a service when one serves it.
 */
export interface ContractProbe {
  /** The audit rows about a version, oldest first. */
  auditEvents(filter: { versionId: string }): Promise<ProbeAuditEvent[]>;
  /** The consumer notices about a template, in `seq` order. */
  consumerNotices(filter: { templateId: string }): Promise<ProbeNotice[]>;
  /** A person's notifications, oldest first. */
  notifications(filter: { userId: string }): Promise<ProbeNotification[]>;
}
