// A template's workspace as facts (`TemplateService.workspaceHeader` and `.workspaceDocument`): the version it
// shows (the open draft, else the latest round: `latestVersion`), what the viewer may do there, decided, and the
// document the Content tab edits or shows. The BFF words the labels ("Based on v2") and lays them out.

import type { ChannelFields } from "@/domain/channel-fields";
import type { WorkspaceActions } from "@/domain/lifecycle/version-actions";
import type {
  MessageTypeRules,
  TeamSenders,
} from "@/domain/platform-config/limits";
import type { Person } from "@/domain/review-types";
import type { NumberedRound, RoundRef } from "@/domain/rounds";
import type {
  Channel,
  ChannelFamily,
  JSONContent,
  PermissionResult,
  SampleSet,
  Variable,
  VersionState,
} from "@/domain/types";
import type { ThreadFacts } from "./threads";

/** The workspace header, on every tab: the template, the version it shows, and what the viewer may do. */
export interface WorkspaceHeaderFacts {
  /** ISO: the backend's instant the header was decided at (`sunsetPassed`, `can`). */
  asOf: string;
  /** `teamSlug` is the team's URL name, for links; compare teams by `teamId` (decision 0053). */
  template: {
    id: string;
    teamId: string;
    teamSlug: string;
    teamName: string;
  };
  /** The version the workspace shows: the open draft, else the latest round. Null for a template with none. */
  shown: {
    id: string;
    /** Null for the open draft. */
    number: number | null;
    round: number | null;
    state: VersionState;
    /** The template's name as this version has it: the field the author renames on a draft. */
    name: string;
    /** YYYY-MM-DD: its sunset's day in the business time zone. */
    sunsetDay: string | null;
    /** Its sunset has passed (at `asOf`). */
    sunsetPassed: boolean;
    /** Its compare-and-set revision: where autosave starts on a draft. */
    rev: number;
  } | null;
  /** The number and round the shown version has, or will get at submit when it is a draft (`nextRound`). */
  numbered: RoundRef;
  /** The version the open draft was started from; null when it isn't a draft, or wasn't started from one. */
  basedOn: NumberedRound | null;
  /** The Active version: what consumers get. */
  active: { number: number; name: string } | null;
  /** The round in review, if there is one: the workspace links to its review screen. */
  inReview: NumberedRound | null;
  can: WorkspaceActions;
}

/** The file an imported template came from (its rail's Original tab), on every version. */
export interface ImportOriginalFacts {
  uploadId: string;
  filename: string;
  kind: "docx" | "pdf" | "txt";
  /** Bytes. */
  size: number;
  /** ISO. */
  uploadedAt: string;
  /** User id. */
  uploadedBy: string;
}

/** The document the Content tab shows: the open draft if there is one, otherwise the latest round. */
export interface WorkspaceDocumentFacts {
  /** ISO: the backend's instant it was read at (the baseline, today's date for the samples, the margin's times). */
  asOf: string;
  template: {
    id: string;
    teamId: string;
    teamName: string;
    /** Fixed by its content type: a document (the editor) or a message (the composer), decision 0034. */
    family: ChannelFamily;
    /** The channels its content type allows: what the Channels selector offers. */
    allowedChannels: Channel[];
  };
  version: {
    id: string;
    /** Null for the open draft. */
    number: number | null;
    round: number | null;
    state: VersionState;
    /** Where autosave starts. */
    rev: number;
    body: JSONContent;
    variables: Variable[];
    channels: Channel[];
    /** Each channel's own fields, whether or not the channel is on. */
    channelFields: ChannelFields;
    sampleSets: SampleSet[];
  };
  /**
   * On a draft, the variables of the newest version that still renders (`contractBaseline`), for the contract
   * flags. Null when none does, and on a submitted version.
   */
  baseline: Variable[] | null;
  /** The SMS footer this version prints (`smsFooterOf`) and the content type's part budget. */
  messageRules: MessageTypeRules;
  /** Who the team's messages come from on the phone preview. */
  senders: TeamSenders;
  /** Every thread on the template, against the shown version's anchors (the editor's margin). */
  threads: ThreadFacts[];
  can: {
    /** Edit the team's drafts: with an open draft shown, the editor is live. */
    edit: PermissionResult;
    /**
     * Start a thread, reply, resolve and reopen: the comment permission on the team, on a version that takes
     * comments. The workspace is the team's: whoever a review stage names comments from the review screen.
     */
    comment: PermissionResult;
  };
  /** Null when the template wasn't imported. */
  importOriginal: ImportOriginalFacts | null;
  /** Everyone the facts name, and the viewer (their own comments show under their name at once). */
  people: Person[];
}
