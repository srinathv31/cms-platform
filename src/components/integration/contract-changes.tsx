"use client";

import { Fragment, useState } from "react";
import { Segmented } from "@/components/primitives/segmented";
import { StatusBadge } from "@/components/primitives/status-badge";
import type { IntegrationPanelData } from "@/domain/golive-types";
import { cn } from "@/lib/utils";

type Since = IntegrationPanelData["since"][number];

/** `annual_fee` in a sentence from the API: keys go in Geist Mono. */
function Sentence({ text }: { text: string }) {
  return (
    <>
      {text.split(/`([^`]+)`/).map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="font-mono text-[12.5px] text-text">
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** The heading and picker row: "What changed since v1", with a version picker when there are several older versions. */
export function ContractChanges({ since, activeNumber }: { since: readonly Since[]; activeNumber: number }) {
  const [picked, setPicked] = useState(since[0]?.number ?? 0);
  const current = since.find((s) => s.number === picked) ?? since[0];
  if (!current) return null;
  const anyBreaking = current.diff.items.some((i) => i.breaking);

  return (
    <section aria-labelledby="integration-changes" className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 id="integration-changes" className="caps-label">
          What changed since v{current.number}
        </h3>
        {since.length > 1 ? (
          <Segmented
            label="Compare with version"
            value={String(current.number)}
            options={since.map((s) => ({ value: String(s.number), label: `v${s.number}` }))}
            onChange={(number) => setPicked(Number(number))}
          />
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-[13px] text-text-muted">
        <span className="font-medium text-text">v{current.number}</span>
        <StatusBadge state={current.state} sunsetDay={current.sunsetDay} />
        <span aria-hidden>to</span>
        <span className="font-medium text-text">v{activeNumber}</span>
      </div>
      {current.diff.items.length === 0 ? (
        <p className="text-[13px] leading-5 text-text-muted">No contract changes.</p>
      ) : (
        <ul aria-label={`Changes since v${current.number}`} className="flex flex-col">
          {current.diff.items.map((item, i) => (
            <li
              key={`${item.kind}-${item.key}-${i}`}
              className="flex items-start gap-3 border-b border-hairline py-2.5 first:pt-0 last:border-b-0"
            >
              {anyBreaking ? (
                <span className="flex w-[4.5rem] shrink-0 pt-px">
                  {item.breaking ? (
                    <span className="inline-flex h-5 items-center rounded-md bg-danger-soft px-1.5 text-[11.5px] font-medium text-danger-text">
                      Breaking
                    </span>
                  ) : null}
                </span>
              ) : null}
              <p className={cn("min-w-0 flex-1 text-[13px] leading-5", item.breaking ? "text-text" : "text-text-muted")}>
                <Sentence text={item.text} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
