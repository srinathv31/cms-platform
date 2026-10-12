"use client";

import { useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import { ArrowRight } from "lucide-react";
import { FieldsDocument } from "@/components/redline/fields-document";
import { NameChangeLine } from "@/components/redline/name-change";
import { RedlineDocument } from "@/components/redline/redline-document";
import { redlineSummary } from "@/components/redline/blocks";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollRegion } from "@/components/primitives/scroll-region";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { addCounts, diffChannelFields } from "@/domain/redline/channel-fields";
import { diffDocuments, nameChange } from "@/domain/redline/document";
import type { RedlineDoc } from "@/domain/review-types";
import { STATUS_META } from "@/domain/status";
import type { Variable } from "@/editor/model/types";
import { readTemplate } from "@/lib/template-reads";
import { cn } from "@/lib/utils";
import type { ComparePair } from "@/server/queries/compare";
import type { CompareOption } from "@/server/queries/versions";

// The Compare dialog's content: the two version pickers, the "Changes only" switch, and the redline: the
// name, each channel's own fields (an email's subject and preheader, above the body; an alert's push and
// SMS, which are its whole content), then the body.
// The pickers only offer pairs that read forward in time (From is the older one, always), so the
// diff never runs backwards and no combination is empty. They list every round, and open on the two
// newest versions (`openingPair`). Each pair is read from GET /api/templates/[templateId]/compare.

type Loaded =
  ({ key: string; ok: true } & ComparePair) | { key: string; ok: false };

// One line at every width: the pickers and the switch keep their size, and the summary, which is the
// one part that can be long, gives way (it truncates, and says all of it on hover). In a window under 26rem
// (reflow, decision 0045) the row is three: From, To, then the summary and the switch; the summary wraps.
const CONTROLS =
  "flex h-[3.75rem] shrink-0 items-center gap-x-4 border-b border-hairline px-8 max-[26rem]:h-auto max-[26rem]:flex-wrap max-[26rem]:gap-y-2 max-[26rem]:px-5 max-[26rem]:py-3";
/** A label and its picker, which stay together when the row wraps. */
const PICKER = "flex shrink-0 items-center gap-4 max-[26rem]:w-full";

/** The redline's summary, with a rename counted first. */
function withRename(counts: RedlineDoc["counts"], renamed: boolean): string {
  if (!renamed) return redlineSummary(counts);
  const changed =
    counts.added + counts.removed + counts.changed + counts.moved > 0;
  return changed ? `Renamed, ${redlineSummary(counts)}` : "Renamed";
}

function VersionSelect({
  labelId,
  value,
  options,
  onChange,
  triggerRef,
}: {
  triggerRef?: Ref<HTMLButtonElement>;
  labelId: string;
  value: string;
  options: readonly CompareOption[];
  onChange: (id: string) => void;
}) {
  const byId = new Map(options.map((o) => [o.id, o]));
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      {/* Wide enough for a round's label ("v3 · Round 2"); the list is as wide as its longest option. */}
      <SelectTrigger
        ref={triggerRef}
        aria-labelledby={labelId}
        className="h-8 w-36 shrink-0 bg-surface max-[26rem]:w-auto max-[26rem]:flex-1"
      >
        <SelectValue>{(id: string) => byId.get(id)?.label ?? ""}</SelectValue>
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        className="w-auto min-w-44 p-1"
      >
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            <span className="font-medium">{o.label}</span>
            <span className="text-text-muted">
              {STATUS_META[o.state].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The pair the panel opens on: the two newest versions, each number as its head (`CompareOption.head`, the
 * draft included), so a version's sent-back rounds aren't what it compares first. With fewer than two
 * heads (a first version on its second round), the two newest rows.
 */
export function openingPair(options: readonly CompareOption[]): {
  fromId: string;
  toId: string;
} {
  const heads = options.filter((o) => o.head);
  const [to, from] = heads.length >= 2 ? heads : options;
  return { fromId: from!.id, toId: to!.id };
}

export default function ComparePanel({
  templateId,
  options,
}: {
  templateId: string;
  options: CompareOption[];
}) {
  // `options` is newest first: index 0 is the newest, so "older" means a higher index.
  const [fromId, setFromId] = useState(() => openingPair(options).fromId);
  const [toId, setToId] = useState(() => openingPair(options).toId);
  const [changesOnly, setChangesOnly] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const fromTrigger = useRef<HTMLButtonElement>(null);
  const fromLabel = useId();
  const toLabel = useId();
  const switchId = useId();

  const fromIndex = options.findIndex((o) => o.id === fromId);
  const fromOptions = options.slice(1);
  const toOptions = options.slice(0, fromIndex);

  // The first field takes the focus once the panel's code has arrived (the dialog opened a moment ago).
  useEffect(() => fromTrigger.current?.focus(), []);

  const key = `${fromId}:${toId}:${attempt}`;
  useEffect(() => {
    let live = true;
    readTemplate<ComparePair>(templateId, "compare", { from: fromId, to: toId })
      .then((result) => {
        if (!live) return;
        setLoaded(
          result.ok
            ? {
                key,
                ok: true,
                family: result.family,
                from: result.from,
                to: result.to,
              }
            : { key, ok: false },
        );
      })
      .catch(() => live && setLoaded({ key, ok: false }));
    return () => {
      live = false;
    };
  }, [templateId, fromId, toId, key]);

  const ready = loaded?.key === key ? loaded : null;
  const redline = useMemo(
    () => (ready?.ok ? diffDocuments(ready.from.body, ready.to.body) : null),
    [ready],
  );
  // Each channel's own fields, over the registry, and the SMS footer each version sends: a change counts with the body's.
  const fields = useMemo(
    () => (ready?.ok ? diffChannelFields(ready.from, ready.to) : null),
    [ready],
  );
  // A message (an Alert) has no body: its fields are all there is to compare. Its content type says so.
  const message = ready?.ok ? ready.family === "message" : false;
  // The name is versioned, so a rename between the two shows with the redline, above the document, and
  // the summary counts it ("Renamed", "Renamed, 2 added and 1 changed") rather than saying "No changes".
  const rename = ready?.ok ? nameChange(ready.from.name, ready.to.name) : null;
  const summary =
    redline && fields
      ? withRename(addCounts(redline.counts, fields.counts), rename !== null)
      : "";
  const variables = useMemo<Variable[]>(() => {
    if (!ready?.ok) return [];
    const known = new Set(ready.to.variables.map((v) => v.key));
    return [
      ...ready.to.variables,
      ...ready.from.variables.filter((v) => !known.has(v.key)),
    ];
  }, [ready]);

  function pickFrom(id: string) {
    const index = options.findIndex((o) => o.id === id);
    setFromId(id);
    // The pair must read forward: if To is no newer than the new From, step To to the version after it.
    if (options.findIndex((o) => o.id === toId) >= index)
      setToId(options[index - 1].id);
  }

  return (
    <>
      <div className={CONTROLS}>
        <div className={PICKER}>
          <span
            id={fromLabel}
            className="shrink-0 text-[13px] text-text-muted max-[26rem]:w-8"
          >
            From
          </span>
          <VersionSelect
            triggerRef={fromTrigger}
            labelId={fromLabel}
            value={fromId}
            options={fromOptions}
            onChange={pickFrom}
          />
        </div>
        <ArrowRight
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-text-subtle max-[26rem]:hidden"
        />
        <div className={PICKER}>
          <span
            id={toLabel}
            className="shrink-0 text-[13px] text-text-muted max-[26rem]:w-8"
          >
            To
          </span>
          <VersionSelect
            labelId={toLabel}
            value={toId}
            options={toOptions}
            onChange={setToId}
          />
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-4 max-[26rem]:ml-0 max-[26rem]:w-full max-[26rem]:justify-between">
          {redline ? (
            <span
              data-slot="redline-summary"
              title={summary}
              className="min-w-0 truncate text-[13px] text-text-muted max-[26rem]:overflow-visible max-[26rem]:whitespace-normal"
            >
              {summary}
            </span>
          ) : null}
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              id={switchId}
              checked={changesOnly}
              onCheckedChange={setChangesOnly}
            />
            <Label
              htmlFor={switchId}
              className="text-[13px] font-normal whitespace-nowrap text-text"
            >
              Changes only
            </Label>
          </div>
        </div>
      </div>

      <ScrollRegion
        label="Changes between the versions"
        axis="y"
        data-slot="compare-body"
        className="min-h-0 flex-1 overscroll-contain rounded-none px-8 pt-6 pb-10 focus-visible:ring-inset max-[26rem]:px-5"
      >
        {/* One child that grows with what it shows (the redline, the skeleton, the error): the region's Tab stop follows it. */}
        <div className="min-h-full">
          {redline ? (
            <>
              {rename ? (
                <div className="mx-auto mb-6 flex max-w-(--doc-width) flex-col gap-1">
                  <h3 className="caps-label">Name</h3>
                  <NameChangeLine change={rename} />
                </div>
              ) : null}
              {fields ? (
                <FieldsDocument
                  fields={fields.fields}
                  variables={variables}
                  layout={message ? "sections" : "details"}
                  headingLevel={3}
                  changesOnly={changesOnly}
                  footer={fields.footer}
                  className={cn(
                    "[--ucomp-doc-gutter:3.5rem] max-[26rem]:[--ucomp-doc-gutter:2.5rem]",
                    !message && "mb-6",
                  )}
                />
              ) : null}
              {message ? null : (
                <RedlineDocument
                  doc={redline}
                  variables={variables}
                  changesOnly={changesOnly}
                  className="[--ucomp-doc-gutter:3.5rem] max-[26rem]:[--ucomp-doc-gutter:2.5rem]"
                />
              )}
            </>
          ) : ready && !ready.ok ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-[14px] text-text-muted">
              <p>Couldn&apos;t load these versions.</p>
              <Button
                variant="outline"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Try again
              </Button>
            </div>
          ) : (
            <div
              aria-hidden
              className="mx-auto flex max-w-[47.5rem] flex-col gap-3 pt-2"
            >
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="mt-6 h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          )}
        </div>
      </ScrollRegion>
    </>
  );
}
