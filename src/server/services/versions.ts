// One template's versions behind the seam: the facts the Versions tab is built from, and the two reads the
// workspace makes on demand (Compare, "Revert to vN"). The BFF words and lays them out (labels, contract
// lines, the timeline's grouping by number); everything decided is decided here.
//
// `history` runs behind the seam (local and fake). `compare` and `baseVersion` are typed here and still run
// in src/server/queries/ until they move.

import type { VersionActions } from "@/domain/lifecycle/version-actions";
import type { ConsumerUsage, Person } from "@/domain/review-types";
import type {
  ContractChange,
  RevokeRecord,
  VersionState,
} from "@/domain/types";
import type { ReadResult, RequestContext, Unsettled } from "./types";

/** A decision on a round: one `approvals` row. */
export interface DecisionFacts {
  kind: "approved" | "changes_requested";
  /** The stage's name as the version recorded it. */
  stageName: string;
  /** User id. */
  by: string;
  /** ISO. */
  at: string;
  reason: string | null;
}

/** One version row (a draft, or one round of a number) with what the viewer may do on it now. */
export interface VersionFacts {
  id: string;
  /** null for the open draft. */
  number: number | null;
  /** null for the open draft. */
  round: number | null;
  state: VersionState;
  /**
   * The row that stands for its number (`headOf` in domain/rounds.ts: the released row, else the latest
   * round), or the open draft. The Versions timeline shows one per number.
   */
  head: boolean;
  /** User id. */
  createdBy: string;
  /** ISO. */
  createdAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  submitNote: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  /** ISO: the instant renders stop, 00:00 on `sunsetDay` in the business time zone. */
  sunsetAt: string | null;
  /** YYYY-MM-DD: the sunset's day in the business time zone. */
  sunsetDay: string | null;
  /** The sunset has come: renders of it fail (`sunsetPassed`, at `asOf`). */
  sunsetPassed: boolean;
  revoke: RevokeRecord | null;
  /** The contract changes frozen at submit; null for a draft. */
  contractChanges: ContractChange[] | null;
  /** Its decisions, oldest first. */
  decisions: DecisionFacts[];
  /** ISO: the latest non-preview render by a registered consumer; null when none. */
  lastRenderAt: string | null;
  /** Non-preview renders by registered consumers in the 30 days before `asOf`. */
  renders30d: number;
  /** What the viewer may do on it now (`versionActions`). */
  can: VersionActions;
}

/** Everything the Versions tab shows, as facts. */
export interface VersionHistory {
  /** ISO: the backend's instant the facts were read and decided at (`sunsetPassed`, `renders30d`, `can`, today). */
  asOf: string;
  /**
   * `name` is the CMS's name for the template: its open draft's, otherwise its newest version's. `teamSlug`
   * is its team's URL name, for links; compare teams by `teamId` (decision 0053).
   */
  template: { id: string; teamId: string; teamSlug: string; name: string };
  /** Every row, rounds included: the open draft first, then newest first (`compareRounds`). */
  versions: VersionFacts[];
  /** Per consumer and version number: the last render and the renders in 30 days. Newest number first. */
  consumerUsage: ConsumerUsage[];
  /** The sunset picker's calendar: the business time zone, and today there (YYYY-MM-DD). */
  sunsetCalendar: { zone: string; today: string };
  /** Everyone the facts name by id. */
  people: Person[];
}

export interface VersionService {
  /**
   * The template's versions for the Versions tab. Refuses 404 `template_unavailable` when the template
   * doesn't exist or the viewer may not see its team (the two read the same, decision 0052).
   */
  history(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<VersionHistory>>;

  /** Two versions' content for Compare (`from` and `to` are version ids). */
  compare(
    ctx: RequestContext,
    input: { templateId: string; from: string | null; to: string | null },
  ): Promise<ReadResult<Unsettled<"P4a: two versions' content, as facts">>>;

  /** The content the draft on screen was started from ("Revert to v3"). */
  baseVersion(
    ctx: RequestContext,
    input: { templateId: string; versionId: string | null },
  ): Promise<ReadResult<Unsettled<"P4a: the base version's content">>>;
}
