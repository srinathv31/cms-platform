// The variable chip, presentational only (no hooks, no client APIs).
// Shared by the live editor's NodeView and the server static renderer so both paint the same pill.

import { TriangleAlert } from "lucide-react";
import type { Variable } from "../model/types";
import { cx } from "../lib/cx";
import { TYPE_ICONS } from "./type-icon";

export interface VariableChipViewProps {
  /** The key stored on the node. */
  variableKey: string | null;
  /** The resolved variable, or undefined when the key isn't in the variable list. */
  variable: Variable | undefined;
  /** NodeSelection on the chip (editor only). */
  selected?: boolean;
  className?: string;
}

// Geometry is in em so chips scale with the text they sit in (body, headings, table cells).
// The box (≈1.45em) stays inside the 1.7 body line box, so a chip never makes a line taller.
const BASE =
  "inline-block max-w-full whitespace-nowrap rounded-md border px-[0.4em] align-baseline text-[0.875em] font-medium leading-[1.45] [overflow-wrap:normal] transition-shadow duration-150";

export function VariableChipView({ variableKey, variable, selected = false, className }: VariableChipViewProps) {
  const known = variable !== undefined;
  const Icon = known ? TYPE_ICONS[variable.type] : TriangleAlert;

  return (
    <span
      data-variable={variableKey ?? ""}
      data-variable-type={variable?.type}
      data-unknown={known ? undefined : ""}
      data-selected={selected ? "" : undefined}
      className={cx(
        BASE,
        known
          ? "border-chip-border bg-chip text-chip-text"
          : "border-status-review-border bg-status-review text-status-review-text",
        selected && "ring-2 ring-ring/60",
        className,
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cx("mr-[0.3em] inline-block size-[0.95em] align-[-0.14em]", known && "text-chip-icon")}
      />
      {known ? variable.label : <span className="font-mono text-[0.92em]">{variableKey || "unknown"}</span>}
    </span>
  );
}
