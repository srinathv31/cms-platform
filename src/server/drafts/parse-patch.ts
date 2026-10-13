// Validates the body of PUT /api/drafts/[versionId]. Pure TypeScript: no database, no framework.
// What this checks is the shape and the size. The route then prepares each document (prepare-patch.ts), and the
// rules that need the draft as it stands (is it a draft, is the rev current, is the channel allowed for the content
// type) are the backend's: `DraftService.save` (src/server/services/drafts.ts), deciding with
// src/domain/lifecycle/autosave.ts.

import { z } from "zod";
import {
  CHANNEL_FIELD_IDS,
  type ChannelFieldId,
} from "@/domain/channel-fields";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { CHANNELS, VARIABLE_TYPES } from "@/domain/types";
import type { DraftPatch, JSONContent } from "@/domain/types";
import { formatCount } from "@/domain/numbers";
import { identityOf } from "@/editor/model/contract";
import { MAX_VALUE_LENGTH, isValidKey } from "@/editor/model/variables";
import { changedFields } from "@/domain/lifecycle/autosave";

/**
 * Largest request body accepted, in bytes. A long disclosure is well under 1 MB of JSON. The route
 * refuses a larger Content-Length before reading and reads with a byte counter that stops here (413);
 * `parseDraftPatchText` checks the characters it's given too.
 */
export const MAX_BODY_SIZE = 2_000_000;
export const MAX_NAME_LENGTH = 120;

export const TOO_LARGE_MESSAGE = REQUEST_REFUSALS.draftTooLarge.reason;

const MAX_DEPTH = 40;
const MAX_NODES = 100_000;
const MAX_VARIABLES = 200;
const MAX_SAMPLE_SETS = 50;

export const NAME_MESSAGE = `The name must be 1 to ${MAX_NAME_LENGTH} characters.`;
export const SAMPLE_TOO_LONG_MESSAGE = `A sample value can be at most ${formatCount(MAX_VALUE_LENGTH)} characters.`;

export type ParseResult =
  { ok: true; patch: DraftPatch } | { ok: false; message: string };

/** The template name, trimmed. null when it is empty or longer than 120 characters. */
export function normalizeName(name: string): string | null {
  const trimmed = name.trim();
  // Count characters, not UTF-16 units, so an emoji is one.
  const length = Array.from(trimmed).length;
  return length >= 1 && length <= MAX_NAME_LENGTH ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Why a value is not a TipTap document, or null when it is one. Checks the structure the editor
 * emits (doc, nodes, marks, text) without copying it. The editor schema check (unknown node types)
 * happens later, in `ensureBlockIds`.
 */
export function docProblem(value: unknown): string | null {
  if (!isRecord(value) || value.type !== "doc") return "is not a document";
  const stack: { node: Record<string, unknown>; depth: number }[] = [
    { node: value, depth: 0 },
  ];
  let count = 0;

  for (let item = stack.pop(); item; item = stack.pop()) {
    const { node, depth } = item;
    if (++count > MAX_NODES) return "has too many nodes";
    if (depth > MAX_DEPTH) return "is nested too deeply";
    if (
      typeof node.type !== "string" ||
      node.type.length === 0 ||
      node.type.length > 64
    )
      return "has a node without a type";
    if (node.attrs !== undefined && !isRecord(node.attrs))
      return "has a node with bad attributes";
    if (node.text !== undefined && typeof node.text !== "string")
      return "has a node with bad text";

    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) return "has a node with bad marks";
      for (const mark of node.marks) {
        if (
          !isRecord(mark) ||
          typeof mark.type !== "string" ||
          (mark.attrs !== undefined && !isRecord(mark.attrs))
        ) {
          return "has a bad mark";
        }
      }
    }

    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) return "has a node with bad content";
      for (const child of node.content) {
        if (!isRecord(child)) return "has a node that is not an object";
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }
  return null;
}

const doc = z.custom<JSONContent>((value) => docProblem(value) === null, {
  message: "is not a valid document",
});

const variable = z.strictObject({
  // A fresh UUID, or the key the variable had before its first rename (`Variable.id`).
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, { message: "is not a valid variable id" })
    .optional(),
  key: z
    .string()
    .refine(isValidKey, { message: "is not a valid snake_case key" }),
  label: z.string().max(200),
  type: z.enum(VARIABLE_TYPES),
  required: z.boolean(),
  sample: z.string().max(MAX_VALUE_LENGTH),
});

const sampleSet = z.strictObject({
  id: z.string().min(1).max(100),
  name: z.string().max(200),
  // Strings only, whatever the variable's type (decision 0058): the same rule as the render route's values.
  values: z.record(z.string().max(100), z.string().max(MAX_VALUE_LENGTH)),
});

const variables = z
  .array(variable)
  .max(MAX_VARIABLES)
  .refine((list) => new Set(list.map((v) => v.key)).size === list.length, {
    message: "has a repeated key",
  })
  // Two variables that are one to the contract diff would make a later diff guess which was renamed.
  .refine((list) => new Set(list.map(identityOf)).size === list.length, {
    message: "has a repeated variable id",
  });

const sampleSets = z
  .array(sampleSet)
  .max(MAX_SAMPLE_SETS)
  .refine((list) => new Set(list.map((s) => s.id)).size === list.length, {
    message: "has a repeated id",
  });

// At least one: the channel chips never turn off the last one, and a version with none would render
// nothing and skip every channel's rules at submit.
const channels = z
  .array(z.enum(CHANNELS))
  .min(1, { message: "must have at least one channel" })
  .max(CHANNELS.length)
  .refine((list) => new Set(list).size === list.length, {
    message: "has a repeated channel",
  });

const name = z.string().transform((value, ctx) => {
  const normalized = normalizeName(value);
  if (normalized === null) {
    ctx.addIssue({ code: "custom", message: NAME_MESSAGE });
    return z.NEVER;
  }
  return normalized;
});

/** One optional key per channel field, by id ("email.subject"): a document sets it, null clears it. */
const channelFields = Object.fromEntries(
  CHANNEL_FIELD_IDS.map((id) => [id, doc.nullable().optional()]),
) as Record<ChannelFieldId, z.ZodOptional<z.ZodNullable<typeof doc>>>;

const patchSchema = z.strictObject({
  rev: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sessionKey: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, { message: "is not a valid session key" }),
  body: doc.optional(),
  variables: variables.optional(),
  name: name.optional(),
  channels: channels.optional(),
  ...channelFields,
  sampleSets: sampleSets.optional(),
});

/** Whether a path in the patch is a sample value: a variable's `sample`, or a value in a sample set. */
function isSamplePath(path: readonly PropertyKey[]): boolean {
  if (path[0] === "variables") return path.length === 3 && path[2] === "sample";
  return path[0] === "sampleSets" && path.length === 4 && path[2] === "values";
}

/** Validates a parsed JSON body. A patch with no field to change is invalid. */
export function parseDraftPatch(input: unknown): ParseResult {
  const result = patchSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    // The name and the sample values are what an author types into directly, so their messages are written for them.
    if (issue?.path[0] === "name") return { ok: false, message: NAME_MESSAGE };
    if (issue?.code === "too_big" && isSamplePath(issue.path))
      return { ok: false, message: SAMPLE_TOO_LONG_MESSAGE };
    const path = issue?.path.join(".");
    return {
      ok: false,
      message: path
        ? `${path} ${issue?.message}`
        : (issue?.message ?? "Invalid request."),
    };
  }

  const patch = result.data as DraftPatch;
  if (changedFields(patch).length === 0)
    return { ok: false, message: "Nothing to save." };
  return { ok: true, patch };
}

/** Reads and parses a request body with the size guard. `text` is the raw body. */
export function parseDraftPatchText(text: string): ParseResult {
  if (text.length > MAX_BODY_SIZE)
    return { ok: false, message: TOO_LARGE_MESSAGE };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "The request body is not valid JSON." };
  }
  return parseDraftPatch(parsed);
}
