"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ApiChannel } from "@/contracts/api-v1";
import { cn } from "@/lib/utils";
import { getDeliveryView, saveMapping, sendToCustomers } from "@/simulator/actions";
import { simField } from "@/simulator/fields";
import { blockedSentence } from "@/simulator/mapping";
import type { SimBatch, SimFieldPath, SimMappingRow, SimOfferPage } from "@/simulator/types";
import { Mono, PageHeader, Pill, Strip } from "./bits";
import { CustomerDrawer, type ViewState } from "./customer-drawer";
import { dayLabel, linkStatus, resultsHeadline, upgradeLabel } from "./format";
import { NavButton } from "./nav-button";
import { NoticesPanel } from "./notices-panel";
import { PageScroll } from "./page-frame";
import { SendTab } from "./send-tab";
import { TemplateTab } from "./template-tab";
import { ValuesTab } from "./values-tab";

export type OfferTab = "template" | "values" | "send";

const TABS: { id: OfferTab; label: string }[] = [
  { id: "template", label: "Template" },
  { id: "values", label: "Values" },
  { id: "send", label: "Send" },
];

/**
 * One offer, one page: Template | Values | Send. The mapping rows are optimistic (each change saves at once),
 * Send reads the same rows to know what is still unmapped, and the customer drawer sits beside the page.
 */
export function OfferView({ page, defaultTab, offerNames }: { page: SimOfferPage; defaultTab: OfferTab; offerNames: Record<string, string> }) {
  const { offer, link, upgrade } = page;
  // The tab lives in the URL (?tab=), so a link to "Send" opens on Send even when this page is kept alive
  // from an earlier visit. Switching rewrites the URL in place: no request, no history entry.
  const param = useSearchParams().get("tab");
  const tab: OfferTab = TABS.find((t) => t.id === param)?.id ?? defaultTab;
  const setTab = (next: OfferTab) => window.history.replaceState(null, "", `?tab=${next}`);

  // ── Mapping ────────────────────────────────────────────────────────────────
  const [rows, setRow] = useOptimistic(link?.mapping ?? [], (current: SimMappingRow[], update: { key: string; field: SimFieldPath | null }) =>
    current.map((r) => (r.key === update.key ? { ...r, field: update.field, fieldLabel: simField(update.field)?.label ?? null } : r)),
  );
  const [mapError, setMapError] = useState<{ key: string; reason: string } | null>(null);
  const [, startMap] = useTransition();
  const sentence = blockedSentence(rows.filter((r) => r.required && !r.field));
  const changeMapping = (key: string, field: SimFieldPath | null) =>
    startMap(async () => {
      setRow({ key, field });
      const result = await saveMapping({ offerId: offer.id, mapping: { [key]: field } });
      setMapError(result.ok ? null : { key, reason: result.reason });
    });

  // ── Send ───────────────────────────────────────────────────────────────────
  // The picker starts empty on each visit: the selection is keyed on the router's visit id (bfcacheId),
  // which changes on every fresh Link/push navigation to this page but not on refresh(), a ?tab= switch
  // or browser back/forward. A kept-alive page from an earlier visit so never shows its old ticks.
  const { bfcacheId } = useRouter();
  const [picked, setPicked] = useState<{ visit: string; ids: string[] }>({ visit: bfcacheId, ids: [] });
  const selected = picked.visit === bfcacheId ? picked.ids : [];
  const setSelected = (ids: string[]) => setPicked({ visit: bfcacheId, ids });
  const [sent, setSent] = useState<SimBatch | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const batch = sent ?? page.lastBatch;
  const send = () =>
    startSend(async () => {
      const result = await sendToCustomers({ offerId: offer.id, customerIds: selected });
      if (result.ok) {
        setSent(result.batch);
        setSendError(null);
        setViewing(null);
      } else setSendError(result.reason);
    });

  // A finished send brings its results into view: they sit below the picker, often under the fold, and a
  // failing send would otherwise look like nothing happened.
  useEffect(() => {
    if (!sent) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("results-panel")?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [sent]);

  // ── Customer drawer ────────────────────────────────────────────────────────
  const [viewing, setViewing] = useState<{ customerId: string; channel: ApiChannel } | null>(null);
  const [views, setViews] = useState<Record<string, ViewState>>({});
  const trigger = useRef<HTMLElement | null>(null);

  const ensureView = (deliveryId: string) => {
    if (views[deliveryId]?.status === "ready") return;
    setViews((v) => ({ ...v, [deliveryId]: { status: "loading" } }));
    void getDeliveryView({ deliveryId }).then((r) => setViews((v) => ({ ...v, [deliveryId]: r.ok ? { status: "ready", view: r.view } : { status: "error", reason: r.reason } })));
  };
  const openView = (customerId: string, channel: ApiChannel) => {
    if (!viewing) trigger.current = document.activeElement as HTMLElement | null;
    setViewing({ customerId, channel });
    const delivery = batch?.rows.find((r) => r.customerId === customerId)?.results.find((r) => r.channel === channel);
    if (delivery) ensureView(delivery.deliveryId);
  };
  const closeView = () => {
    setViewing(null);
    trigger.current?.focus();
  };
  const viewRow = viewing ? batch?.rows.find((r) => r.customerId === viewing.customerId) : undefined;

  // ── Header and strips ──────────────────────────────────────────────────────
  const status = linkStatus(link);
  const relinkHref = link ? (`/sim/offers/${offer.id}/link?template=${encodeURIComponent(link.templateId)}` as Route) : null;
  const changeHref = `/sim/offers/${offer.id}/link` as Route;
  const relinkAction = upgrade && relinkHref ? (
    <NavButton href={relinkHref} className="h-7 text-(--sim-text)">
      Relink to v{upgrade.toVersion}
    </NavButton>
  ) : link ? (
    <NavButton href={changeHref} className="h-7 text-(--sim-text)">
      Change template
    </NavButton>
  ) : null;

  let strip: React.ReactNode = null;
  if (link && status.failing) {
    const what =
      link.pinnedState === "revoked" || link.revokedAt
        ? `v${link.pinnedVersion} was revoked${link.revokedAt ? ` on ${dayLabel(link.revokedAt)}` : ""}.`
        : `v${link.pinnedVersion} stopped rendering${link.sunsetAt ? ` on ${dayLabel(link.sunsetAt)}` : ""}.`;
    strip = (
      <Strip tone="bad" action={relinkAction}>
        <strong className="font-semibold">A send now fails. </strong>
        {what}
      </Strip>
    );
  } else if (upgrade && link) {
    const needs = upgrade.diff.newRequired;
    strip = (
      <Strip tone="info" action={relinkAction}>
        UCOMP released v{upgrade.toVersion}.{" "}
        {needs.length > 0 ? (
          <>
            It needs {needs.map((k, i) => (
              <span key={k}>
                {i > 0 ? (i === needs.length - 1 ? " and " : ", ") : ""}
                <Mono className="text-(--sim-info)">{k}</Mono>
              </span>
            ))}{" "}
            mapped.
          </>
        ) : (
          "Nothing new to map."
        )}
        {link.sunsetAt && !link.sunsetPassed ? ` v${link.pinnedVersion} stops rendering ${dayLabel(link.sunsetAt)}.` : null}
      </Strip>
    );
  }

  return (
    <>
      <PageScroll>
        <PageHeader
          crumbs={
            <>
              <Link href={"/sim" as Route} className="text-(--sim-muted) no-underline hover:underline">
                Offers
              </Link>
              {"  /  "}
              {offer.name}
            </>
          }
          title={offer.name}
          right={
            <span className="flex items-center gap-1.5">
              {link ? <Pill tone={status.tone === "ok" ? "ok" : "plain"}>Pinned to v{link.pinnedVersion}</Pill> : null}
              {!link || status.label !== "Live" ? <Pill tone={status.tone}>{status.label}</Pill> : null}
              {upgrade ? <Pill tone="info">{upgradeLabel(upgrade)}</Pill> : null}
            </span>
          }
        />
        {page.apiError ? <Strip tone="bad">{page.apiError.message}</Strip> : null}
        {strip}

        <div
          role="tablist"
          aria-label="Offer"
          className="flex gap-6 border-b border-(--sim-line)"
          onKeyDown={(e) => {
            // From the focused tab (not the selected one), and Home / End jump to the ends.
            const at = TABS.findIndex((t) => `tab-${t.id}` === (e.target as HTMLElement).id);
            if (at < 0) return;
            const index = e.key === "ArrowRight" ? (at + 1) % TABS.length : e.key === "ArrowLeft" ? (at - 1 + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
            if (index < 0) return;
            e.preventDefault();
            setTab(TABS[index].id);
            document.getElementById(`tab-${TABS[index].id}`)?.focus();
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px h-10 border-b-2 text-[13px] font-medium",
                tab === t.id ? "border-(--sim-accent) text-(--sim-text)" : "border-transparent text-(--sim-muted) hover:text-(--sim-text)",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex min-h-[20rem] flex-col gap-5">
          {tab === "template" ? (
            <>
              <TemplateTab page={page} />
              {page.notices.length > 0 ? <NoticesPanel notices={page.notices} offerNames={offerNames} /> : null}
            </>
          ) : !link ? (
            <div className="flex items-center justify-between gap-4 rounded-md border border-(--sim-line) bg-(--sim-panel) p-4">
              <span className="text-[13px] text-(--sim-muted)">Link a template first.</span>
              <NavButton href={changeHref}>Link template</NavButton>
            </div>
          ) : tab === "values" ? (
            <ValuesTab rows={rows} templateId={link.templateId} version={link.pinnedVersion} sentence={sentence} error={mapError} onChange={changeMapping} />
          ) : (
            <SendTab
              link={link}
              customers={page.customers}
              selected={selected}
              onSelect={setSelected}
              sentence={sentence}
              sending={sending}
              sendError={sendError}
              onSend={send}
              batch={batch}
              outcome={sent ? resultsHeadline(sent.counts) : null}
              onView={openView}
              viewing={viewing}
              onMapValues={() => setTab("values")}
            />
          )}
        </div>
      </PageScroll>
      {viewing && viewRow ? (
        <CustomerDrawer
          customerName={viewRow.customerName}
          results={viewRow.results}
          channel={viewing.channel}
          views={views}
          onChannel={(c) => openView(viewing.customerId, c)}
          onClose={closeView}
        />
      ) : null}
    </>
  );
}
