import type { ContractRow } from "@/domain/golive-types";

// The variable contract: what the consumer sends in `values`. Keys are the point here, so they're in
// Geist Mono with the author's label beneath. Fixed column widths: nothing reflows between templates.

export function ContractTable({ rows }: { rows: readonly ContractRow[] }) {
  return (
    <table aria-label="Variable contract" className="w-full table-fixed border-collapse text-[13px]">
      <colgroup>
        <col className="w-[38%]" />
        <col className="w-[17%]" />
        <col className="w-[15%]" />
        <col />
      </colgroup>
      <thead>
        <tr className="border-b border-hairline text-left">
          {(["Key", "Type", "Required", "Example"] as const).map((h) => (
            <th key={h} scope="col" className="caps-label h-8 pr-3 text-left font-medium last:pr-0">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-hairline align-top last:border-b-0">
            <th scope="row" className="py-2.5 pr-3 text-left font-normal">
              <span className="block break-all font-mono text-[12.5px] leading-5 text-text">{row.key}</span>
              <span className="block text-[12px] leading-4 text-text-muted">{row.label}</span>
            </th>
            <td className="py-2.5 pr-3 leading-5 text-text">{row.typeLabel}</td>
            <td className={`py-2.5 pr-3 leading-5 ${row.required ? "text-text" : "text-text-muted"}`}>
              {row.required ? "Required" : "Optional"}
            </td>
            <td className="py-2.5 break-all font-mono text-[12.5px] leading-5 text-text-muted">{row.example}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
