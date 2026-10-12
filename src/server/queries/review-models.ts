// The review area's read models: what `getReviewQueue` and `getReviewScreen` (review.ts) hand the screens.
// Types only. Dates are ISO strings (they cross into client components), and permissions come decided
// (`can`). What a domain rule takes or returns stays in src/domain (review-types.ts: `Person`, `StepView`,
// `ConsumerUsage`, …).

import type { ChannelFields } from "@/domain/channel-fields";
import type {
  MessageTypeRules,
  TeamSenders,
} from "@/domain/platform-config/limits";
import type { ConsumerUsage, Person, StepView } from "@/domain/review-types";
import type { NumberedRound } from "@/domain/rounds";
import type {
  Channel,
  ChannelFamily,
  ContractChange,
  JSONContent,
  PermissionResult,
  SampleSet,
  Variable,
  VersionState,
} from "@/domain/types";
import type { ThreadView } from "./threads";

/** The sunset picker's calendar: the business time zone and today's date in it (decision 0017). */
export interface SunsetCalendar {
  /** IANA id, "America/New_York". The picker names it: "Ends at 00:00 Eastern (America/New_York)". */
  zone: string;
  /** YYYY-MM-DD: today in `zone` on the demo clock. The earliest sunset date is the day after. */
  today: string;
}

export interface ReviewQueueRow {
  templateId: string;
  /** The row's version's name: what was submitted for review. */
  templateName: string;
  teamSlug: string;
  teamName: string;
  versionId: string;
  versionNumber: number;
  /** Which submission of `versionNumber` this row is (rounds.ts): `versionLabel` and `reviewPath` read it. */
  round: number;
  state: VersionState;
  author: Person;
  submittedAt: string;
  stage: { position: number; name: string; count: number };
  breaking: boolean;
  /** Recently decided only. */
  decision?: { kind: "approved" | "changes_requested"; by: Person; at: string };
}

export interface ReviewQueue {
  waiting: ReviewQueueRow[]; // the viewer can act on the current stage, and didn't submit it
  submitted: ReviewQueueRow[]; // submitted by the viewer, still in review
  decided: ReviewQueueRow[]; // decided in the last 30 days, on teams the viewer can see
}

export interface ReviewScreenData {
  /** `family`: its content type's (`contentTypeFamily`), never read from a version's channels. */
  template: {
    id: string;
    teamId: string;
    teamSlug: string;
    teamName: string;
    family: ChannelFamily;
  };
  version: {
    id: string;
    number: number;
    /** The round on screen: `?round=`, or the number's head without one. */
    round: number;
    state: VersionState;
    /** The template's name as this version has it: the header's title, and what goes live. */
    name: string;
    body: JSONContent;
    variables: Variable[];
    channels: Channel[];
    sampleSets: SampleSet[];
    /** Each channel's own fields (channel-fields.ts). */
    channelFields: ChannelFields;
    /** The SMS footer frozen into this version at submit (null: none): what its SMS ends with, whatever the content type's is now. */
    smsFooter: string | null;
    submittedBy: Person;
    submittedAt: string;
    submitNote: string | null;
    /** YYYY-MM-DD in the business time zone: the day a Superseded version stops rendering (the header's badge shows it). */
    sunsetDay?: string | null;
    /** The sunset has passed (`sunsetPassed`): the header's badge says "Sunset passed". */
    sunsetPassed: boolean;
    contractChanges: ContractChange[];
    /** Plain-English lines from domain/contract.ts: "v2 adds required `annual_fee` (Currency)." */
    contractLines: string[];
  };
  /**
   * What the redline, its "vs vN" label and the change count compare with (`reviewBaseline`): the Active
   * version; with none Active (after a revoke), the released version the draft was based on, then the
   * newest version that still renders. Never a round's own number: a round sent back before its number
   * went live compares with the released version it was drafted from. Null for a first version, or when
   * that would be this version. `state` is for the label ("vs v3 (revoked)"). The contract changes come
   * from submit (`contractBaseline`). Its channels, channel fields and SMS footer are what the fields'
   * redline compares with (`diffChannelFields`).
   */
  baseline: {
    id: string;
    number: number;
    state: VersionState;
    body: JSONContent;
    variables: Variable[];
    channels: Channel[];
    channelFields: ChannelFields;
    smsFooter: string | null;
  } | null;
  /**
   * The Active version this one would replace, for the Approve dialog's consequences and its sunset
   * offer. Null when nothing is Active, or the Active version is this one or its number's release. Not
   * `baseline`: after a revoke the redline compares with the revoked version, which approving replaces
   * nothing of.
   */
  previousNumber: number | null;
  /**
   * With nothing Active (after a revoke), the newest version that still renders (`contractBaseline`): the
   * version its consumers move from, which the Approve dialog's consequences name (N3), with its sunset day
   * in the business time zone when it has one. `contractChanges` are this version's against it, worked out
   * when the screen loads with `diffVariables` (what submit stores is against whatever was Active at
   * submit, which may be a version revoked during review): the breaking ones are what its consumers have
   * to map. Null when a version is Active, when nothing renders, and when it is this version's own number.
   */
  stillRenders: {
    number: number;
    sunsetDay: string | null;
    contractChanges: ContractChange[];
  } | null;
  /**
   * Where this round's work went (`replacedBy`), when it is a sent-back round that was resubmitted: its
   * number's head, a later round or the release, with its label ("v3, round 2", or "v3" once released).
   * Null when this round is the head (in review, released, or sent back with only a draft after it), and
   * when the viewer can't open the head.
   */
  replacedBy: (NumberedRound & { label: string }) | null;
  /**
   * The name customers get today, which the rail shows a rename against: the Active version's or, with
   * none Active, the newest version that still renders (`renameBaseline`). For a round sent back before
   * its number went live, the name of the version it was drafted from. Null when nothing else renders,
   * or that is this version.
   */
  liveName: string | null;
  steps: StepView[];
  threads: ThreadView[];
  can: {
    approve: PermissionResult;
    requestChanges: PermissionResult;
    comment: PermissionResult;
  };
  /** For the approve dialog: computes consequences client-side as the sunset date changes. */
  consumerUsage: ConsumerUsage[];
  /** YYYY-MM-DD, demo clock (UTC): the sample sets' "today". */
  today: string;
  /** The approve dialog's sunset picker. */
  sunsetCalendar: SunsetCalendar;
  /**
   * What the phone preview renders a message version with: the SMS footer is the version's own (frozen at
   * submit, as `version.smsFooter`), the part budget the content type's.
   */
  messageRules: MessageTypeRules;
  /** Who the team's messages come from on the phone preview. */
  senders: TeamSenders;
}
