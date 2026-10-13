// Templates as a whole: making one (New template, Import), opening a draft (Edit), and the reads the Library,
// the ⌘K palette and the template workspace are built from. A space is a team id, or null for All teams
// (decision 0053).
//
// The documents a new template starts with are built and prepared by the BFF, never behind the seam: a starter
// (src/server/starters) or an uploaded file converted by the importer (src/server/import), normalized and given
// block ids (decision 0065). The backend stores what it is handed, after checking it; the Java API doesn't port
// the importer or the starter catalog.
//
// Typed for step 2b; each method still runs in src/server/actions/, src/server/import/ or src/server/queries/
// until its package moves it (plan.md).

import type { ChannelFields } from "@/domain/channel-fields";
import type { LibraryFacts } from "@/domain/library";
import type { PaletteFacts } from "@/domain/palette-search";
import type {
  Channel,
  JSONContent,
  RequiredSection,
  SampleSet,
  VersionState,
  Variable,
} from "@/domain/types";
import type {
  ActionResult,
  ReadResult,
  RequestContext,
  Unsettled,
} from "./types";

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

export type { LibraryFacts, LibraryRowFacts } from "@/domain/library";
export type { PaletteFacts } from "@/domain/palette-search";

/** The Library of a space (`libraryOf`) and the instant it was read and decided at. */
export type TemplateLibrary = LibraryFacts & {
  /** ISO: the backend's instant, which the rows' ages (how long ago it was last edited) count from. */
  asOf: string;
};

/** The SHARE panel's facts: what a consumer needs to call the render API for the Active version. */
export interface IntegrationFacts {
  /** ISO: the instant the panel was read and decided at (`older[].sunsetPassed`). */
  asOf: string;
  /** `name` is the Active version's, as consumers get it from `/api/v1`, not an open draft's. */
  template: { id: string; teamSlug: string; teamName: string; name: string };
  active: {
    number: number;
    /** ISO. */
    activatedAt: string;
    /** What the render route accepts: turned on for the version and still allowed by the content type. */
    channels: Channel[];
    variables: Variable[];
  };
  /** The consumer the examples name: the template's latest non-preview renderer, else the first registered one. */
  sampleConsumerId: string;
  /** Older released versions (Superseded or Revoked), newest first. Empty for a v1. */
  older: {
    number: number;
    state: VersionState;
    /** YYYY-MM-DD in the business time zone; null when no sunset is set. */
    sunsetDay: string | null;
    sunsetPassed: boolean;
    variables: Variable[];
  }[];
}

/** What the Copilot prompt is written from: the saved draft, and the template's team and content type. */
export interface CopilotFacts {
  /** The draft's name. */
  templateName: string;
  teamName: string;
  /** "Disclosure". */
  contentTypeName: string;
  /** The draft's. */
  channels: Channel[];
  /** The content type's sections now. */
  requiredSections: RequiredSection[];
  variables: Variable[];
  body: JSONContent;
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

  /**
   * The Library's rows for a space (a team by id, or every team for the platform roles) and whether the viewer
   * may create there, newest edit first. Only templates in teams the viewer may see. Refuses 404
   * `space_unavailable` when the viewer may not enter the space.
   */
  library(
    ctx: RequestContext,
    input: { teamId: string | null },
  ): Promise<ReadResult<TemplateLibrary>>;

  /**
   * The ⌘K palette's search in a space, for the viewer: Recent (the templates they acted on most recently),
   * and the space's templates for what was typed, ranked by `paletteTemplates` (rank, then name, then id by
   * code point, the recent ones winning ties). `templateId` is the template whose pages they are on: `current`
   * says whether it is theirs to see in this space. Refuses 404 `space_unavailable` when the viewer may not
   * enter the space.
   */
  palette(
    ctx: RequestContext,
    input: {
      teamId: string | null;
      q: string | null;
      templateId: string | null;
    },
  ): Promise<ReadResult<PaletteFacts>>;

  /** The workspace header (name, state, what the viewer may do). */
  workspaceHeader(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<Unsettled<"P4a: the workspace header's facts">>>;

  /** The draft (or latest version) the workspace edits or shows. */
  workspaceDocument(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<Unsettled<"P4a: the workspace document's facts">>>;

  /**
   * The SHARE panel's facts: the Active version's contract and the older released versions, which the BFF turns
   * into the worded panel (endpoint, curl and fetch examples, the schema, what changed since vN). Refuses, in
   * order: 404 `template_gone` for a template that doesn't exist, 403 for someone who may not read the
   * integration details (`integration.view`), 409 `no_active_version`.
   */
  integration(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<IntegrationFacts>>;

  /**
   * What the Copilot prompt is written from: the saved draft with its team and content type, for someone who may
   * edit the draft. Refuses, in order: 404 `template_unavailable`, 403 (`draft.edit`), 409 `no_draft_to_write`
   * for a template with no open draft, 409 `copilot_documents_only` for an alert (the content type decides, not
   * the draft's channels).
   */
  copilotPrompt(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<CopilotFacts>>;

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
