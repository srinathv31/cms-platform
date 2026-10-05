"use client";

import { ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/primitives/status-badge";
import { TemplateId } from "@/components/primitives/template-id";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import type { IntegrationPanelData } from "@/domain/golive-types";
import type { Channel } from "@/domain/types";
import { CodeBlock } from "./code-block";
import { ContractChanges } from "./contract-changes";
import { ContractTable } from "./contract-table";
import { CopyButton } from "./copy-button";
import { Responses } from "./responses";
import { SampleRequest } from "./sample-request";

const CHANNEL_LABEL: Record<Channel, string> = { pdf: "PDF", web: "Web", email: "Email" };

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md border border-chip-border bg-chip px-2 text-[12.5px] font-medium text-chip-text">
      {children}
    </span>
  );
}

/**
 * The top row. It comes from props, so it is on screen the moment the sheet opens; only the channels wait
 * for the data (a skeleton of three chips holds their place).
 */
export function IntegrationIdentity({
  templateId,
  activeVersion,
  channels,
}: {
  templateId: string;
  activeVersion: number;
  channels: readonly Channel[] | null;
}) {
  return (
    <div className="flex items-start gap-12">
      <TemplateId id={templateId} />
      <div className="flex flex-col items-start gap-1">
        <span className="caps-label">Active version</span>
        <span className="flex h-6 items-center gap-2 text-[14px]">
          <span className="font-medium text-text">v{activeVersion}</span>
          <StatusBadge state="active" />
        </span>
      </div>
      <div className="flex flex-col items-start gap-1">
        <span className="caps-label">Channels</span>
        <span className="flex h-6 items-center gap-1.5">
          {channels ? (
            channels.map((c) => <Chip key={c}>{CHANNEL_LABEL[c]}</Chip>)
          ) : (
            <>
              <Skeleton className="h-6 w-11" />
              <Skeleton className="h-6 w-11" />
              <Skeleton className="h-6 w-14" />
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center">
        <h3 id={id} className="caps-label">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

/** The loaded panel, below the identity row. */
export function IntegrationBody({ panel }: { panel: IntegrationPanelData }) {
  return (
    <>
      <Section id="integration-contract" title="Variable contract">
        <ContractTable rows={panel.contract} />
      </Section>

      <Collapsible className="group/schema flex flex-col gap-3">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <CollapsibleTrigger className="group/trigger -ml-1 flex h-8 items-center gap-1 rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 text-text-muted transition-transform duration-(--dur-fast) group-data-panel-open/trigger:rotate-90"
            />
            <span className="caps-label">JSON Schema</span>
          </CollapsibleTrigger>
          <CopyButton label="JSON Schema" text={panel.jsonSchemaText} />
        </div>
        <CollapsibleContent>
          <CodeBlock label="JSON Schema" maxHeightClass="max-h-80">
            {panel.jsonSchemaText}
          </CodeBlock>
        </CollapsibleContent>
      </Collapsible>

      <Section id="integration-samples" title="Sample request">
        <SampleRequest samples={panel.samples} />
      </Section>

      <Section id="integration-responses" title="Responses">
        <Responses responses={panel.responses} errors={panel.errors} channels={panel.active.channels} />
      </Section>

      {panel.since.length > 0 ? <ContractChanges since={panel.since} activeNumber={panel.active.number} /> : null}
    </>
  );
}

/** The same sections with the real headings and about the real heights, while the panel loads. */
export function IntegrationSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-7">
      <Section id="integration-contract-sk" title="Variable contract">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      </Section>
      <Section id="integration-schema-sk" title="JSON Schema">
        <span />
      </Section>
      <Section id="integration-samples-sk" title="Sample request">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-60 w-full" />
      </Section>
      <Section id="integration-responses-sk" title="Responses">
        <Skeleton className="h-40 w-full" />
      </Section>
    </div>
  );
}
