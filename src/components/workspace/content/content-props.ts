// The Content tab's props, one object per concern. `workspace-content.tsx` (the server component that
// reads the document) builds them; `content-workspace.tsx` hands each to the hook or the cell that uses it.
// Types only.

import type { ChannelFields } from "@/domain/channel-fields";
import type { ImportOriginalRef } from "@/domain/import-types";
import type {
  MessageTypeRules,
  TeamSenders,
} from "@/domain/platform-config/limits";
import type { Person } from "@/domain/review-types";
import type {
  Channel,
  ChannelFamily,
  JSONContent,
  SampleSet,
  Variable,
} from "@/domain/types";
import type { ThreadView } from "@/server/queries/threads";

/** Which version of which template is on screen, and whether the viewer can edit it. */
export interface ContentVersion {
  templateId: string;
  /** A document (the editor) or a message (the composer): the content type's family, for the template's whole life. */
  family: ChannelFamily;
  versionId: string;
  /** The shown version's number; null for an open draft (the preview renders "draft"). */
  versionNumber: number | null;
  /** The shown version's round; null for an open draft. The preview renders exactly it. */
  round: number | null;
  /** Where autosave starts. */
  rev: number;
  /** An open draft the viewer can edit. Otherwise everything is read-only and nothing autosaves. */
  editable: boolean;
}

/** What the page opens with: the draft's saved fields. A refresh doesn't reset a draft being edited. */
export interface ContentDraft {
  body: JSONContent;
  variables: Variable[];
  /** The variables of the newest version that still renders, for contract flags on a draft; null when none does. */
  baseline: Variable[] | null;
  channels: Channel[];
  allowedChannels: Channel[];
  /** Each channel's own fields, as the version stores them (src/domain/channel-fields.ts). */
  channelFields: ChannelFields;
  sampleSets: SampleSet[];
}

/** What the message composer and the preview need to show something as it will be sent. */
export interface ContentPreview {
  /** The team's name: the email preview's sender. */
  teamName: string;
  /** The content type's SMS footer and part budget (a message's composer and preview). */
  messageRules: MessageTypeRules;
  /** Who the team's messages come from on the phone preview. */
  senders: TeamSenders;
  /** The demo clock's date, YYYY-MM-DD. */
  today: string;
}

/** The review threads against the shown version, and who may add to them. */
export interface ContentComments {
  /** The template's review threads against the shown version (change requests, comments, resolved ones). */
  threads: ThreadView[];
  /** The viewer may comment: reply, resolve, reopen, and start a thread (the Comment button). */
  canComment: boolean;
  /** The viewer, for the comments they write before the server confirms them. */
  viewer: Person;
  /** The demo clock's now (ISO): "3h ago" is measured from it. */
  now: string;
}

/** What the rail adds to the editing: the file the template came from, and the review it is in. */
export interface ContentRail {
  /** The file the template was imported from (the rail's Original tab), on every version; null when it wasn't imported. */
  importOriginal: ImportOriginalRef | null;
  /** The shown version is in review: the rail links to its review screen. */
  reviewHref: string | null;
}

export interface ContentWorkspaceProps {
  version: ContentVersion;
  draft: ContentDraft;
  preview: ContentPreview;
  comments: ContentComments;
  rail: ContentRail;
}
