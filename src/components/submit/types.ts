import type { Channel, Variable } from "@/domain/types";

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
  /** The number the version gets at submit: one above the template's highest. */
  number: number;
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
