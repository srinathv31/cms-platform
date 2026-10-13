// The review queue and the review screen as facts (`ReviewService.queue` and `.screen`): ids, ISO instants,
// days, decided `PermissionResult`s and the people they name. The BFF words them (version labels, contract
// lines, "3 days ago") and lays them out; everything decided is decided behind the seam
// (src/domain/review-access.ts, src/domain/lifecycle/baselines.ts).

import type { ChannelFields } from "@/domain/channel-fields";
import type {
  MessageTypeRules,
  TeamSenders,
} from "@/domain/platform-config/limits";
import type { ReviewScreenActions } from "@/domain/review-access";
import type {
  ConsumerUsage,
  Person,
  VersionStage,
} from "@/domain/review-types";
import type { NumberedRound } from "@/domain/rounds";
import type {
  Channel,
  ChannelFamily,
  ContractChange,
  JSONContent,
  SampleSet,
  Variable,
} from "@/domain/types";
import type { ThreadFacts } from "./threads";

// ── The queue ────────────────────────────────────────────────

/** One round in a review queue. A number sent back and resubmitted has a row per round. */
export interface QueueRow {
  templateId: string;
  /** The round's name: what was submitted for review. */
  templateName: string;
  teamId: string;
  /** The team's URL name, for the row's link. */
  teamSlug: string;
  teamName: string;
  versionId: string;
  round: NumberedRound;
  /** User id: its submitter (its creator for a row recorded without one). */
  authorId: string;
  /** ISO: when it was submitted (created, for a row recorded without). */
  submittedAt: string;
  /** "Stage 2 of 3": the stage's position in the round's own stages, the name it recorded, and how many. */
  stage: { position: number; name: string; count: number };
  /** It changes the contract in a way consumers must act on. */
  breaking: boolean;
}

/** A round decided recently, with its latest decision. */
export interface DecidedRow extends QueueRow {
  decision: {
    kind: "approved" | "changes_requested";
    /** User id. */
    by: string;
    /** ISO. */
    at: string;
  };
}

/** The review queue of a space, for one viewer. */
export interface ReviewQueueFacts {
  /** ISO: the backend's instant the queue was read at; "recently decided" counts back from it. */
  asOf: string;
  /** In review, theirs to decide now (`queuePlacement`). */
  waiting: QueueRow[];
  /** Submitted by them, still in review. */
  submitted: QueueRow[];
  /**
   * Decided in the `DECIDED_WINDOW_DAYS` before `asOf` on the space's teams: each round's latest decision,
   * newest first.
   */
  decided: DecidedRow[];
  /** Everyone the rows name. */
  people: Person[];
}

/** "Recently decided" looks back this far. */
export const DECIDED_WINDOW_DAYS = 30;

// ── The screen ───────────────────────────────────────────────

/** A version's content, as the redline compares with it. */
export interface VersionContentFacts {
  id: string;
  number: number;
  state: NumberedRound["state"];
  body: JSONContent;
  variables: Variable[];
  channels: Channel[];
  channelFields: ChannelFields;
  /** The SMS footer frozen into it at submit; null: none. */
  smsFooter: string | null;
}

/** The round on screen. */
export interface ScreenRoundFacts extends VersionContentFacts {
  round: number;
  /** The template's name as this round has it: the header's title, and what goes live. */
  name: string;
  sampleSets: SampleSet[];
  /** User id: its submitter (its creator for a row recorded without one). */
  submittedBy: string;
  /** ISO. */
  submittedAt: string;
  submitNote: string | null;
  /** YYYY-MM-DD in the business time zone: the day a Superseded version stops rendering. */
  sunsetDay: string | null;
  /** Its sunset has passed (`sunsetPassed`, at `asOf`). */
  sunsetPassed: boolean;
  /** The contract changes frozen at submit. */
  contractChanges: ContractChange[];
  /** Its own stages (recorded at submit), in order, and the one it waits on (or that sent it back). */
  stages: VersionStage[];
  currentStage: number;
  /** Its decisions, oldest first: the stepper's who and when. */
  decisions: {
    /** The stage it was made at; null for one recorded before stage ids. */
    stageId: string | null;
    kind: "approved" | "changes_requested";
    /** User id. */
    by: string;
    /** ISO. */
    at: string;
  }[];
}

/** Everything one round's review screen shows, as facts. */
export interface ReviewScreenFacts {
  /** ISO: the backend's instant the screen was decided at (`can`, `sunsetPassed`, the usage, today). */
  asOf: string;
  /** `family`: its content type's, never read from a version's channels. */
  template: {
    id: string;
    teamId: string;
    teamSlug: string;
    teamName: string;
    family: ChannelFamily;
  };
  /** The round the URL opens for the viewer (`roundToOpen`). */
  version: ScreenRoundFacts;
  /** What the redline compares with (`reviewScreenBaselines`'s `redline`). */
  baseline: VersionContentFacts | null;
  /** The number of the Active version approving this one replaces (`replaces`). */
  previousNumber: number | null;
  /**
   * With nothing Active, the newest version that still renders (`stillRenders`), with its sunset day and this
   * round's contract changes against it: what its consumers have to map.
   */
  stillRenders: {
    number: number;
    sunsetDay: string | null;
    contractChanges: ContractChange[];
  } | null;
  /**
   * Where a sent-back round's work went: its number's head (`replacedBy`), only when the viewer may open it
   * (`mayOpenRound`). Null for the head itself.
   */
  replacedBy: NumberedRound | null;
  /** The name a rename is shown against (`renamedFrom`'s name); null when there is none. */
  liveName: string | null;
  /** The threads that began by this round, against its anchors. */
  threads: ThreadFacts[];
  can: ReviewScreenActions;
  /** For the Approve dialog's consequences: per consumer and version number, renders in the 30 days before `asOf`. */
  consumerUsage: ConsumerUsage[];
  /** The sunset picker's calendar: the business time zone, and today there. */
  sunsetCalendar: { zone: string; today: string };
  /** What the phone preview renders a message round with: the SMS footer is the round's own. */
  messageRules: MessageTypeRules;
  /** Who the team's messages come from on the phone preview. */
  senders: TeamSenders;
  /** Everyone the facts name, and the viewer (their own comments show under their name at once). */
  people: Person[];
}
