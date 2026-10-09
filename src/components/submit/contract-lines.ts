// The submit dialog's contract section: the draft's variable list against the baseline's (the newest
// version that still renders, `contractBaseline` in domain/lifecycle.ts), as the plain-English lines from
// domain/contract.ts, each flagged breaking or not. Pure, so it is tested alone.
//
// The diff is the one the server freezes at submit (`diffVariables` on the saved lists, where a renamed
// variable keeps its identity as its id), so what the author reads here, a rename included, is what the
// reviewer reads on the review screen.

import { describeChanges } from "@/domain/contract";
import type { Variable } from "@/domain/types";
import { diffVariables } from "@/editor/model/contract";

export interface ContractLine {
  text: string;
  breaking: boolean;
}

export interface ContractSection {
  /** The version the draft is compared with. */
  baselineNumber: number;
  /** Breaking changes first, each group in the order the diff lists them. */
  lines: ContractLine[];
  breaking: boolean;
}

/** null when no version still renders: there is nothing to compare with, so the dialog has no section. */
export function contractSection(input: {
  baseline: { number: number; variables: readonly Variable[] } | null;
  variables: readonly Variable[];
  /** The number the version is about to get. */
  versionNumber: number;
}): ContractSection | null {
  const { baseline, variables, versionNumber } = input;
  if (!baseline) return null;

  const changes = diffVariables(baseline.variables, variables);
  // One change at a time, so a line's flag is its own change's, however the sentences are worded.
  const lines = changes.flatMap((change) =>
    describeChanges([change], versionNumber).map((text): ContractLine => ({ text, breaking: change.breaking })),
  );
  const ordered = [...lines.filter((l) => l.breaking), ...lines.filter((l) => !l.breaking)];
  return { baselineNumber: baseline.number, lines: ordered, breaking: changes.some((c) => c.breaking) };
}

export interface TextPart {
  text: string;
  /** Between backticks: a key or a type name, set in Geist Mono. */
  code: boolean;
}

/** "adds required `annual_fee` (Currency)." → text, code, text. */
export function splitCode(line: string): TextPart[] {
  return line
    .split("`")
    .map((text, index): TextPart => ({ text, code: index % 2 === 1 }))
    .filter((part) => part.text !== "");
}

/** "Define or remove {{promo_code}} before submitting." → text, key, text: the `{{key}}` goes in Geist Mono. */
export function splitKeys(sentence: string): TextPart[] {
  return sentence
    .split(/(\{\{[^}]+\}\})/)
    .map((text): TextPart => ({ text, code: /^\{\{[^}]+\}\}$/.test(text) }))
    .filter((part) => part.text !== "");
}
