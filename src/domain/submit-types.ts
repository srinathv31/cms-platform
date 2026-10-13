import type { Channel, SampleSet, Variable } from "./types";

/**
 * What submit would freeze, as the backend reads it (`ReviewService.submitSummary`): the saved draft and the
 * version it is compared with, as facts. The BFF shapes the dialog's `SubmitSummary` from it: the channels in the
 * content type's order, and the sample sets listed with the generated defaults (whose names are the BFF's words).
 */
export interface SubmitFacts {
  /** ISO: the backend's instant the baseline was decided at (a sunset that has passed moves it). */
  asOf: string;
  templateId: string;
  /** The draft's `rev` as it was read: submit sends it back (`SubmitSummary.rev`). */
  rev: number;
  /** The number and round the draft gets at submit (`nextRound`). */
  number: number;
  round: number;
  name: string;
  /** The channels the draft renders to, as it stores them. */
  channels: Channel[];
  variables: Variable[];
  /** The draft's own sample sets, as stored. */
  sampleSets: SampleSet[];
  /** The newest version that still renders (`contractBaseline`); null when none does. */
  baseline: { number: number; name: string; variables: Variable[] } | null;
}

/**
 * What the submit dialog shows, read from the SAVED draft right after the pending autosave went out
 * (so it is exactly what submitting will freeze). The contract changes aren't in it: the dialog
 * computes those from `variables` and `baseline`.
 */
export interface SubmitSummary {
  templateId: string;
  /**
   * The draft's `rev` as it was read. Submit sends it back and is refused (`REFUSALS.summaryStale`)
   * when the draft has changed since, so nothing this summary didn't show gets frozen.
   */
  rev: number;
  /**
   * The number and round the draft gets at submit (`nextRound` in domain/rounds.ts): round 1 of the next
   * version after a release, or the next round of the number sent back.
   */
  number: number;
  round: number;
  /** The draft's name, which goes live with it. */
  name: string;
  /** The channels the version renders to, in the content type's order. */
  channels: Channel[];
  /** Names of every sample data set, defaults first. */
  sampleSetNames: string[];
  variables: Variable[];
  /**
   * The version the name and the contract are compared with (`contractBaseline`: the newest that still
   * renders, so what customers get today); null when none does.
   */
  baseline: { number: number; name: string; variables: Variable[] } | null;
}
