import type { ApiNotice } from "@/domain/golive-types";
import type { PushPlatform } from "@/domain/messages/push";
import type { Channel } from "@/domain/types";
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
// clock, decision 0068), and observes what a command wrote through reads: the services' own (a template's audit
// rows through `audit.activity`, a draft through the workspace's document and Compare, notifications through
// `notifications.list`) and the consumer notices `/api/v1` serves. It compares state before and after a
// command, never finds a write by its instant.

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
}

/** One render, as the render log holds it. */
export interface RecordedRender {
  /** ISO. */
  at: string;
  templateId: string;
  /** The number of the version rendered: the row a consumer's number means (its released row, else its latest round). */
  versionNumber: number;
  /** null for a render nobody registered asked for. */
  consumerId: string | null;
  channel: Channel;
  /** A push's phone. */
  platform?: PushPlatform | null;
  /** A preview (Stencil's own, never usage). */
  isPreview?: boolean;
  outcome?: "ok" | "error";
  /** A failed render's code. */
  errorCode?: string | null;
}

/**
 * Puts renders in the render log with the exact instants a case needs, in the order given (the order is the
 * log's write order, which breaks ties between equal instants). It stands in for consumers calling the render
 * API: the local implementation inserts rows, and Java would take them at a test endpoint, since a case can't
 * make the render API run at an instant of its choosing. Reads of the counts (`usage`) don't need the fake, so
 * only the harnesses that run the Usage cases provide it.
 */
export interface RenderRecorder {
  record(renders: readonly RecordedRender[]): Promise<void>;
}

/** A harness whose backend serves the Usage counts: it can also record renders. */
export interface UsageHarness extends ContractHarness {
  readonly renders: RenderRecorder;
}
