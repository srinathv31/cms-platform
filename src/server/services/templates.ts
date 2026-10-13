// Templates as a whole: making one (New template, Import), opening a draft (Edit), an imported file's original,
// and the reads the Library, the ⌘K palette and the template workspace are built from. A space is a team id, or
// null for All teams (decision 0053).
//
// The documents a new template starts with are built and prepared by the BFF, never behind the seam: a starter
// (src/server/starters) or an uploaded file converted by the importer (src/server/import), fitted to the content
// type, normalized and given block ids (decision 0065). The backend stores what it is handed, after checking the
// team, the content type and the channels; the Java API doesn't port the importer or the starter catalog. What the
// BFF needs to build a draft comes from `newTemplateType`: the content type a new template of the kind is made on,
// its required sections and allowed channels, and the backend's instant (`asOf`) the starter's sample dates are set
// from, since the BFF reads no clock.
//
// A new template's id is the backend's: it draws a random one, inserts, and retries the whole write with another
// when the insert finds it taken, three attempts at most (decision 0060).
//
// The commands run behind the seam (local and fake), and so do the workspace's two reads (local; their facts are
// in ./workspace.ts). The reads that are `Unsettled` still run in src/server/queries/ until their package moves
// them (plan.md).

import type { DraftContent } from "@/domain/lifecycle/types";
import type { ImportKind, ImportReport } from "@/domain/import-report";
import type { Person } from "@/domain/review-types";
import type { Channel, ChannelFamily, RequiredSection } from "@/domain/types";
import type {
  ActionResult,
  Changed,
  ReadResult,
  RequestContext,
  Unsettled,
} from "./types";
import type { WorkspaceDocumentFacts, WorkspaceHeaderFacts } from "./workspace";

export type { DraftContent };

/**
 * What a new template of a kind is made on, as the backend picked it (`newTemplateContentType`: the platform's
 * content type of that family, the first by name): the id `create` takes, and what fits the draft to it.
 */
export interface NewTemplateType {
  /** ISO: the backend's instant the facts were read at. The starter's sample dates are set relative to it. */
  asOf: string;
  contentTypeId: string;
  /** The content type's required sections now, in order. */
  requiredSections: RequiredSection[];
  /** The channels the content type allows now; a new template's are a subset. */
  allowedChannels: Channel[];
}

/** An imported file's original, as the backend keeps it. */
export interface ImportedOriginal {
  uploadId: string;
  /** The file's display name (never a path). */
  filename: string;
  kind: ImportKind;
  /** Bytes. */
  size: number;
  /** ISO. */
  uploadedAt: string;
  uploadedBy: Person;
}

export interface TemplateService {
  /**
   * What a new template of this kind is made on in the team, for the BFF to build its first draft by. Refuses, in
   * order: the permission (`template.create` on the team; `generic`, 403), a team that is gone (`team_gone`, 404),
   * a kind no content type makes (`no_content_type`, 409).
   */
  newTemplateType(
    ctx: RequestContext,
    input: { teamId: string; family: ChannelFamily },
  ): Promise<ReadResult<NewTemplateType>>;

  /**
   * New template: the template and its first draft, in the content type the BFF chose for the kind the author
   * picked, dated by the backend's clock, with the author as its only writer. Refuses, in order: the permission,
   * `team_gone`, `content_type_gone`, then the draft's channels (`no_channels`, `channel_unavailable`); nothing is
   * written. Inserts with a fresh id and retries the whole write on a collision (decision 0060).
   */
  create(
    ctx: RequestContext,
    input: { teamId: string; contentTypeId: string; draft: DraftContent },
  ): Promise<ActionResult<{ templateId: string }>>;

  /** May the viewer create in the team? Asked before an upload is read: the permission, then `team_gone`. */
  createPermission(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ActionResult>;

  /**
   * Import: a template and its draft from a file the BFF converted, with the original and the report kept (the
   * report's `kind` names how). `compareHtml` is the docx's allowlisted Compare view, derived by the BFF's
   * conversion and stored with the original. Refuses as `create` does, and writes nothing when it refuses: the
   * original is stored only with the template. The audit row names the file's kind and name.
   */
  createImported(
    ctx: RequestContext,
    input: {
      teamId: string;
      contentTypeId: string;
      draft: DraftContent;
      original: { filename: string; mime: string; bytes: Uint8Array };
      report: ImportReport;
      compareHtml: string | null;
    },
  ): Promise<ActionResult<{ templateId: string; uploadId: string }>>;

  /**
   * Edit: the template's open draft, started from its latest version when there is none, with the person who
   * pressed Edit as its only writer. `changed` is false when a draft was open already (a double click, two tabs,
   * or two Edits at once: the one-draft index lets one in and the other opens it). Refuses, in order: the
   * permission (`generic`; an unknown template is refused the same), `newer_in_review`, `not_editable`.
   * `teamSlug` is the template's team's URL name, for the BFF's redirect.
   */
  startDraft(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ActionResult<Changed & { draftId: string; teamSlug: string }>>;

  /** The Library's rows for a space. */
  library(
    ctx: RequestContext,
    input: { teamId: string | null },
  ): Promise<ReadResult<Unsettled<"P4c: the Library's facts">>>;

  /** The ⌘K palette's search in a space. */
  palette(
    ctx: RequestContext,
    input: {
      teamId: string | null;
      q: string | null;
      templateId: string | null;
    },
  ): Promise<ReadResult<Unsettled<"P4c: the palette's results">>>;

  /**
   * The workspace header, on every tab: the version the workspace shows (its name, state and sunset), its
   * labels' facts, and what the viewer may do there (`workspaceActions`). Refuses 404 `template_unavailable`
   * when the template doesn't exist or the viewer may not see its team (the two read the same, decision 0052).
   */
  workspaceHeader(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<WorkspaceHeaderFacts>>;

  /**
   * The document the Content tab edits or shows (the open draft, else the latest round), with its margin's
   * threads and what the viewer may do with it. Refuses as `workspaceHeader`.
   */
  workspaceDocument(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<WorkspaceDocumentFacts>>;

  /** The SHARE panel's facts: what a consumer sends and gets (its worded examples are the BFF's). */
  integration(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<Unsettled<"P4c: the integration panel's facts">>>;

  /** What the Copilot prompt is built from (the prompt's words are the BFF's). */
  copilotPrompt(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<Unsettled<"P4c: the Copilot prompt's facts">>>;

  /**
   * An imported file's original, exactly as uploaded, if the viewer may see its template. Refuses 404
   * `upload_unavailable` for an upload that isn't there, whose files are gone, or whose template's team the
   * viewer may not see (the three read the same, decision 0052).
   */
  importOriginal(
    ctx: RequestContext,
    input: { uploadId: string },
  ): Promise<ReadResult<{ filename: string; mime: string; bytes: Uint8Array }>>;

  /**
   * What the rail's Original tab shows beside an original: who uploaded it, the import report, and the docx's
   * Compare HTML (null for a PDF and a text file, whose bytes `importOriginal` serves). Refuses as
   * `importOriginal` does.
   */
  importOriginalView(
    ctx: RequestContext,
    input: { uploadId: string },
  ): Promise<
    ReadResult<{
      original: ImportedOriginal;
      report: ImportReport;
      compareHtml: string | null;
    }>
  >;

  /**
   * The template's imported original, or null when it wasn't imported (the newest, should there ever be more):
   * the cheap fact the workspace carries to show the Original tab. Refuses 404 `template_unavailable` for a
   * template that isn't there or isn't the viewer's to see.
   */
  importOriginalRef(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<{ original: ImportedOriginal | null }>>;
}
