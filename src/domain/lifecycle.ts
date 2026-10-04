// Template lifecycle rules: what a new draft contains and what an existing draft copies.
// Pure TypeScript: no framework, no database, no clock. The caller passes `now` and the ids it
// has generated; `server/actions/templates.ts` writes the result inside one transaction.
//
// Each transition returns `{ changes, effects }`. `changes` are the field values to write;
// `effects` are the side records (audit events today; notifications and consumer notices later)
// the server layer writes in the same transaction.
//
// Phase 2.2 covers the two ways a draft comes to exist: `createDraft` (a new template from a
// starter) and `editActive` (a new draft copied from the Active version). Submit, request
// changes, approve, sunset and revoke arrive with the review phase.

import type { Channel, JSONContent, SampleSet, Variable, VersionState } from "./types";

// ── Defaults ──────────────────────────────────────────────────

/** Name of a template made from Blank. The author renames it straight away. */
export const UNTITLED_TEMPLATE_NAME = "Untitled template";

/** Key of the starter that has no example content (just the required sections). */
export const BLANK_STARTER_KEY = "blank";

/** A new template renders PDF and Web. Email is a deliberate opt-in, as in the seed. */
export const DEFAULT_CHANNELS: readonly Channel[] = ["pdf", "web"];

// ── Shapes ────────────────────────────────────────────────────

/** The audit event a transition asks the server layer to record. */
export interface AuditEffect {
  kind: "audit";
  action: "template.created" | "draft.started";
  details: Record<string, unknown>;
}

export type LifecycleEffect = AuditEffect;

export interface LifecycleResult<C> {
  changes: C;
  effects: LifecycleEffect[];
}

/** Everything a starter contributes to a new template's first draft. */
export interface StarterContent {
  /** snake_case key; `blank` for the empty starter. Stored on the template as `starter_key`. */
  key: string;
  /** Display name, e.g. "Card offer terms". */
  name: string;
  body: JSONContent;
  variables: Variable[];
  sampleSets: SampleSet[];
  /** Defaults to `DEFAULT_CHANNELS`. */
  channels?: readonly Channel[];
  emailSubject?: JSONContent | null;
  emailPreheader?: JSONContent | null;
}

/** The content of a version that a draft is made from. */
export interface VersionSnapshot {
  id: string;
  number: number | null;
  state: VersionState;
  body: JSONContent;
  emailSubject: JSONContent | null;
  emailPreheader: JSONContent | null;
  channels: readonly Channel[];
  variables: readonly Variable[];
  sampleSets: readonly SampleSet[];
}

/** Field values for a new `draft` version row (ids and the template id are assigned by the caller). */
export interface DraftFields {
  state: "draft";
  /** Null until the draft is submitted; the number is assigned at submit and then frozen. */
  number: null;
  basedOnVersionId: string | null;
  body: JSONContent;
  emailSubject: JSONContent | null;
  emailPreheader: JSONContent | null;
  channels: Channel[];
  variables: Variable[];
  sampleSets: SampleSet[];
  contractChanges: null;
  currentStage: 0;
  /** Autosave ordering starts at zero. */
  rev: 0;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleError";
  }
}

// ── New template ──────────────────────────────────────────────

export interface NewTemplateChanges {
  template: {
    name: string;
    /** Null for Blank, as in the seed. */
    starterKey: string | null;
    createdBy: string;
    createdAt: Date;
  };
  draft: DraftFields;
}

/** The template's first name: Blank is untitled (renamed at once), an example keeps its own name. */
export function initialTemplateName(starter: Pick<StarterContent, "key" | "name">): string {
  return starter.key === BLANK_STARTER_KEY ? UNTITLED_TEMPLATE_NAME : starter.name;
}

/** A new template and its first draft, from a starter. Block ids in the body are kept as given. */
export function createDraft(input: {
  starter: StarterContent;
  createdBy: string;
  now: Date;
}): LifecycleResult<NewTemplateChanges> {
  const { starter, createdBy, now } = input;
  const name = initialTemplateName(starter);
  const isBlank = starter.key === BLANK_STARTER_KEY;

  return {
    changes: {
      template: { name, starterKey: isBlank ? null : starter.key, createdBy, createdAt: now },
      draft: {
        state: "draft",
        number: null,
        basedOnVersionId: null,
        body: clone(starter.body),
        emailSubject: clone(starter.emailSubject ?? null),
        emailPreheader: clone(starter.emailPreheader ?? null),
        channels: [...(starter.channels ?? DEFAULT_CHANNELS)],
        variables: clone([...starter.variables]),
        sampleSets: clone([...starter.sampleSets]),
        contractChanges: null,
        currentStage: 0,
        rev: 0,
        createdBy,
        createdAt: now,
        updatedAt: now,
      },
    },
    effects: [
      {
        kind: "audit",
        action: "template.created",
        details: { name, source: isBlank ? "blank" : `starter:${starter.key}` },
      },
    ],
  };
}

// ── Editing an Active template ────────────────────────────────

/**
 * What "Edit" on a template does, given its versions: go to the open draft if there is one
 * (one open draft per template), copy the Active version if it is the template's latest, or say
 * it can't. A newer version in review (or any other newer version) blocks it: editing the Active
 * version then would fork the template and drop the newer version's changes.
 */
export type DraftStartPlan =
  | { kind: "open"; versionId: string }
  | { kind: "create"; from: string }
  | { kind: "blocked"; reason: string };

export function planDraftStart(
  versions: readonly { id: string; state: VersionState; number: number | null }[],
): DraftStartPlan {
  const open = versions.find((v) => v.state === "draft");
  if (open) return { kind: "open", versionId: open.id };

  const latest = versions.reduce<(typeof versions)[number] | undefined>(
    (best, v) => (best === undefined || (v.number ?? 0) > (best.number ?? 0) ? v : best),
    undefined,
  );
  if (latest?.state === "active") return { kind: "create", from: latest.id };
  if (latest?.state === "in_review") {
    return { kind: "blocked", reason: "A newer version is in review." };
  }
  return { kind: "blocked", reason: "Only an Active template can be edited." };
}

/**
 * A new draft copied from the Active version: body (block ids included, so comments and the redline
 * keep their anchors), variables, channels, email fields and sample sets. Contract changes are
 * worked out against the Active version when the draft is submitted, so none are recorded here.
 */
export function editActive(input: {
  active: VersionSnapshot;
  createdBy: string;
  now: Date;
}): LifecycleResult<{ draft: DraftFields }> {
  const { active, createdBy, now } = input;
  if (active.state !== "active") {
    throw new LifecycleError(`Only an Active version can be edited, not ${active.state}.`);
  }

  return {
    changes: {
      draft: {
        state: "draft",
        number: null,
        basedOnVersionId: active.id,
        body: clone(active.body),
        emailSubject: clone(active.emailSubject),
        emailPreheader: clone(active.emailPreheader),
        channels: [...active.channels],
        variables: clone([...active.variables]),
        sampleSets: clone([...active.sampleSets]),
        contractChanges: null,
        currentStage: 0,
        rev: 0,
        createdBy,
        createdAt: now,
        updatedAt: now,
      },
    },
    effects: [{ kind: "audit", action: "draft.started", details: { basedOn: active.number } }],
  };
}

// ── Helpers ───────────────────────────────────────────────────

/** A deep copy, so a draft never shares objects with the version (or starter) it came from. */
function clone<T>(value: T): T {
  return value === null || value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
