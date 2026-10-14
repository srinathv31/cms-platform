import { compareRounds, isReleased } from "@/domain/rounds";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { TestHooks } from "../options";
import { refuse } from "../refuse";
import type { FakeState, TemplateRow, VersionRow } from "./state";
import type { FakeTx } from "./store";

// Templates and their version rows in memory: the in-memory twins of the lookups and the compare-and-set in
// src/server/version-rows.ts, returning the same rows in the same order, so the two implementations answer alike
// (the contract suite checks they do). The review, versions and templates areas share them.

export function templateById(
  state: FakeState,
  templateId: string,
): TemplateRow | undefined {
  return state.templates.find((t) => t.id === templateId);
}

/**
 * A version row by number and round (`findRound`): with a round, exactly that row; without one, the
 * number's head, its released row, else its latest round.
 */
export function findRound(
  state: FakeState,
  templateId: string,
  number: number,
  round?: number | null,
): VersionRow | undefined {
  return state.versions
    .filter(
      (v) =>
        v.templateId === templateId &&
        v.number === number &&
        (round == null || v.round === round),
    )
    .sort(
      (a, b) =>
        Number(isReleased(b.state)) - Number(isReleased(a.state)) ||
        (b.round ?? 0) - (a.round ?? 0),
    )[0];
}

/** The template's Active version. */
export function activeVersion(
  state: FakeState,
  templateId: string,
): VersionRow | undefined {
  return state.versions.find(
    (v) => v.templateId === templateId && v.state === "active",
  );
}

/** The name the CMS shows for a template (`currentName`): its open draft's, else its newest version's, else its id. */
export function currentName(state: FakeState, templateId: string): string {
  const rows = state.versions.filter((v) => v.templateId === templateId);
  const latest =
    rows.find((v) => v.state === "draft") ??
    rows.reduce<VersionRow | undefined>(
      (best, v) =>
        best === undefined || compareRounds(v, best) > 0 ? v : best,
      undefined,
    );
  return latest?.name ?? templateId;
}

/**
 * The compare-and-set on a version (`updateVersion` in src/server/version-rows.ts): writes `patch` only while
 * the row still has the state, rev and stage it was read with (`read`), bumping its rev; refused
 * `version_changed` otherwise. A test's `hooks.beforeCompareAndSet` can change the row in between, as another
 * writer would.
 */
export function compareAndSetVersion(
  tx: FakeTx,
  row: VersionRow,
  read: Pick<VersionRow, "state" | "rev" | "currentStage">,
  patch: Partial<VersionRow>,
  at: Date,
  hooks: TestHooks,
): void {
  if (
    hooks.beforeCompareAndSet?.({ table: "versions", id: row.id }) ===
    "competing_write"
  )
    tx.update("versions", row, { rev: row.rev + 1 });
  if (
    row.state !== read.state ||
    row.rev !== read.rev ||
    row.currentStage !== read.currentStage
  )
    refuse(REQUEST_REFUSALS.versionChanged);
  tx.update("versions", row, { ...patch, rev: row.rev + 1, updatedAt: at });
}
