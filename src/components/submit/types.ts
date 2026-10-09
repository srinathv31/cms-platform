import type { Channel, Variable } from "@/domain/types";

/**
 * What the submit dialog shows, read from the SAVED draft right after the pending autosave went out
 * (so it is exactly what submitting will freeze). The contract changes aren't in it: the dialog
 * computes those from `variables` and `baseline`.
 */
export interface SubmitSummary {
  templateId: string;
  /** The number the version gets at submit: one above the template's highest. */
  number: number;
  /** The channels the version renders to, in the content type's order. */
  channels: Channel[];
  /** Names of every sample data set, defaults first. */
  sampleSetNames: string[];
  variables: Variable[];
  /** The version the contract is compared with (`contractBaseline`: the newest that still renders); null when none does. */
  baseline: { number: number; variables: Variable[] } | null;
}
