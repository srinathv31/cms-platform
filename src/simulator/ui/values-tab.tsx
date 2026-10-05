import { AlertTriangle } from "lucide-react";
import type { SimFieldPath, SimMappingRow } from "@/simulator/types";
import { Mono, Panel } from "./bits";
import { MappingTable } from "./mapping-table";

/** Values tab: one row per variable of the pinned version; each change saves at once. */
export function ValuesTab({
  rows,
  templateId,
  version,
  sentence,
  error,
  onChange,
}: {
  rows: SimMappingRow[];
  templateId: string;
  version: number;
  /** "Map Annual fee to send." while required values are unmapped. */
  sentence: string;
  error: { key: string; reason: string } | null;
  onChange: (key: string, field: SimFieldPath | null) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Map values"
        right={
          <Mono className="text-(--sim-muted)">
            {templateId} · v{version}
          </Mono>
        }
      >
        <MappingTable rows={rows} error={error} onChange={onChange} />
      </Panel>
      {sentence ? (
        <p className="m-0 flex min-h-6 items-center gap-2 text-[13px] text-(--sim-bad)">
          <AlertTriangle aria-hidden className="size-4" strokeWidth={2} />
          {sentence}
        </p>
      ) : null}
    </div>
  );
}
