// What a seeded template must satisfy before `buildTemplate` turns it into rows. Each check throws, which
// fails the reset early: cheaper than finding a broken seed in the UI. They read the spec only; nothing here
// writes a row.

import { ALL_CHANNEL_FIELDS, channelFieldValue } from "@/domain/channel-fields";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import { isReleased } from "@/domain/rounds";
import { topLevelIds, variableKeys } from "../content";
import { SEED_CONTENT_TYPES, type SeedContentType } from "../platform";
import type { SeedTemplate, SeedVersion } from "./types";

/** A seeded content type as `SEED_CONTENT_TYPES` describes it. */
export type SeedType = (typeof SEED_CONTENT_TYPES)[SeedContentType];

/** A numbered version's round: 1 unless the seed says otherwise. Null for a draft. */
export function roundOf(version: SeedVersion): number | null {
  return version.number === null ? null : (version.round ?? 1);
}

/** Fails if a seeded body breaks the contract. */
export function checkVersion(
  spec: SeedTemplate,
  version: SeedVersion,
  type: SeedType,
) {
  const where = `${spec.key}/${version.ref}`;

  const ids = topLevelIds(version.body);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error(`Seed: ${where} has a top-level block without a unique id`);
  }

  const declared = new Set(version.variables.map((x) => x.key));
  const used = variableKeys(version.body);
  for (const field of ALL_CHANNEL_FIELDS)
    variableKeys(channelFieldValue(version.channelFields ?? {}, field), used);
  for (const key of used) {
    if (!declared.has(key))
      throw new Error(`Seed: ${where} uses undeclared variable "${key}"`);
  }

  const required = (version.body.content ?? [])
    .filter((block) => block.type === "heading" && block.attrs?.requiredKey)
    .map((block) => block.attrs?.requiredKey);
  if (required.join() !== type.requiredSections.join()) {
    throw new Error(
      `Seed: ${where} required sections are missing or out of order`,
    );
  }
  // A content type is one family, and a version renders only channels its content type allows.
  const foreign = version.channels.find(
    (channel) => !(type.channels as readonly string[]).includes(channel),
  );
  if (foreign)
    throw new Error(
      `Seed: ${where} renders ${foreign}, which its content type doesn't allow`,
    );

  if ((version.state === "draft") !== (version.number === null)) {
    throw new Error(`Seed: ${where} number and state disagree`);
  }
  if (
    version.round !== undefined &&
    (version.number === null ||
      !Number.isInteger(version.round) ||
      version.round < 1)
  ) {
    throw new Error(`Seed: ${where} has a round without a number`);
  }
  if (version.state === "draft" && version.updatedAt === undefined) {
    throw new Error(`Seed: ${where} is a draft and needs updatedAt`);
  }
  const stray = ALL_CHANNEL_FIELDS.find(
    (field) =>
      !version.channels.includes(field.channel) &&
      channelFieldValue(version.channelFields ?? {}, field),
  );
  if (stray) {
    throw new Error(
      `Seed: ${where} has a ${stray.name} but no ${stray.channel} channel`,
    );
  }
}

/**
 * Fails if a template's rounds don't add up (rounds.ts): each number's rounds are 1..n with no repeat, and
 * a number has at most one released row (Active, Superseded or Revoked).
 */
export function checkRounds(spec: SeedTemplate) {
  const byNumber = new Map<number, SeedVersion[]>();
  for (const version of spec.versions) {
    if (version.number !== null)
      byNumber.set(version.number, [
        ...(byNumber.get(version.number) ?? []),
        version,
      ]);
  }
  for (const [number, rows] of byNumber) {
    const rounds = rows
      .map((version) => roundOf(version)!)
      .sort((a, b) => a - b);
    if (rounds.some((round, i) => round !== i + 1)) {
      throw new Error(
        `Seed: ${spec.key} v${number} has rounds ${rounds.join(", ")}, not 1..${rounds.length}`,
      );
    }
    if (rows.filter((version) => isReleased(version.state)).length > 1) {
      throw new Error(
        `Seed: ${spec.key} v${number} has more than one released round`,
      );
    }
  }
}

/**
 * Fails if a send-back isn't shaped as `requestChanges` writes it: every changes-requested decision has a
 * whole-version thread on that round whose first comment is the reason, a change request by the approver at
 * the moment they decided.
 */
export function checkSendBacks(spec: SeedTemplate) {
  for (const version of spec.versions) {
    for (const approval of version.approvals ?? []) {
      if (approval.decision !== "changes_requested") continue;
      const thread = (spec.threads ?? []).find(
        (t) => t.origin === version.ref && t.block === DOCUMENT_THREAD,
      );
      const first = thread?.comments[0];
      if (
        !first ||
        first.kind !== "change_request" ||
        first.author !== approval.actor ||
        first.body !== approval.reason ||
        first.at !== approval.at
      ) {
        throw new Error(
          `Seed: ${spec.key}/${version.ref} was sent back without a whole-version thread holding the reason`,
        );
      }
    }
  }
}
