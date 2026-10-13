// Content types: required sections. They shape only templates created afterwards. A document carries
// its sections as headings with a `requiredKey`, and the editor protects those, so an existing template
// keeps the sections it was made with. Removing a section is allowed: nothing at submit checks sections,
// so no existing draft becomes unsubmittable (`conformToSections` shapes a new template's starter).

import type { AccessEffect, Named, Ok, Refused } from "../access-types";
import { refuse, type Refusal } from "../refusals";
import { joinWithAnd } from "../render/errors";
import {
  familyOf,
  type Channel,
  type JSONContent,
  type RequiredSection,
} from "../types";
import type { ChannelRuleType } from "./channels";
import { configChanged } from "./effects";
import { SECTION_TITLE_MAX } from "./limits";
import { PLATFORM_REFUSALS } from "./refusals";

/** "Rates and fees" → "rates_and_fees". */
export function sectionKey(title: string): string {
  const key = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return /^[a-z]/.test(key) ? key : `section_${key}`.replace(/_+$/, "");
}

/**
 * The first reason a content type's required sections can't be saved, or null: at least one section,
 * and every title given, at most 60 characters and unlike the others (case-insensitive). The sections
 * editor runs it as the admin types; `updateRequiredSections` refuses with it.
 */
export function validateRequiredSections(
  next: readonly { title: string }[],
): Refusal | null {
  if (next.length === 0) return PLATFORM_REFUSALS.oneSection;
  const titles = new Set<string>();
  for (const s of next) {
    const title = s.title.trim();
    if (!title) return PLATFORM_REFUSALS.sectionTitle;
    if (title.length > SECTION_TITLE_MAX)
      return PLATFORM_REFUSALS.sectionTitleTooLong;
    if (titles.has(title.toLowerCase()))
      return PLATFORM_REFUSALS.sectionDuplicate(title);
    titles.add(title.toLowerCase());
  }
  return null;
}

/** Why a section can't be removed from a list of `count`, or null: at least one section stays. */
export function removeSectionRefusal(count: number): Refusal | null {
  return count <= 1 ? PLATFORM_REFUSALS.oneSection : null;
}

/** The sections as they'd be saved (new ones keyed from their title), and what changes. */
function planSections(
  current: readonly RequiredSection[],
  next: readonly RequiredSection[],
) {
  const currentKeys = new Set(current.map((s) => s.key));
  const used = new Set(currentKeys);
  const kept = new Set<string>();
  const requiredSections = next.map((s): RequiredSection => {
    const title = s.title.trim();
    if (currentKeys.has(s.key) && !kept.has(s.key)) {
      kept.add(s.key);
      return { key: s.key, title };
    }
    const base = sectionKey(title);
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    used.add(key);
    return { key, title };
  });

  const before = new Map(current.map((s) => [s.key, s]));
  const after = new Map(requiredSections.map((s) => [s.key, s]));
  const added = requiredSections
    .filter((s) => !before.has(s.key))
    .map((s) => s.title);
  const removed = current.filter((s) => !after.has(s.key)).map((s) => s.title);
  const renamed = requiredSections
    .filter((s) => before.has(s.key) && before.get(s.key)!.title !== s.title)
    .map((s) => ({ from: before.get(s.key)!.title, to: s.title }));
  const keptOrder = (list: readonly RequiredSection[]) =>
    list.filter((s) => before.has(s.key) && after.has(s.key)).map((s) => s.key);
  const reordered =
    keptOrder(current).join() !== keptOrder(requiredSections).join();
  const changed =
    added.length > 0 || removed.length > 0 || renamed.length > 0 || reordered;
  return { requiredSections, added, removed, renamed, reordered, changed };
}

export interface SectionsChange {
  /** The first reason the list can't be saved (`validateRequiredSections`), or null. */
  problem: Refusal | null;
  /** Saving would change something: a section added, removed, renamed or moved. */
  changed: boolean;
  /** The strip's lines: the scope, said from the start, then what changes once something does. */
  lines: string[];
}

/**
 * The sections editor's strip as the admin edits `next` (a section being added has a key the type
 * doesn't have): that only new templates take the change, then which sections new templates gain
 * and which become ordinary headings.
 */
export function describeSectionsChange(input: {
  contentTypeName: string;
  current: readonly RequiredSection[];
  next: readonly RequiredSection[];
}): SectionsChange {
  const type = input.contentTypeName;
  const problem = validateRequiredSections(input.next);
  const plan = planSections(input.current, input.next);
  const lines = [
    `Applies to new ${type} templates only. Existing templates keep their sections.`,
  ];
  if (plan.changed && !problem) {
    if (plan.added.length)
      lines.push(`New templates start with ${joinWithAnd(plan.added)} added.`);
    if (plan.removed.length)
      lines.push(
        `${joinWithAnd(plan.removed)} becomes an ordinary heading in new templates.`,
      );
  }
  return { problem, changed: plan.changed, lines };
}

/**
 * Why a content type's required sections can't be edited, or null: a message type (an Alert) renders
 * no document, so it has no sections. The content types read model asks it for every row.
 */
export function sectionsRefusal(contentType: ChannelRuleType): Refusal | null {
  return familyOf(contentType.allowedChannels) === "message"
    ? PLATFORM_REFUSALS.noSections(contentType.name)
    : null;
}

/**
 * The content type's required sections, replaced. `next` lists every section in order: an existing
 * one by its key (its title may change: a rename keeps the key), a new one with any other key (the
 * key is made from its title, never reusing one the type has or had in this list). A message type has
 * none (`sectionsRefusal`).
 */
export function updateRequiredSections(input: {
  contentType: {
    id: string;
    name: string;
    requiredSections: RequiredSection[];
    allowedChannels: readonly Channel[];
  };
  next: RequiredSection[];
  actor: Named;
  now: Date;
}):
  | Ok<{ requiredSections: RequiredSection[]; effects: AccessEffect[] }>
  | Refused {
  const { contentType } = input;
  const noSections = sectionsRefusal(contentType);
  if (noSections) return refuse(noSections);
  const current = contentType.requiredSections;
  const problem = validateRequiredSections(input.next);
  if (problem) return refuse(problem);

  const { requiredSections, added, removed, renamed, reordered, changed } =
    planSections(current, input.next);
  if (!changed) return { ok: true, requiredSections: current, effects: [] };

  return {
    ok: true,
    requiredSections,
    effects: [
      configChanged("content_types", null, {
        contentTypeId: contentType.id,
        contentTypeName: contentType.name,
        added,
        removed,
        renamed,
        reordered,
        sections: requiredSections.map((s) => s.title),
      }),
    ],
  };
}

/**
 * A new template's starter body, shaped to the content type's sections as they are now: a required
 * heading whose section was removed becomes an ordinary heading (its content stays), a renamed one
 * takes the new title, and a section the starter lacks is added at the end as an H2. Existing
 * templates are never reshaped. `newId` gives the added headings their block ids.
 */
export function conformToSections(
  body: JSONContent,
  sections: readonly RequiredSection[],
  newId: () => string,
): JSONContent {
  const wanted = new Map(sections.map((s) => [s.key, s]));
  const present = new Set<string>();
  const content = (body.content ?? []).map((block) => {
    const key =
      block.type === "heading"
        ? (block.attrs?.requiredKey as string | null | undefined)
        : null;
    if (!key) return block;
    const section = wanted.get(key);
    if (!section)
      return { ...block, attrs: { ...block.attrs, requiredKey: null } };
    present.add(key);
    const text = (block.content ?? []).map((n) => n.text ?? "").join("");
    return text === section.title
      ? block
      : { ...block, content: [{ type: "text", text: section.title }] };
  });
  for (const s of sections) {
    if (present.has(s.key)) continue;
    content.push({
      type: "heading",
      attrs: { id: newId(), level: 2, requiredKey: s.key },
      content: [{ type: "text", text: s.title }],
    });
  }
  return { ...body, content };
}
