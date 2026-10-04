// The variable catalog and sample sets. A version's variable list is the consumer's API contract.
// Sample values use the canonical string forms in src/editor/model/types.ts.

import type { SampleSet, Variable, VariableType } from "@/domain/types";
import { DAY } from "./time";

export type VarKey =
  | "first_name"
  | "last_name"
  | "purchase_apr"
  | "home_state"
  | "offer_end_date"
  | "annual_fee"
  | "effective_date"
  | "apy"
  | "minimum_balance"
  | "monthly_fee";

interface Def {
  label: string;
  type: VariableType;
  required: boolean;
  typical: string;
  long: string;
  minimum: string;
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class VariableKit {
  private defs: Record<VarKey, Def>;

  constructor(base: number) {
    this.defs = {
      first_name: { label: "First name", type: "text", required: true, typical: "Maya", long: "Alexandria-Marguerite", minimum: "Al" },
      last_name: { label: "Last name", type: "text", required: true, typical: "Chen", long: "Featherstonehaugh-Villiers", minimum: "Li" },
      purchase_apr: { label: "Purchase APR", type: "percent", required: true, typical: "21.99", long: "29.99", minimum: "9.99" },
      home_state: { label: "Home state", type: "us_state", required: true, typical: "NJ", long: "NC", minimum: "OH" },
      offer_end_date: { label: "Offer end date", type: "date", required: false, typical: isoDate(base + 45 * DAY), long: isoDate(base + 365 * DAY), minimum: isoDate(base + 7 * DAY) },
      annual_fee: { label: "Annual fee", type: "currency", required: true, typical: "95", long: "695", minimum: "0" },
      effective_date: { label: "Effective date", type: "date", required: true, typical: isoDate(base + 30 * DAY), long: isoDate(base + 365 * DAY), minimum: isoDate(base + 7 * DAY) },
      apy: { label: "APY", type: "percent", required: true, typical: "4.25", long: "5.00", minimum: "0.10" },
      minimum_balance: { label: "Minimum balance", type: "currency", required: true, typical: "1000", long: "100000", minimum: "500" },
      monthly_fee: { label: "Monthly fee", type: "currency", required: true, typical: "12", long: "25", minimum: "0" },
    };
  }

  /** The variable list for a version. `overrides` tweaks labels (e.g. a label change between versions). */
  list(keys: VarKey[], overrides: Partial<Record<VarKey, Partial<Pick<Variable, "label">>>> = {}): Variable[] {
    return keys.map((key) => {
      const d = this.defs[key];
      return {
        key,
        label: overrides[key]?.label ?? d.label,
        type: d.type,
        required: d.required,
        sample: d.typical,
      };
    });
  }

  /** The three standard sample sets, covering exactly the given variables. */
  sampleSets(variables: Variable[]): SampleSet[] {
    const build = (id: string, name: string, pick: (d: Def) => string): SampleSet => ({
      id,
      name,
      values: Object.fromEntries(variables.map((v) => [v.key, pick(this.defs[v.key as VarKey])])),
    });
    return [
      build("typical", "Typical customer", (d) => d.typical),
      build("long", "Long name and maximum values", (d) => d.long),
      build("minimum", "Minimum values", (d) => d.minimum),
    ];
  }
}
