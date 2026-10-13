// Templates as a whole: making one (New template, Import), opening a draft (Edit), and the reads the Library,
// the ⌘K palette and the template workspace are built from. A space is a team id, or null for All teams
// (decision 0053).
//
// The documents a new template starts with are built and prepared by the BFF, never behind the seam: a starter
// (src/server/starters) or an uploaded file converted by the importer (src/server/import), normalized and given
// block ids (decision 0065). The backend stores what it is handed, after checking it; the Java API doesn't port
// the importer or the starter catalog.
//
// The workspace's two reads run behind the seam (local; their facts are in ./workspace.ts). The rest are typed
// for step 2b; each still runs in src/server/actions/, src/server/import/ or src/server/queries/ until its
// package moves it (plan.md).

import type { ChannelFields } from "@/domain/channel-fields";
import type { Channel, JSONContent, SampleSet, Variable } from "@/domain/types";
import type {
  ActionResult,
  ReadResult,
  RequestContext,
  Unsettled,
} from "./types";
import type { WorkspaceDocumentFacts, WorkspaceHeaderFacts } from "./workspace";

/** A new template's first draft, as the BFF built and prepared it. */
export interface DraftContent {
  /** The template's name in the draft. */
  name: string;
  /** Normalized, checked, with block ids. */
  body: JSONContent;
  /** Each channel's own fields, prepared the same way. */
  channelFields: ChannelFields;
  channels: Channel[];
  variables: Variable[];
  sampleSets: SampleSet[];
  /** The starter it came from (`starter_key`), or null for an import. */
  starterKey: string | null;
}

export interface TemplateService {
  /**
   * New template: the template and its first draft, in the content type the BFF chose for the kind the author
   * picked. Inserts with a fresh id and retries the whole write on a collision (decision 0060).
   */
  create(
    ctx: RequestContext,
    input: { teamId: string; contentTypeId: string; draft: DraftContent },
  ): Promise<ActionResult<{ templateId: string }>>;

  /** May the viewer create in the team? Asked before an upload is read. */
  createPermission(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<ActionResult>;

  /** Import: a template and its draft from a file the BFF converted, with the original and the report kept. */
  createImported(
    ctx: RequestContext,
    input: {
      teamId: string;
      contentTypeId: string;
      draft: DraftContent;
      original: { filename: string; mime: string; bytes: Uint8Array };
      report: Unsettled<"P3: the import report's facts">;
    },
  ): Promise<ActionResult<{ templateId: string; uploadId: string }>>;

  /** Edit: the template's open draft, started from its latest version when there is none. */
  startDraft(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ActionResult<{ draftId: string }>>;

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

  /** An imported file's original, if the viewer may see its template. */
  importOriginal(
    ctx: RequestContext,
    input: { uploadId: string },
  ): Promise<ReadResult<{ filename: string; mime: string; bytes: Uint8Array }>>;

  /** The import report beside an original. */
  importOriginalView(
    ctx: RequestContext,
    input: { uploadId: string },
  ): Promise<ReadResult<Unsettled<"P3: the import report's facts">>>;
}
