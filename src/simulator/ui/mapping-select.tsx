import { cn } from "@/lib/utils";
import type { ApiVariableType } from "@/contracts/api-v1";
import type { SimField, SimFieldPath } from "@/simulator/types";
import { SIM_FIELDS } from "@/simulator/fields";

/**
 * One mapping row's field picker. A native select, named by the variable's label (a combobox to assistive
 * tech and to specs). Fields that fit the variable's type come first; the rest follow, so a mismatch is
 * possible (and fails at render, which is Coral's problem to show).
 */
export function MappingSelect({
  label,
  type,
  value,
  invalid,
  disabled,
  onChange,
  fields = SIM_FIELDS,
}: {
  label: string;
  type: ApiVariableType;
  value: SimFieldPath | null;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (path: SimFieldPath | null) => void;
  fields?: readonly SimField[];
}) {
  const fits = fields.filter((f) => f.fits.includes(type));
  const rest = fields.filter((f) => !f.fits.includes(type));
  return (
    <select
      aria-label={label}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as SimFieldPath | null)}
      className={cn(
        "h-8 w-full max-w-[17rem] cursor-pointer rounded-(--sim-rb) border bg-(--sim-panel) px-2 text-[13px] text-(--sim-text) disabled:cursor-not-allowed disabled:opacity-40",
        invalid ? "border-(--sim-bad)" : "border-(--sim-line)",
      )}
    >
      <option value="">Choose a field…</option>
      <optgroup label="Fits this type">
        {fits.map((f) => (
          <option key={f.path} value={f.path}>
            {f.label}
          </option>
        ))}
      </optgroup>
      {rest.length > 0 ? (
        <optgroup label="Other fields">
          {rest.map((f) => (
            <option key={f.path} value={f.path}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}
