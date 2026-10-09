"use client";

import { useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import { ArrowRight } from "lucide-react";
import { NameChangeLine } from "@/components/redline/name-change";
import { RedlineDocument } from "@/components/redline/redline-document";
import { redlineSummary } from "@/components/redline/blocks";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { diffDocuments, nameChange } from "@/domain/redline";
import type { RedlineDoc } from "@/domain/review-types";
import { STATUS_META } from "@/domain/status";
import type { Variable } from "@/editor/model/types";
import { readTemplate } from "@/lib/template-reads";
import type { CompareVersion } from "@/server/queries/compare";
import type { CompareOption } from "./compare-dialog";

// The Compare dialog's content: the two version pickers, the "Changes only" switch, and the redline.
// The pickers only offer pairs that read forward in time (From is the older one, always), so the
// diff never runs backwards and no combination is empty. Each pair is read from
// GET /api/templates/[templateId]/compare.

type Loaded = { key: string; ok: true; from: CompareVersion; to: CompareVersion } | { key: string; ok: false };

// One line at every width: the pickers and the switch keep their size, and the summary, which is the
// one part that can be long, gives way (it truncates, and says all of it on hover).
const CONTROLS = "flex h-[3.75rem] shrink-0 items-center gap-x-4 border-b border-hairline px-8";

/** The redline's summary, with a rename counted first. */
function withRename(counts: RedlineDoc["counts"], renamed: boolean): string {
  if (!renamed) return redlineSummary(counts);
  const changed = counts.added + counts.removed + counts.changed + counts.moved > 0;
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
      <SelectTrigger ref={triggerRef} aria-labelledby={labelId} className="h-8 w-28 shrink-0 bg-surface">
        <SelectValue>{(id: string) => byId.get(id)?.label ?? ""}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="min-w-44 p-1">
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            <span className="font-medium">{o.label}</span>
            <span className="text-text-muted">{STATUS_META[o.state].label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function ComparePanel({ templateId, options }: { templateId: string; options: CompareOption[] }) {
  // `options` is newest first: index 0 is the newest, so "older" means a higher index.
  const [fromId, setFromId] = useState(options[1].id);
  const [toId, setToId] = useState(options[0].id);
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
    readTemplate<{ from: CompareVersion; to: CompareVersion }>(templateId, "compare", { from: fromId, to: toId })
      .then((result) => {
        if (!live) return;
        setLoaded(result.ok ? { key, ok: true, from: result.from, to: result.to } : { key, ok: false });
      })
      .catch(() => live && setLoaded({ key, ok: false }));
    return () => {
      live = false;
    };
  }, [templateId, fromId, toId, key]);

  const ready = loaded?.key === key ? loaded : null;
  const redline = useMemo(() => (ready?.ok ? diffDocuments(ready.from.body, ready.to.body) : null), [ready]);
  // The name is versioned, so a rename between the two shows with the redline, above the document, and
  // the summary counts it ("Renamed", "Renamed, 2 added and 1 changed") rather than saying "No changes".
  const rename = ready?.ok ? nameChange(ready.from.name, ready.to.name) : null;
  const summary = redline ? withRename(redline.counts, rename !== null) : "";
  const variables = useMemo<Variable[]>(() => {
    if (!ready?.ok) return [];
    const known = new Set(ready.to.variables.map((v) => v.key));
    return [...ready.to.variables, ...ready.from.variables.filter((v) => !known.has(v.key))];
  }, [ready]);

  function pickFrom(id: string) {
    const index = options.findIndex((o) => o.id === id);
    setFromId(id);
    // The pair must read forward: if To is no newer than the new From, step To to the version after it.
    if (options.findIndex((o) => o.id === toId) >= index) setToId(options[index - 1].id);
  }

  return (
    <>
      <div className={CONTROLS}>
        <span id={fromLabel} className="shrink-0 text-[13px] text-text-muted">
          From
        </span>
        <VersionSelect triggerRef={fromTrigger} labelId={fromLabel} value={fromId} options={fromOptions} onChange={pickFrom} />
        <ArrowRight aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-text-subtle" />
        <span id={toLabel} className="shrink-0 text-[13px] text-text-muted">
          To
        </span>
        <VersionSelect labelId={toLabel} value={toId} options={toOptions} onChange={setToId} />
        <div className="ml-auto flex min-w-0 items-center gap-4">
          {redline ? (
            <span data-slot="redline-summary" title={summary} className="min-w-0 truncate text-[13px] text-text-muted">
              {summary}
            </span>
          ) : null}
          <div className="flex shrink-0 items-center gap-2">
            <Switch id={switchId} checked={changesOnly} onCheckedChange={setChangesOnly} />
            <Label htmlFor={switchId} className="text-[13px] font-normal whitespace-nowrap text-text">
              Changes only
            </Label>
          </div>
        </div>
      </div>

      <div data-slot="compare-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 pt-6 pb-10">
        {redline ? (
          <>
            {rename ? (
              <div className="mx-auto mb-6 flex max-w-(--doc-width) flex-col gap-1">
                <h3 className="caps-label">Name</h3>
                <NameChangeLine change={rename} />
              </div>
            ) : null}
            <RedlineDocument doc={redline} variables={variables} changesOnly={changesOnly} className="[--ucomp-doc-gutter:3.5rem]" />
          </>
        ) : ready && !ready.ok ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-[14px] text-text-muted">
            <p>Couldn&apos;t load these versions.</p>
            <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : (
          <div aria-hidden className="mx-auto flex max-w-[47.5rem] flex-col gap-3 pt-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="mt-6 h-6 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        )}
      </div>
    </>
  );
}
