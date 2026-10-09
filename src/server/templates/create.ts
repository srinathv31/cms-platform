import "server-only";
import { eq } from "drizzle-orm";
import {
  DEFAULT_CHANNELS,
  type DraftFields,
  type LifecycleResult,
  type NewTemplateChanges,
  type StarterContent,
} from "@/domain/lifecycle";
import { conformToSections } from "@/domain/platform-config";
import type { Channel, RequiredSection } from "@/domain/types";
import { db } from "@/server/db/client";
import { contentTypes, templates, versions } from "@/server/db/schema/ucomp";
import { writeEffects, type Tx } from "@/server/effects";
import { newId, newTemplateId } from "@/server/ids";

// The write side of "a new template and its first draft", shared by New template (a starter,
// src/server/actions/create-template.ts) and Import a file (src/server/import/create.ts). The
// callers check permissions and build the lifecycle result; this inserts it in their transaction.

/** A draft's row in `versions`. */
export function draftRow(draft: DraftFields, ids: { id: string; templateId: string }) {
  return {
    id: ids.id,
    templateId: ids.templateId,
    number: draft.number,
    state: draft.state,
    basedOnVersionId: draft.basedOnVersionId,
    body: draft.body,
    emailSubject: draft.emailSubject,
    emailPreheader: draft.emailPreheader,
    channels: draft.channels,
    variables: draft.variables,
    sampleSets: draft.sampleSets,
    contractChanges: draft.contractChanges,
    currentStage: draft.currentStage,
    rev: draft.rev,
    createdBy: draft.createdBy,
    writers: draft.writers,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

/** A template id nobody has. A collision on 6 Crockford characters is one in a billion; check anyway. */
export async function freshTemplateId(): Promise<string> {
  let templateId = newTemplateId();
  for (let i = 0; i < 4 && (await db.query.templates.findFirst({ where: eq(templates.id, templateId) })); i++) {
    templateId = newTemplateId();
  }
  return templateId;
}

/** The Disclosure content type every new template gets (the prototype has one). */
export async function disclosureContentType() {
  const contentType = await db.query.contentTypes.findFirst({ where: eq(contentTypes.key, "disclosure") });
  if (!contentType) throw new Error("The Disclosure content type is missing");
  return contentType;
}

/**
 * A first draft shaped to the content type as it is now (Platform settings), for every way a template
 * is born. Only the channels the type allows (the first allowed one if none of the wanted ones is).
 * Its required sections: removed ones become ordinary headings, renamed ones take the new title, new
 * ones are appended. An import has already fitted them (`finishImport`), so it passes
 * `sectionsFitted` and its body is left alone. Existing templates are never reshaped.
 */
export function conformToContentType(
  starter: StarterContent,
  type: { requiredSections: RequiredSection[]; allowedChannels: Channel[] },
  options: { sectionsFitted?: boolean } = {},
): StarterContent {
  const wanted = starter.channels ?? DEFAULT_CHANNELS;
  const allowed = wanted.filter((c) => type.allowedChannels.includes(c));
  return {
    ...starter,
    body: options.sectionsFitted ? starter.body : conformToSections(starter.body, type.requiredSections, () => newId("b")),
    channels: allowed.length > 0 ? allowed : type.allowedChannels.slice(0, 1),
  };
}

export interface NewTemplateRows {
  templateId: string;
  teamId: string;
  contentTypeId: string;
  versionId: string;
  created: LifecycleResult<NewTemplateChanges>;
  at: Date;
  actorId: string;
  /** The upload an imported draft came from (`versions.import_upload_id`). */
  importUploadId?: string | null;
}

/** Inserts the template, its first draft and the effects (the audit event) in the caller's transaction. */
export async function insertNewTemplate(tx: Tx, rows: NewTemplateRows): Promise<void> {
  const { template, draft } = rows.created.changes;
  await tx.insert(templates).values({
    id: rows.templateId,
    teamId: rows.teamId,
    contentTypeId: rows.contentTypeId,
    name: template.name,
    createdBy: template.createdBy,
    createdAt: template.createdAt,
    starterKey: template.starterKey,
  });
  await tx.insert(versions).values({
    ...draftRow(draft, { id: rows.versionId, templateId: rows.templateId }),
    ...(rows.importUploadId ? { importUploadId: rows.importUploadId } : {}),
  });
  await writeEffects(tx, rows.created.effects, {
    at: rows.at,
    actorId: rows.actorId,
    teamId: rows.teamId,
    templateId: rows.templateId,
    versionId: rows.versionId,
  });
}
