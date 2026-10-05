"use client";

import { useState } from "react";
import type { UsageRow } from "@/domain/golive-types";
import { ConsumerFilter, ConsumersTable } from "./consumers-table";
import { Panel } from "./panel";

/** The Consumers tab's table card: its heading and the All / On superseded / Failing filter. */
export function ConsumersCard({ rows, nowIso }: { rows: UsageRow[]; nowIso: string }) {
  const [filter, setFilter] = useState<"all" | "superseded" | "failing">("all");
  return (
    <Panel className="@container/usage">
      <div className="flex min-h-9 items-center justify-between gap-4">
        <h2 className="m-0 text-[28px] leading-9 font-normal tracking-tight text-text">Who renders what</h2>
        <ConsumerFilter value={filter} onChange={setFilter} />
      </div>
      <ConsumersTable rows={rows} nowIso={nowIso} name="Consumers" filter={filter} className="mt-5" />
    </Panel>
  );
}
