import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { BreakingBadge } from "@/components/review-queue/breaking-badge";
import { codeSegments } from "@/components/versions/format";
import type { Person } from "@/domain/review-types";
import type { ContractChange } from "@/domain/types";

// The sections of the decision rail's scrolling part. Rail measures: 20px side padding, 32px controls,
// 24px section labels, 12px from a label to its content.

const MONO = "rounded-md px-1 py-px font-mono text-[12.5px] text-text";

/** "adds required `annual_fee`" → the key in Geist Mono, on a chip (`surface`: the chip's own background, for the tinted dialog box). */
export function WithKeys({ text, surface = "bg-surface-sunken" }: { text: string; surface?: string }) {
  return (
    <>
      {codeSegments(text).map((part, i) =>
        part.code ? (
          <code key={i} className={`${MONO} ${surface}`}>
            {part.text}
          </code>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function SectionLabel({ children, right, id }: { children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="flex h-6 items-center justify-between gap-3">
      <h2 id={id} className="caps-label">
        {children}
      </h2>
      {right}
    </div>
  );
}

/** What the author said when they submitted. */
export function SubmitNote({ author, note }: { author: Person; note: string }) {
  return (
    <figure className="rounded-xl border border-hairline bg-surface-tinted px-3 py-2.5">
      <figcaption className="text-[12px] leading-4 text-text-subtle">Note from {author.name}</figcaption>
      <p className="mt-1 text-[14px] leading-5 [overflow-wrap:anywhere] text-text">{note}</p>
    </figure>
  );
}

/**
 * What the version changes for the teams that call it, one plain sentence each (domain/contract.ts).
 * The lines and the changes are the same list in the same order, so a line is breaking when its change is.
 */
export function ContractSection({
  changes,
  lines,
  first = false,
  className,
}: {
  changes: readonly ContractChange[];
  lines: readonly string[];
  /** The first version of the template: there is nothing before it to differ from. */
  first?: boolean;
  className?: string;
}) {
  const breaking = changes.some((change) => change.breaking);
  return (
    <section aria-labelledby="review-contract" className={className}>
      <SectionLabel id="review-contract" right={breaking ? <BreakingBadge /> : null}>
        Contract changes
      </SectionLabel>
      {lines.length === 0 ? (
        <p className="mt-3 text-[14px] leading-6 text-text-subtle">{first ? "First version." : "No contract changes."}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {lines.map((line, i) => (
            <li key={i} className="grid grid-cols-[1.25rem_1fr] gap-x-3 text-[14px] leading-6">
              <span className="grid h-6 place-items-center">
                {changes[i]?.breaking ? (
                  <TriangleAlert aria-label="Breaking" strokeWidth={1.75} className="size-4 text-warning-text" />
                ) : (
                  <span aria-hidden className="size-1.5 rounded-full bg-text-subtle" />
                )}
              </span>
              <span className="text-text">
                <WithKeys text={line} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
