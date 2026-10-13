import type { ApiNotice } from "@/domain/golive-types";
import type { TestHooks } from "../options";
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
   * Runs the backend's scheduled jobs at `at`: the sunset sweep (the access sweep joins with plan P2). Locally and
   * in the fake a direct call; for Java a test endpoint, since they are its scheduled jobs.
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

/**
 * Reads what a command wrote that no service read serves yet: SQL for the local implementation, the arrays for
 * the fake, test endpoints for Java. Nothing today: a template's audit rows are read through `audit.activity`,
 * notifications through `notifications.list`, consumer notices through `/api/v1`. Integration (2b-2) removes it.
 */
export type ContractProbe = Record<string, never>;
