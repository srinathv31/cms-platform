"use client";

import { useEffect, useState, useTransition } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { ApiChannel, ApiContractChange, ApiTemplateSummary } from "@/contracts/api-v1";
import { cn } from "@/lib/utils";
import { linkTemplate, searchTemplates } from "@/simulator/actions";
import { simField } from "@/simulator/fields";
import { blockedSentence } from "@/simulator/mapping";
import type { SimFieldPath, SimLinkFlow, SimMappingRow } from "@/simulator/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Btn, Mono, PageHeader, Panel, Pill, Strip, TD, btnClass, type Tone } from "./bits";
import { channelList, CHANNEL_LABEL, dayLabel, withKeys } from "./format";
import { MappingTable } from "./mapping-table";
import { PageScroll } from "./page-frame";

const KIND: Record<ApiContractChange["kind"], { label: string; tone: Tone }> = {
  added: { label: "Added", tone: "ok" },
  removed: { label: "Removed", tone: "bad" },
  key_renamed: { label: "Renamed", tone: "warn" },
  type_changed: { label: "Type changed", tone: "warn" },
  made_required: { label: "Now required", tone: "warn" },
  made_optional: { label: "Now optional", tone: "plain" },
  label_changed: { label: "Label changed", tone: "plain" },
};

const ALL_CHANNELS: ApiChannel[] = ["pdf", "web", "email"];

function Step({ n, title, right, children }: { n: number; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Panel title={`${n} · ${title}`} right={right}>
      {children}
    </Panel>
  );
}

/**
 * Link / relink. Search, then the chosen template at its Active version. Linking again to a newer version
 * of the same template opens with the consequences first: What changed, Map new value, Confirm.
 */
export function LinkFlow({ flow }: { flow: SimLinkFlow }) {
  const { offer, current, candidate } = flow;
  const router = useRouter();
  const base = `/sim/offers/${offer.id}`;

  // ── Search ─────────────────────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ApiTemplateSummary[] | null>(null);
  // The query the shown results answer: while it trails the field, a newer search is on its way and the
  // list may still reorder, so it says it is busy.
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searching = !candidate;
  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        const result = await searchTemplates({ q });
        if (cancelled) return;
        setResultsFor(q);
        if (result.ok) {
          setResults(result.results);
          setSearchError(null);
        } else setSearchError(result.reason);
      },
      q ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, searching]);

  // ── The chosen template ────────────────────────────────────────────────────
  const contractChannels = candidate?.template.contract?.channels ?? [];
  const [channels, setChannels] = useState<ApiChannel[]>(() => {
    const kept = current ? current.channels.filter((c) => contractChannels.includes(c)) : [];
    return kept.length > 0 ? kept : contractChannels;
  });
  const [mapping, setMapping] = useState<Record<string, SimFieldPath | null>>(() => ({ ...(candidate?.mapping ?? {}) }));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const variables = candidate?.variables ?? [];
  const relinking = Boolean(candidate && current && candidate.template.id === current.templateId && candidate.diff);
  const diff = candidate?.diff ?? null;
  const missing = variables.filter((v) => v.required && !mapping[v.key]);
  const sentence = blockedSentence(missing);
  const sameVersion = Boolean(candidate && current && current.templateId === candidate.template.id && current.pinnedVersion === candidate.version);

  const touched = new Set(diff ? [...diff.items.map((i) => i.key), ...diff.newRequired] : []);
  const shown = variables.filter((v) => (relinking ? touched.has(v.key) || (v.required && !mapping[v.key]) : true));
  const rows: SimMappingRow[] = shown.map((v) => {
    const field = simField(mapping[v.key] ?? null);
    return { key: v.key, label: v.label, type: v.type, required: v.required, field: field?.path ?? null, fieldLabel: field?.label ?? null };
  });
  const unchanged = variables.filter((v) => !shown.includes(v));

  const confirm = () =>
    startTransition(async () => {
      if (!candidate) return;
      const result = await linkTemplate({ offerId: offer.id, templateId: candidate.template.id, version: candidate.version, channels, mapping });
      if (!result.ok) return setError(result.reason);
      router.push(`${base}?tab=${missing.length > 0 ? "values" : "send"}` as Route);
    });

  const toggleChannel = (c: ApiChannel) => setChannels((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : ALL_CHANNELS.filter((x) => x === c || cur.includes(x))));

  const title = relinking && candidate ? `Relink to v${candidate.version}` : "Link template";
  // The consequence, before the commitment: which version sends use from now on, and what happens to the old one.
  const stops =
    current && candidate && !sameVersion && current.sunsetAt && !current.sunsetPassed && !current.revokedAt
      ? ` v${current.pinnedVersion} stops rendering ${dayLabel(current.sunsetAt)}.`
      : "";
  const consequence = candidate && channels.length > 0 && !sameVersion ? `Sends use v${candidate.version} on ${channelList(channels)}.${stops}` : "";
  const blocker = sameVersion ? `Already linked to v${candidate?.version}.` : channels.length === 0 && candidate ? "Choose at least one channel." : "";

  return (
    <PageScroll>
      <PageHeader
        crumbs={
          <>
            <Link href={"/sim" as Route} className="text-(--sim-muted) no-underline hover:underline">
              Offers
            </Link>
            {"  /  "}
            <Link href={base as Route} className="text-(--sim-muted) no-underline hover:underline">
              {offer.name}
            </Link>
            {"  /  "}
            {relinking ? "Relink" : "Link template"}
          </>
        }
        title={relinking && candidate ? `Relink to v${candidate.version}` : "Link a template"}
      />
      {flow.apiError ? <Strip tone="bad">{flow.apiError.message}</Strip> : null}

      <div className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-5">
        <div className="flex min-w-0 flex-col gap-5">
          {!candidate ? (
            <Step n={1} title="Find a template">
              <div className="flex flex-col gap-3 p-4">
                <label className="flex h-9 items-center gap-2 rounded-(--sim-rb) border border-(--sim-line) bg-(--sim-panel2) px-3 text-[13px] focus-within:border-(--sim-info)">
                  <Search aria-hidden className="size-4 shrink-0 text-(--sim-muted)" strokeWidth={1.75} />
                  <input
                    type="search"
                    aria-label="Search templates"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent outline-none"
                  />
                </label>
                {searchError ? (
                  <p role="alert" className="m-0 text-[13px] text-(--sim-bad)">
                    {searchError}
                  </p>
                ) : null}
                <ul aria-label="Templates" aria-busy={resultsFor !== q} className="m-0 h-[19rem] list-none divide-y divide-(--sim-line) overflow-y-auto overscroll-contain rounded-(--sim-rb) border border-(--sim-line) p-0">
                  {results === null ? (
                    Array.from({ length: 5 }, (_, i) => (
                      <li key={i} aria-hidden className="flex h-[3.75rem] items-center px-3">
                        <Skeleton className="h-4 w-1/2 bg-(--sim-line)" />
                      </li>
                    ))
                  ) : results.length === 0 ? (
                    <li className="px-3 py-3 text-[13px] text-(--sim-muted)">No Active template matches.</li>
                  ) : (
                    results.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => router.push(`${base}/link?template=${encodeURIComponent(t.id)}` as Route)}
                          className="flex h-[3.75rem] w-full items-center gap-3 px-3 text-left hover:bg-(--sim-panel2)"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{t.name}</span>
                            <span className="block truncate text-[12px] text-(--sim-muted)">
                              <Mono>{t.id}</Mono> · {t.team.name} · {channelList(t.channels)}
                            </span>
                          </span>
                          <Pill tone="ok">Active v{t.activeVersion}</Pill>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </Step>
          ) : (
            <>
              {relinking && diff ? (
                <Step n={1} title="What changed" right={<Mono className="text-(--sim-muted)">v{diff.since} to v{diff.to}</Mono>}>
                  <table aria-label="Changes" className="w-full border-collapse">
                    <tbody>
                      {diff.items.map((item, i) => (
                        <tr key={i} className="border-b border-(--sim-line)">
                          <td className={cn(TD, "w-36")}>
                            <Pill tone={KIND[item.kind].tone}>{KIND[item.kind].label}</Pill>
                          </td>
                          <td className={cn(TD, "w-44")}>
                            <Mono className="text-(--sim-text)">{item.key}</Mono>
                          </td>
                          <td className={cn(TD, "text-(--sim-muted)")}>{withKeys(item.text)}</td>
                        </tr>
                      ))}
                      {unchanged.length > 0 ? (
                        <tr>
                          <td className={cn(TD, "w-36")}>
                            <Pill>Same</Pill>
                          </td>
                          <td className={TD} colSpan={2}>
                            <Mono className="text-(--sim-text)">{unchanged.map((v) => v.key).join(", ")}</Mono>
                            <span className="text-(--sim-muted)"> · mapping kept</span>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </Step>
              ) : (
                <Step
                  n={1}
                  title="Template"
                  right={
                    <Link href={`${base}/link` as Route} className={btnClass("ghost", "h-7")}>
                      Choose another
                    </Link>
                  }
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{candidate.template.name}</span>
                      <span className="block text-[12px] text-(--sim-muted)">
                        <Mono>{candidate.template.id}</Mono> · {candidate.template.team.name}
                      </span>
                    </span>
                    <Pill tone="ok">Active v{candidate.version}</Pill>
                  </div>
                </Step>
              )}

              {!relinking ? (
                <Step n={2} title="Version and channels">
                  <div className="flex flex-col gap-3 p-4 text-[13px]">
                    <div className="flex items-center gap-2">
                      <span className="w-20 text-(--sim-muted)">Version</span>
                      <Mono>v{candidate.version}</Mono>
                      <Pill tone="ok">Active</Pill>
                    </div>
                    <fieldset className="m-0 flex items-center gap-2 border-0 p-0">
                      <legend className="sr-only">Channels</legend>
                      <span aria-hidden className="w-20 text-(--sim-muted)">
                        Channels
                      </span>
                      {contractChannels.map((c) => (
                        <label key={c} className="flex h-8 cursor-pointer items-center gap-2 rounded-(--sim-rb) border border-(--sim-line) px-2.5 has-checked:border-(--sim-accent)">
                          <input type="checkbox" checked={channels.includes(c)} onChange={() => toggleChannel(c)} className="accent-(--sim-accent)" />
                          {CHANNEL_LABEL[c]}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                </Step>
              ) : null}

              {rows.length > 0 ? (
                <Step n={relinking ? 2 : 3} title={relinking ? "Map new value" : "Map values"}>
                  <MappingTable
                    rows={rows}
                    fields={flow.fields}
                    label={relinking ? "New values" : "Variables"}
                    onChange={(key, field) => {
                      setError(null);
                      setMapping((cur) => ({ ...cur, [key]: field }));
                    }}
                  />
                </Step>
              ) : null}
            </>
          )}
        </div>

        <Panel title={`${relinking ? 3 : candidate ? 4 : 2} · Confirm`}>
          <div className="flex flex-col gap-3 p-4 text-[13px]">
            <p className="m-0 flex justify-between gap-3">
              <span className="text-(--sim-muted)">From</span>
              {current ? (
                <span className="min-w-0 truncate">
                  {current.templateName} <Mono>· v{current.pinnedVersion}</Mono>
                </span>
              ) : (
                <span>Not linked</span>
              )}
            </p>
            <p className="m-0 flex justify-between gap-3">
              <span className="text-(--sim-muted)">To</span>
              {candidate ? (
                <span className="min-w-0 truncate">
                  {candidate.template.name} <Mono>· v{candidate.version}</Mono>
                </span>
              ) : (
                <span className="text-(--sim-muted)">Choose a template</span>
              )}
            </p>
            {consequence ? <p className="m-0 text-(--sim-muted)">{consequence}</p> : null}
            {candidate && sentence ? <p className="m-0 text-(--sim-warn)">{sentence}</p> : null}
            {blocker ? <p className="m-0 text-(--sim-bad)">{blocker}</p> : null}
            {error ? (
              <p role="alert" className="m-0 text-(--sim-bad)">
                {error}
              </p>
            ) : null}
            <Btn kind="primary" disabled={!candidate || pending || blocker !== ""} onClick={confirm}>
              {pending ? "Linking…" : title}
            </Btn>
          </div>
        </Panel>
      </div>
    </PageScroll>
  );
}
