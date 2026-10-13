// Templates as a whole: making one (New template, Import), opening a draft (Edit), and the reads the Library,
// the ⌘K palette and the template workspace are built from.
//
// Typed for step 2b from today's read models (src/server/queries/, src/server/import/); each still runs there.
// A space is a team id, or null for All teams (decision 0053).

import type { IntegrationPanelData } from "@/domain/golive-types";
import type {
  CopilotPrompt,
  ImportOriginalRef,
  ImportOriginalView,
  ImportResponse,
  PaletteResults,
} from "@/domain/import-types";
import type { Refused } from "@/domain/refusals";
import type { ImportFile } from "@/server/import/create";
import type { LibraryRow } from "@/server/queries/library";
import type {
  WorkspaceDocumentData,
  WorkspaceHeaderData,
} from "@/server/queries/workspace";
import type { StarterChoice } from "@/server/starters/catalog";
import type { ActionResult, ReadResult, RequestContext } from "./types";

export interface TemplateService {
  /** New template: the template and its first draft from a starter. Retries a colliding id (decision 0060). */
  create(
    ctx: RequestContext,
    input: { teamId: string } & StarterChoice,
  ): Promise<ActionResult<{ templateId: string }>>;

  /** May the viewer import into the team? Asked before the upload is read. */
  importPermission(
    ctx: RequestContext,
    input: { teamId: string },
  ): Promise<{ ok: true } | Refused>;

  /** Import: a template and its draft from an uploaded file, with the original kept. */
  import(
    ctx: RequestContext,
    input: { teamId: string; file: ImportFile | null },
  ): Promise<ImportResponse>;

  /** Edit: the template's open draft, started from its latest version when there is none. */
  startDraft(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ActionResult<{ draftId: string }>>;

  /** The Library's rows for a space. */
  library(
    ctx: RequestContext,
    input: { teamId: string | null },
  ): Promise<ReadResult<{ rows: LibraryRow[] }>>;

  /** The ⌘K palette's search in a space. */
  palette(
    ctx: RequestContext,
    input: {
      teamId: string | null;
      q: string | null;
      templateId: string | null;
    },
  ): Promise<ReadResult<PaletteResults>>;

  /** The workspace header (name, state, what the viewer may do). */
  workspaceHeader(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<{ header: WorkspaceHeaderData }>>;

  /** The draft (or latest version) the workspace edits or shows. */
  workspaceDocument(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<{ document: WorkspaceDocumentData }>>;

  /** The SHARE panel: how a consumer integrates the template. */
  integration(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<{ panel: IntegrationPanelData }>>;

  /** The Copilot prompt for a document's draft. */
  copilotPrompt(
    ctx: RequestContext,
    input: { templateId: string },
  ): Promise<ReadResult<{ prompt: CopilotPrompt }>>;

  /** An imported file's original, if the viewer may see its template. */
  importOriginal(
    ctx: RequestContext,
    input: { uploadId: string },
  ): Promise<ReadResult<{ ref: ImportOriginalRef; bytes: Uint8Array }>>;

  /** The import report beside an original. */
  importOriginalView(
    ctx: RequestContext,
    input: { uploadId: string },
  ): Promise<ReadResult<{ view: ImportOriginalView }>>;
}
