// What a seeded template must satisfy before `buildTemplate` turns it into rows. Each check throws, which
// fails the reset early: cheaper than finding a broken seed in the UI. They read the spec only; nothing here
// writes a row.

import { ALL_CHANNEL_FIELDS, channelFieldValue } from "@/domain/channel-fields";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import { isReleased } from "@/domain/rounds";
import { TEMPLATE_ID_PATTERN } from "@/server/ids";
import { topLevelIds, variableKeys } from "@/server/documents/build";
import { SEED_CONTENT_TYPES, type SeedContentType } from "../platform";
import type { SeedTemplate, SeedVersion } from "./types";

/** A seeded content type as `SEED_CONTENT_TYPES` describes it. */
export type SeedType = (typeof SEED_CONTENT_TYPES)[SeedContentType];

/** The ids the app generates for a version: `v_` and ten lowercase Crockford characters (`newId`). */
const VERSION_ID_PATTERN = /^v_[0-9a-hjkmnp-tv-z]{10}$/;

/**
 * Fails if the ids a spec spells out aren't shaped like the ones the app generates, or two of its versions
 * share a ref. (`SeedCtx.claimId` refuses an id used twice anywhere in the seed.)
 */
export function checkIds(spec: SeedTemplate) {
  if (!TEMPLATE_ID_PATTERN.test(spec.id)) {
    throw new Error(`Seed: ${spec.key} has the template id "${spec.id}"`);
  }
  const seen = new Set<string>();
  for (const version of spec.versions) {
    if (!VERSION_ID_PATTERN.test(version.id)) {
      throw new Error(
        `Seed: ${spec.key}/${version.ref} has the version id "${version.id}"`,
      );
    }
    if (seen.has(version.ref)) {
      throw new Error(
        `Seed: ${spec.key} has two versions named "${version.ref}"`,
      );
    }
    seen.add(version.ref);
  }
}

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
 * Fails if an approval isn't what the seed's one-stage chain makes: approving is the last stage, so it
 * activates the version at that moment (`approve`), and replaces the version it `supersedes` at the same
 * moment. A version has an approval exactly when it was activated.
 */
export function checkApprovals(spec: SeedTemplate) {
  for (const version of spec.versions) {
    const where = `${spec.key}/${version.ref}`;
    const approved = (version.approvals ?? []).filter(
      (approval) => approval.decision === "approved",
    );
    if (approved.length > 1) {
      throw new Error(`Seed: ${where} is approved more than once`);
    }
    const approval = approved[0];
    if ((approval !== undefined) !== (version.activatedAt !== undefined)) {
      throw new Error(
        `Seed: ${where} needs an approval exactly when it has activatedAt`,
      );
    }
    if (approval && approval.at !== version.activatedAt) {
      throw new Error(
        `Seed: ${where} is activated at ${version.activatedAt}, not when it was approved (${approval.at})`,
      );
    }
    if (version.supersedes) {
      const replaced = spec.versions.find((v) => v.ref === version.supersedes);
      if (!replaced || replaced.supersededAt !== version.activatedAt) {
        throw new Error(
          `Seed: ${where} supersedes ${version.supersedes}, which must be superseded when it is activated`,
        );
      }
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
