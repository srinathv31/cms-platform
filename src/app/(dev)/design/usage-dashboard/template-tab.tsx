"use client";

import { PageHeader } from "@/components/primitives/page-header";
import { StatusBadge } from "@/components/primitives/status-badge";
import { TemplateId } from "@/components/primitives/template-id";
import { Button } from "@/components/ui/button";
import { Share } from "lucide-react";
import { Legend, StackedBars } from "./charts";
import { InfoDot, Panel, PanelHead, TabRow, TrendPill } from "./bits";
import { ConsumersTable } from "./consumers-table";
import { TEMPLATE, fmt } from "./data";

/*
 * The per-template Usage tab: which consumers render which version. Compact on purpose: one chart,
 * two numbers, one table. The same rows feed the consequence line in the approve, sunset and revoke
 * dialogs ("Coral renders v1 on 58% of renders").
 */

const VERSIONS = [
  { label: "v1", className: "fill-brand-2" },
  { label: "v2", className: "fill-brand-4" },
];

export function TemplateTab() {
  const rows = TEMPLATE.rows;
  const total = rows.reduce((a, r) => a + r.renders, 0);
  const v1 = rows.filter((r) => r.version === 1).reduce((a, r) => a + r.renders, 0);
  const failed = rows.reduce((a, r) => a + r.failedCount, 0);
  return (
    <div className="pt-6 pb-4">
      <PageHeader
        title={TEMPLATE.name}
        className="pb-4"
        action={
          <Button variant="outline" size="lg"><Share aria-hidden strokeWidth={1.75} />Integration</Button>
        }
      >
        <div className="mt-3 flex items-center gap-4">
          <StatusBadge state="active" />
          <TemplateId id={TEMPLATE.id} />
        </div>
      </PageHeader>
      <TabRow
        tabs={[{ id: "content", label: "Content" }, { id: "versions", label: "Versions" }, { id: "usage", label: "Usage" }, { id: "activity", label: "Activity" }]}
        value="usage"
        onChange={() => {}}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <Panel>
          <div className="flex items-start justify-between gap-4">
            <PanelHead title="Renders by version" size="md" aside="Last 13 weeks" />
          </div>
          <Legend className="mt-2" series={VERSIONS} />
          <div className="mt-4">
            <StackedBars data={TEMPLATE.weeks.map((w) => ({ label: w.label, parts: [w.v1, w.v2] }))} series={VERSIONS} width={760} height={210} tickEvery={2} />
          </div>
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel>
            <div className="flex items-start justify-between"><div className="numeral text-text">{fmt.format(total)}</div><TrendPill>4%</TrendPill></div>
            <div className="caps-label mt-3">Renders, 30 days <InfoDot tip="Live renders only. Previews aren't counted." /></div>
          </Panel>
          <Panel>
            <div className="numeral text-text">{Math.round((1 - failed / total) * 1000) / 10}%</div>
            <div className="caps-label mt-3">Succeeded</div>
            <div className="mt-4 border-t border-hairline pt-3 text-[13px] text-text-muted">{Math.round((v1 / total) * 100)}% still on v1</div>
          </Panel>
        </div>
      </div>

      <Panel className="mt-6">
        <PanelHead title="Who renders it" size="md" />
        <ConsumersTable className="mt-3" rows={rows} />
      </Panel>
    </div>
  );
}
