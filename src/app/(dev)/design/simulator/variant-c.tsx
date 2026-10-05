"use client";

import type { CSSProperties } from "react";
import { AlertTriangle, ArrowRight, Check as CheckIcon, ChevronDown, ChevronRight, FileText, Search, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CHANNEL_CHOICES,
  CUSTOMERS,
  FIELD_OPTIONS,
  FOUND,
  NEW_VARIABLE,
  NOTICES,
  OFFERS,
  SPRING_ID,
  fullName,
  linkStatus,
  offerStatus,
  pinnedLabel,
  type Channel,
} from "./data";
import { Btn, Dot, FieldSelect, Mono, Pill, Seg } from "./bits";
import { CustomerView } from "./customer-views";
import type { Sim } from "./use-sim";

/*
 * C: Split-pane workbench. Dark graphite, mono labels, lime accent. Offers on the left, the run sheet
 * in the middle (template, values and send are one scrolling sheet), and the customer's view always
 * on the right, so every change shows its effect without a page change.
 */

const VARS = {
  "--s-bg": "#0c0f13",
  "--s-panel": "#131820",
  "--s-panel2": "#1a202a",
  "--s-line": "#262e3a",
  "--s-text": "#e7ecf3",
  "--s-muted": "#8a95a6",
  "--s-accent": "#c8f04a",
  "--s-accent-text": "#10140a",
  "--s-ok": "#58d68d",
  "--s-ok-bg": "#143323",
  "--s-bad": "#ff7b72",
  "--s-bad-bg": "#3b1a1c",
  "--s-warn": "#f2c14e",
  "--s-warn-bg": "#372b10",
  "--s-info": "#82aaff",
  "--s-info-bg": "#172444",
  "--s-rs": "4px",
  "--s-rb": "6px",
  "--s-font": 'system-ui, -apple-system, "SF Pro Text", sans-serif',
  "--s-mono": '"SF Mono", Menlo, ui-monospace, monospace',
} as CSSProperties;

const LABEL = "font-(family-name:--s-mono) text-[11px] tracking-wider text-(--s-muted) uppercase";

function Step({ n, title, summary, open, onToggle, children, state }: { n: number; title: string; summary: string; open: boolean; onToggle: () => void; children: React.ReactNode; state?: "done" | "todo" | "blocked" }) {
  return (
    <section className={cn("rounded-lg border bg-(--s-panel)", open ? "border-(--s-line)" : "border-(--s-line)/70")}>
      <button type="button" onClick={onToggle} className="flex h-12 w-full cursor-pointer items-center gap-3 px-4 text-left">
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-full font-(family-name:--s-mono) text-[11px]", state === "done" ? "bg-(--s-ok-bg) text-(--s-ok)" : state === "blocked" ? "bg-(--s-bad-bg) text-(--s-bad)" : "bg-(--s-panel2) text-(--s-muted)")}>
          {state === "done" ? <CheckIcon className="size-3" strokeWidth={3} /> : n}
        </span>
        <span className="text-[14px] font-medium">{title}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-(--s-muted)">{open ? "" : summary}</span>
        {open ? <ChevronDown className="size-4 text-(--s-muted)" /> : <ChevronRight className="size-4 text-(--s-muted)" />}
      </button>
      {open ? <div className="border-t border-(--s-line) p-4">{children}</div> : null}
    </section>
  );
}

function LeftPane({ s }: { s: Sim }) {
  const notices = s.screen === "notices";
  return (
    <aside className="flex w-[17.5rem] shrink-0 flex-col border-r border-(--s-line) bg-(--s-panel)">
      <div className="flex h-12 items-center gap-2 border-b border-(--s-line) px-4">
        <span className="font-(family-name:--s-mono) text-[15px] font-semibold tracking-tight text-(--s-accent)">coral/</span>
        <span className="font-(family-name:--s-mono) text-[13px] text-(--s-muted)">workbench</span>
      </div>
      <div className="flex border-b border-(--s-line) px-2">
        {[{ l: "Offers", on: !notices, go: () => s.setScreen("offers") }, { l: "Notices", on: notices, go: () => s.setScreen("notices"), n: 2 }].map((t) => (
          <button key={t.l} type="button" onClick={t.go} className={cn("-mb-px flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 border-b-2 text-[13px]", t.on ? "border-(--s-accent) text-(--s-text)" : "border-transparent text-(--s-muted)")}>
            {t.l}
            {t.n ? <span className="rounded-full bg-(--s-accent) px-1.5 text-[10px] font-semibold text-(--s-accent-text)">{t.n}</span> : null}
          </button>
        ))}
      </div>
      {notices ? (
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-2">
          {NOTICES.map((n, i) => (
            <li key={n.id}>
              <button type="button" onClick={() => s.setScreen("notices")} className={cn("flex w-full cursor-pointer flex-col gap-1 rounded-lg px-3 py-2.5 text-left", i === 0 ? "bg-(--s-panel2)" : "hover:bg-(--s-panel2)/60")}>
                <span className="flex items-center gap-2 text-[13px] font-medium">{n.unread ? <Dot tone="warn" /> : null}<span className="truncate">{n.title}</span></span>
                <span className="text-[12px] text-(--s-muted)">{n.offer} · {n.at}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-2">
          {OFFERS.map((o) => {
            const st = offerStatus(o, s.scenario);
            const on = o.id === SPRING_ID;
            return (
              <li key={o.id}>
                <button type="button" onClick={() => s.setScreen(on ? "send" : "map")} className={cn("flex w-full cursor-pointer flex-col gap-1.5 rounded-lg px-3 py-3 text-left", on ? "bg-(--s-panel2)" : "hover:bg-(--s-panel2)/60")}>
                  <span className="text-[13px] font-medium">{o.name}</span>
                  <span className="flex items-center gap-2"><Pill tone={st.tone}>{st.label}</Pill><Mono className="text-(--s-muted)">{pinnedLabel(o)}</Mono></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-t border-(--s-line) p-4 text-[12px] text-(--s-muted)"><span className="text-(--s-text)">Dana Whitfield</span> · Offers ops</div>
    </aside>
  );
}

function Middle({ s }: { s: Sim }) {
  const st = linkStatus(s.scenario);
  const open = s.screen === "link" ? 1 : s.screen === "map" ? 2 : s.screen === "send" || s.screen === "customer" ? 3 : 0;
  const found = FOUND.find((f) => f.id === s.picked);
  const blocked = s.unmapped.length > 0;
  const delivered = s.results.filter((r) => r.status === "delivered").length;
  const failed = s.results.length - delivered;
  const toggle = (id: string) => s.setSelected(s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id]);
  const go = (n: 1 | 2 | 3) => s.setScreen(n === 1 ? "link" : n === 2 ? "map" : "send");

  if (s.screen === "notices") {
    const n = NOTICES[0];
    return (
      <div className="mx-auto flex max-w-[40rem] flex-col gap-5">
        <div><p className={LABEL}>Notice · {n.at}</p><h1 className="m-0 mt-1 text-[22px] font-semibold tracking-tight">{n.title}</h1></div>
        <p className="m-0 text-[14px] leading-6 text-(--s-muted)">{n.body}</p>
        <div className="flex gap-2"><Btn kind="primary" onClick={() => s.setScreen("relink")}>Relink to v3 <ArrowRight className="size-3.5" /></Btn><Btn>Not now</Btn></div>
        <div className="rounded-lg border border-(--s-line) bg-(--s-panel) p-4">
          <p className={LABEL}>Also from UCOMP</p>
          <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
            {NOTICES.slice(1).map((x) => (
              <li key={x.id} className="flex items-start gap-3 text-[13px]"><Dot tone={x.kind === "revoked" ? "bad" : x.kind === "sunset" ? "warn" : "ok"} /><span className="min-w-0 flex-1"><span className="block font-medium">{x.title}</span><span className="block text-(--s-muted)">{x.body}</span></span></li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (s.screen === "relink") {
    const needs = !s.feeField;
    return (
      <div className="mx-auto flex max-w-[40rem] flex-col gap-4">
        <div><p className={LABEL}>Relink · Spring Travel Rewards</p><h1 className="m-0 mt-1 text-[22px] font-semibold tracking-tight">Move from v2 to v3</h1></div>
        <section className="rounded-lg border border-(--s-line) bg-(--s-panel) p-4">
          <p className={LABEL}>Contract diff</p>
          <pre className="m-0 mt-3 overflow-x-auto font-(family-name:--s-mono) text-[12px] leading-6">
            <span className="text-(--s-muted)">  first_name, last_name, purchase_apr, home_state{"\n"}</span>
            <span className="text-(--s-muted)">  offer_end_date  (optional){"\n"}</span>
            <span className="text-(--s-ok)">+ annual_fee      Currency · required</span>
          </pre>
        </section>
        <section className="rounded-lg border border-(--s-line) bg-(--s-panel) p-4">
          <p className={LABEL}>Map the new value</p>
          <div className="mt-3 flex items-center gap-4"><Mono className="w-28 text-(--s-text)">{NEW_VARIABLE.key}</Mono><FieldSelect label="Field for annual_fee" value={s.feeField} invalid={needs} options={FIELD_OPTIONS} onChange={s.setFeeField} /></div>
        </section>
        <div className="flex items-center justify-between">
          <span className={cn("text-[13px]", needs ? "text-(--s-bad)" : "text-(--s-ok)")}>{needs ? "Map annual_fee to relink." : "Ready to relink."}</span>
          <Btn kind="primary" disabled={needs} onClick={() => { s.setRelinked(true); s.setSent(false); s.setScreen("send"); }}>Relink to v3</Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[40rem] flex-col gap-3">
      <div className="mb-2 flex items-end justify-between">
        <div><p className={LABEL}>Offer</p><h1 className="m-0 mt-1 text-[22px] font-semibold tracking-tight">Spring Travel Rewards</h1></div>
        <Pill tone={s.relinked ? "ok" : st.tone}>{s.relinked ? "Pinned to v3" : st.label}</Pill>
      </div>
      {s.scenario !== "live" && !s.relinked ? (
        <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-[13px]", st.tone === "bad" ? "border-(--s-bad)/40 bg-(--s-bad-bg) text-(--s-bad)" : "border-(--s-info)/40 bg-(--s-info-bg) text-(--s-info)")}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
          <span className="min-w-0 flex-1">{st.detail}</span>
          <Btn kind="secondary" className="h-7 border-current text-current" onClick={() => s.setScreen("relink")}>Relink</Btn>
        </div>
      ) : null}
      <Step n={1} title="Template" state="done" summary={`Spring Travel Rewards — Terms · UC-7H2M9X · v${s.pinned}`} open={open === 1} onToggle={() => go(1)}>
        <div className="flex h-9 items-center gap-2 rounded-md border border-(--s-line) bg-(--s-panel2) px-3 text-[13px]"><Search className="size-4 text-(--s-muted)" strokeWidth={1.75} />spring</div>
        <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
          {FOUND.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => s.setPicked(f.id)} className={cn("flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-left", s.picked === f.id ? "border-(--s-accent)" : "border-(--s-line) hover:bg-(--s-panel2)")}>
                <FileText className="size-4 text-(--s-muted)" strokeWidth={1.75} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{f.name}</span><Mono className="text-(--s-muted)">{f.id}</Mono></span>
                <Pill tone="ok">Active v{f.activeVersion}</Pill>
              </button>
            </li>
          ))}
        </ul>
        {found ? (
          <div className="mt-3 flex items-center justify-between">
            <Seg label="Pinned version" value={String(s.pin) as "1" | "2"} onChange={(v) => s.setPin(v === "1" ? 1 : 2)} options={[{ value: "2", label: "v2 Active" }, ...found.older.map((o) => ({ value: String(o.version), label: `v${o.version} sunset ${o.sunset}` }))]} />
            <Btn kind="primary" onClick={() => s.setScreen("map")}>Pin v{s.pin}</Btn>
          </div>
        ) : null}
      </Step>
      <Step n={2} title="Values" state={blocked ? "blocked" : "done"} summary={blocked ? `${s.unmapped.map((v) => v.key).join(", ")} unmapped` : "5 of 5 mapped"} open={open === 2} onToggle={() => go(2)}>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {s.variables.map((v) => (
            <li key={v.key} className="flex items-center gap-3">
              <Mono className="w-32 text-(--s-text)">{v.key}</Mono>
              <ArrowRight className="size-3.5 text-(--s-muted)" />
              <FieldSelect label={`Field for ${v.key}`} value={v.mapped} invalid={v.required && !v.mapped} options={FIELD_OPTIONS} onChange={(val) => s.setMapping({ ...s.mapping, [v.key]: val })} />
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between">
          <span className={cn("text-[13px]", blocked ? "text-(--s-bad)" : "text-(--s-ok)")}>{blocked ? `Map ${s.unmapped.map((v) => v.key).join(", ")} to send.` : "All required values mapped."}</span>
          <Btn kind="primary" disabled={blocked} onClick={() => s.setScreen("send")}>Continue</Btn>
        </div>
      </Step>
      <Step n={3} title="Send" state={s.sent ? (failed ? "blocked" : "done") : "todo"} summary={s.sent ? `${delivered} delivered, ${failed} failed` : "Not sent"} open={open === 3} onToggle={() => go(3)}>
        <div className="flex flex-wrap gap-1.5">
          {CUSTOMERS.slice(0, 6).map((c) => (
            <button key={c.id} type="button" aria-pressed={s.selected.includes(c.id)} onClick={() => toggle(c.id)} className={cn("flex h-7 max-w-[11rem] cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px]", s.selected.includes(c.id) ? "border-(--s-accent) text-(--s-text)" : "border-(--s-line) text-(--s-muted)")}>
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", s.selected.includes(c.id) ? "bg-(--s-accent)" : "bg-(--s-line)")} /><span className="truncate">{fullName(c)}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <Seg label="Channel" value={s.channel} onChange={(v) => s.setChannel(v as Channel)} options={CHANNEL_CHOICES.map((c) => ({ value: c, label: c }))} />
          <Btn kind="primary" onClick={() => s.setSent(true)}><Send className="size-3.5" strokeWidth={2} />Send to {s.selected.length}</Btn>
        </div>
        {s.sent ? (
          <table className="mt-4 w-full border-collapse text-[13px]">
            <thead><tr className="border-b border-(--s-line)"><th className={cn(LABEL, "h-8 text-left font-normal")}>Customer</th><th className={cn(LABEL, "text-left font-normal")}>Status</th></tr></thead>
            <tbody>
              {s.results.map((r) => (
                <tr key={r.customer.id} onClick={() => { s.setViewing(r.customer.id); s.setScreen("customer"); }} className={cn("cursor-pointer border-b border-(--s-line)/60 last:border-0 hover:bg-(--s-panel2)", s.viewing === r.customer.id && "bg-(--s-panel2)")}>
                  <td className="max-w-[12rem] truncate py-2 pr-3">{fullName(r.customer)}</td>
                  <td className="py-2">{r.status === "delivered" ? <Pill tone="ok">Delivered (mock)</Pill> : <span className="flex flex-col gap-1"><Pill tone="bad" className="w-fit">Failed</Pill><Mono className="text-(--s-bad)">{r.error}</Mono></span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Step>
    </div>
  );
}

function Right({ s }: { s: Sim }) {
  const c = CUSTOMERS.find((x) => x.id === s.viewing) ?? CUSTOMERS[0];
  const r = s.results.find((x) => x.customer.id === c.id);
  const failedHere = s.sent && r?.status === "failed";
  return (
    <aside className="flex w-[25rem] shrink-0 flex-col border-l border-(--s-line) bg-(--s-panel)">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-(--s-line) px-4">
        <div className="min-w-0"><p className={LABEL}>Customer view</p><p className="m-0 truncate text-[13px] font-medium">{fullName(c)}</p></div>
        <Seg label="Customer view" value={s.view} onChange={s.setView} options={[{ value: "phone", label: "App" }, { value: "inbox", label: "Email" }, { value: "pdf", label: "PDF" }]} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#0a0c10] p-4">
        {failedHere ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center"><X className="size-6 text-(--s-bad)" /><p className="m-0 text-[13px] font-medium">Nothing was delivered</p><Mono className="text-(--s-bad)">{r?.error}</Mono></div>
        ) : (
          <CustomerView mode={s.view} c={c} version={s.relinked || s.screen === "relink" ? 3 : 2} narrow accent />
        )}
      </div>
      <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-t border-(--s-line) px-3">
        {CUSTOMERS.slice(0, 5).map((x) => (
          <button key={x.id} type="button" onClick={() => s.setViewing(x.id)} className={cn("h-7 max-w-[5.5rem] shrink-0 cursor-pointer truncate rounded-full px-2.5 text-[12px]", x.id === c.id ? "bg-(--s-panel2) text-(--s-text)" : "text-(--s-muted) hover:text-(--s-text)")}>{x.first.split("-")[0]}</button>
        ))}
      </div>
    </aside>
  );
}

export function VariantC({ s }: { s: Sim }) {
  return (
    <div style={{ ...VARS, fontFamily: "var(--s-font)" }} className="flex h-full min-h-0 bg-(--s-bg) text-(--s-text)">
      <LeftPane s={s} />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-8 pb-14">
        <Middle s={s} />
      </main>
      <Right s={s} />
    </div>
  );
}
