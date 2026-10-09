import { Fragment } from "react";
import { Activity, Braces, Check, CornerUpLeft, MessageSquareText, TriangleAlert, type LucideIcon } from "lucide-react";
import { BreakingBadge } from "@/components/review-queue/breaking-badge";
import { StatusBadge } from "@/components/primitives/status-badge";
import { cn } from "@/lib/utils";
import type { VersionState } from "@/domain/types";
import { formatShortDate } from "@/domain/dates";
import { plural } from "@/domain/plural";
import type { VersionTimelineItem } from "@/domain/review-types";
import { formatLastRender } from "@/components/usage/format";
import { entryHeadingId } from "./entry-ids";
import { codeSegments } from "./format";
import { EntryActions, RevokeBlockActions, type VersionContext } from "./version-actions";

// One version on the timeline (a server component): the dates and sentences are made here, every
// absolute date in UTC (`@/domain/dates`), and the only client parts are the action islands.

/**
 * The geometry every entry shares, so the skeleton can draw it exactly. The heading row is always the
 * Button height (32px), whether or not the viewer has actions: the entry doesn't change height with
 * who is looking. The dot and the line are placed from the middle of that row.
 */
export const ENTRY_GEOMETRY = {
  /** The timeline column: the dot sits in it, and the line runs down through every entry. */
  indent: "pl-9",
  dot: "absolute top-[12px] left-0 size-[9px] rounded-full ring-4 ring-canvas",
  line: "absolute top-[20px] -bottom-[10px] left-[4px] w-px bg-hairline",
  /** The heading row: the version, its badges and its actions. */
  head: "flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2",
  heading: "text-[17px] leading-7 font-medium text-text outline-none",
} as const;

const DOT: Record<VersionState, string> = {
  draft: "bg-hairline-strong",
  in_review: "bg-status-review-border",
  changes_requested: "bg-hairline-strong",
  active: "bg-brand",
  superseded: "bg-hairline-strong",
  revoked: "bg-danger",
};

/** `key` spans in a plain-English line, set in mono. */
function Line({ text }: { text: string }) {
  return (
    <>
      {codeSegments(text).map((part, i) =>
        part.code ? (
          <code key={i} className="rounded-md bg-surface-tinted px-1.5 py-px font-mono text-[12.5px] text-text">
            {part.text}
          </code>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** A row of the entry's facts. A breaking change carries the warning tokens, as it does in the submit dialog. */
function Fact({ icon: Icon, tone, children }: { icon: LucideIcon; tone?: "positive" | "warning"; children: React.ReactNode }) {
  return (
    <li
      className={cn(
        "flex gap-2.5 text-[14px] leading-6",
        // The tint reaches left past the icon by the padding; the icon and the text keep their column.
        tone === "warning" ? "-ml-2 rounded-md bg-warning-soft px-2 text-warning-text" : "text-text",
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={tone === "warning" ? 2 : 1.75}
        className={cn("mt-1 size-4 shrink-0", tone === "positive" ? "text-positive" : tone === "warning" ? "text-warning-text" : "text-text-subtle")}
      />
      <span className="min-w-0 break-words">
        {tone === "warning" ? <span className="sr-only">Breaking: </span> : null}
        {children}
      </span>
    </li>
  );
}

/** What someone wrote (a note, a reason), in quotes, with its paragraph breaks. */
function Quoted({ children }: { children: string }) {
  return <span className="whitespace-pre-line">&ldquo;{children}&rdquo;</span>;
}

const name = (who: string) => <span className="font-medium">{who}</span>;

/** The key dates of the version, in the order they happened. */
function keyDates(item: VersionTimelineItem, now: Date): string[] {
  const dates: string[] = [];
  if (item.state === "draft") return [`Started ${formatShortDate(item.createdAt, now)}`];
  if (item.submittedAt) dates.push(`Submitted ${formatShortDate(item.submittedAt, now)}`);
  if (item.activatedAt) dates.push(`Activated ${formatShortDate(item.activatedAt, now)}`);
  if (item.supersededAt) dates.push(`Superseded ${formatShortDate(item.supersededAt, now)}`);
  if (item.sunsetDay && item.sunsetPassed) dates.push(`Sunset passed ${formatShortDate(item.sunsetDay, now)}`);
  if (item.revoke?.confirmedAt) dates.push(`Revoked ${formatShortDate(item.revoke.confirmedAt, now)}`);
  return dates;
}

export function VersionEntry({
  item,
  ctx,
  now,
  last,
}: {
  item: VersionTimelineItem;
  ctx: VersionContext;
  now: Date;
  last: boolean;
}) {
  const headingId = entryHeadingId(item.id);
  const dates = keyDates(item, now);
  const rendersForConsumers = item.state === "active" || item.state === "superseded" || item.state === "revoked";
  const revoke = item.revoke;
  const revokePending = !!revoke && !revoke.confirmedAt;
  const status = <StatusBadge state={item.state} sunsetDay={item.sunsetDay} now={now} />;
  // Breaking changes first, then the rest, each group in the diff's order (as in the submit dialog).
  const contract = [...item.contractItems.filter((c) => c.breaking), ...item.contractItems.filter((c) => !c.breaking)];

  return (
    <li
      data-slot="version-entry"
      data-version={item.number ?? "draft"}
      data-state={item.state}
      className={cn("relative", ENTRY_GEOMETRY.indent, last ? "pb-0" : "pb-9")}
    >
      <span aria-hidden className={cn(ENTRY_GEOMETRY.dot, DOT[item.state])} />
      {last ? null : <span aria-hidden className={ENTRY_GEOMETRY.line} />}

      <div className={ENTRY_GEOMETRY.head}>
        {item.number === null ? (
          // The open draft has no number to call it by: its badge is its name, so it isn't said twice.
          <h2 id={headingId} tabIndex={-1} className={cn(ENTRY_GEOMETRY.heading, "flex h-7 items-center")}>
            {status}
          </h2>
        ) : (
          <>
            <h2 id={headingId} tabIndex={-1} className={ENTRY_GEOMETRY.heading}>
              v{item.number}
            </h2>
            {status}
          </>
        )}
        <EntryActions ctx={ctx} item={item} />
      </div>

      {/* The separators sit in each item's left padding, and the row is pulled left by the same amount
          inside a clip: an item that starts a line has its separator clipped, so no line begins with "·". */}
      <div className="mt-0.5 overflow-hidden">
        <p className="-ml-4 flex flex-wrap text-[13px] leading-5 text-text-muted">
          <span className="pl-4 font-medium whitespace-nowrap text-text">{item.author.name}</span>
          {dates.map((date) => (
            <span key={date} className="relative pl-4 whitespace-nowrap">
              <span aria-hidden className="absolute left-[6px] text-text-subtle">
                ·
              </span>
              {date}
            </span>
          ))}
        </p>
      </div>

      {item.submitNote || contract.length > 0 || item.decisions.length > 0 || rendersForConsumers ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {item.submitNote ? (
            <Fact icon={MessageSquareText}>
              <Quoted>{item.submitNote}</Quoted>
            </Fact>
          ) : null}
          {contract.map((line, i) => (
            <Fragment key={line.text}>
              {/* The flag, once, above the breaking lines it names (a row of its own: it can't make the heading row wrap). */}
              {i === 0 && line.breaking ? (
                <li className="flex h-[22px] items-center">
                  <BreakingBadge />
                </li>
              ) : null}
              <Fact icon={line.breaking ? TriangleAlert : Braces} tone={line.breaking ? "warning" : undefined}>
                <Line text={line.text} />
              </Fact>
            </Fragment>
          ))}
          {item.decisions.map((d) =>
            d.kind === "approved" ? (
              <Fact key={`${d.at}-${d.by.id}`} icon={Check} tone="positive">
                Approved by {name(d.by.name)} on {formatShortDate(d.at, now)}
              </Fact>
            ) : (
              <Fact key={`${d.at}-${d.by.id}`} icon={CornerUpLeft}>
                {name(d.by.name)} requested changes on {formatShortDate(d.at, now)}
                {d.reason ? (
                  <>
                    : <Quoted>{d.reason}</Quoted>
                  </>
                ) : (
                  "."
                )}
              </Fact>
            ),
          )}
          {rendersForConsumers ? (
            <Fact icon={Activity}>
              {item.lastRenderAt
                ? `Last render ${formatLastRender(item.lastRenderAt, now)}. ${
                    item.renders30d > 0 ? `${plural(item.renders30d, "render")} in the last 30 days.` : "No renders in the last 30 days."
                  }`
                : "No renders yet."}
            </Fact>
          ) : null}
        </ul>
      ) : null}

      {revoke ? (
        <div
          data-slot="revoke"
          data-pending={revokePending ? "" : undefined}
          className="mt-4 rounded-xl border border-status-revoked-border bg-danger-soft px-4 py-3.5 text-[14px] leading-6 text-danger-text"
        >
          {revokePending ? (
            <>
              <p>
                Revoke started by <span className="font-medium">{revoke.startedBy.name}</span>: <Quoted>{revoke.reason}</Quoted>
              </p>
              <RevokeBlockActions ctx={ctx} item={item} />
            </>
          ) : (
            <>
              <p>
                Revoked {revoke.confirmedAt ? formatShortDate(revoke.confirmedAt, now) : ""}: <Quoted>{revoke.reason}</Quoted>
              </p>
              <p className="mt-0.5 text-[13px] leading-5 opacity-80">
                Started by {revoke.startedBy.name}
                {revoke.confirmedBy ? `, confirmed by ${revoke.confirmedBy.name}` : ""}.
              </p>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
