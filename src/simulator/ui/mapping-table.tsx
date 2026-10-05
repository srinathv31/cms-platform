import type { SimField, SimFieldPath, SimMappingRow } from "@/simulator/types";
import { Mono, TableWrap, TD, TH } from "./bits";
import { TYPE_LABEL } from "./format";
import { MappingSelect } from "./mapping-select";

/** The variables-to-fields table used by the Values tab and the link flow. Rows are comboboxes named by label. */
export function MappingTable({
  rows,
  label = "Variables",
  error,
  fields,
  onChange,
}: {
  rows: SimMappingRow[];
  label?: string;
  error?: { key: string; reason: string } | null;
  fields?: readonly SimField[];
  onChange: (key: string, field: SimFieldPath | null) => void;
}) {
  return (
    <TableWrap>
      <table aria-label={label} className="w-full min-w-[34rem] border-collapse">
        <thead>
          <tr className="border-b border-(--sim-line) bg-(--sim-panel2)">
            <th className={TH}>Variable</th>
            <th className={TH}>Type</th>
            <th className={TH}>Required</th>
            <th className={TH}>Coral field</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-(--sim-line) last:border-0">
              <td className={TD}>
                <p className="m-0 font-medium">{row.label}</p>
                <Mono className="text-(--sim-muted)">{row.key}</Mono>
              </td>
              <td className={`${TD} text-(--sim-muted)`}>{TYPE_LABEL[row.type]}</td>
              <td className={TD}>{row.required ? "Yes" : "No"}</td>
              <td className={TD}>
                <MappingSelect label={row.label} type={row.type} value={row.field} fields={fields} invalid={row.required && !row.field} onChange={(f) => onChange(row.key, f)} />
                {error?.key === row.key ? (
                  <p role="alert" className="m-0 mt-1 text-[12px] text-(--sim-bad)">
                    {error.reason}
                  </p>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
