"use client";

import type { CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Bell, Check as CheckIcon, FileText, Mail, Search, Send, Sparkles, X } from "lucide-react";
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
import { Btn, Check, FieldSelect, Mono, Pill, Seg } from "./bits";
import { CustomerView } from "./customer-views";
import type { Sim } from "./use-sim";

/*
 * B: Top-nav wizard. Bright and friendly: lilac field, white cards, pill buttons, a stepper.
 * Avenir, big corners, indigo. One question per step, like a campaign tool.
 */

const VARS = {
  "--s-bg": "#f4f2ff",
  "--s-panel": "#ffffff",
  "--s-panel2": "#f1effc",
  "--s-line": "#e2defa",
  "--s-text": "#1d1a3a",
  "--s-muted": "#6b6794",
  "--s-accent": "#4a3de0",
  "--s-accent-text": "#ffffff",
  "--s-ok": "#12805a",
  "--s-ok-bg": "#d9f5e9",
  "--s-bad": "#c8312f",
  "--s-bad-bg": "#fde7e6",
  "--s-warn": "#94590a",
  "--s-warn-bg": "#ffeccc",
  "--s-info": "#4a3de0",
  "--s-info-bg": "#e6e3ff",
  "--s-rs": "999px",
  "--s-rb": "999px",
  "--s-font": '"Avenir Next", Avenir, "Segoe UI", sans-serif',
  "--s-mono": '"SF Mono", Menlo, ui-monospace, monospace',
} as CSSProperties;

type Step = 1 | 2 | 3 | 4;
function stepOf(s: Sim): Step {
  if (s.screen === "link") return 1;
  if (s.screen === "map") return 2;
  if (s.screen === "send" && !s.sent) return 3;
  return 4;
}

function Stepper({ labels, current, onGo }: { labels: string[]; current: number; onGo: (i: number) => void }) {
  return (
    <ol className="m-0 flex list-none items-center justify-center gap-2 p-0">
      {labels.map((l, i) => {
        const n = i + 1;
        const done = n < current;
        const on = n === current;
        return (
          <li key={l} className="flex items-center gap-2">
            <button type="button" onClick={() => onGo(n)} className="flex cursor-pointer items-center gap-2">
              <span className={cn("grid size-7 place-items-center rounded-full text-[12px] font-semibold", on ? "bg-(--s-accent) text-white" : done ? "bg-(--s-ok-bg) text-(--s-ok)" : "bg-(--s-panel) text-(--s-muted) ring-1 ring-(--s-line)")}>
                {done ? <CheckIcon className="size-3.5" strokeWidth={2.5} /> : n}
              </span>
              <span className={cn("text-[13px]", on ? "font-semibold text-(--s-text)" : "text-(--s-muted)")}>{l}</span>
            </button>
            {n < labels.length ? <span className="mx-2 h-px w-10 bg-(--s-line)" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-[22px] border border-(--s-line) bg-(--s-panel) shadow-[0_18px_40px_-28px_rgb(74_61_224/0.5)]", className)}>{children}</section>;
}

function StepTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="m-0 text-[24px] leading-8 font-semibold tracking-tight text-(--s-text)">{title}</h2>
      {sub ? <p className="m-0 mt-1 text-[14px] text-(--s-muted)">{sub}</p> : null}
    </div>
  );
}

function OffersGrid({ s }: { s: Sim }) {
  return (
    <div className="mx-auto max-w-[62rem]">
      <div className="flex items-end justify-between">
        <h1 className="m-0 text-[30px] font-semibold tracking-tight">Your offers</h1>
        <Btn kind="primary" className="h-9 px-4">New offer</Btn>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-5">
        {OFFERS.map((o) => {
          const st = offerStatus(o, s.scenario);
          const spring = o.id === SPRING_ID;
          return (
            <Card key={o.id} className="flex flex-col p-6">
              <div className="flex items-start justify-between gap-3">
                <h3 className="m-0 text-[18px] font-semibold">{o.name}</h3>
                <Pill tone={st.tone} className="h-6 px-2.5 text-[12px]">{st.label}</Pill>
              </div>
              <p className="m-0 mt-1 text-[14px] text-(--s-muted)">{o.headline}</p>
              <div className="mt-4 flex items-center gap-2 rounded-2xl bg-(--s-panel2) px-3 py-2.5 text-[13px]">
                <FileText className="size-4 shrink-0 text-(--s-muted)" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">{o.templateName}</span>
                <Mono className="text-(--s-muted)">{pinnedLabel(o)}</Mono>
              </div>
              <div className="mt-5 flex items-center justify-between">
                <span className="text-[12px] text-(--s-muted)">{o.sends30.toLocaleString("en-US")} sends this month</span>
                <Btn kind="secondary" onClick={() => s.setScreen(spring ? "send" : "map")}>Open <ArrowRight className="size-3.5" /></Btn>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ScenarioStrip({ s }: { s: Sim }) {
  if (s.scenario === "live" || s.relinked) return null;
  const st = linkStatus(s.scenario);
  const bad = st.tone === "bad";
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl px-4 py-3 text-[13px]", bad ? "bg-(--s-bad-bg) text-(--s-bad)" : "bg-(--s-info-bg) text-(--s-info)")}>
      <Sparkles className="size-4 shrink-0" strokeWidth={2} />
      <span className="min-w-0 flex-1"><strong className="font-semibold">{bad ? "Sends are failing. " : "Version 3 is available. "}</strong>{st.detail}</span>
      <Btn kind="secondary" className="h-7 bg-white" onClick={() => s.setScreen("relink")}>Upgrade</Btn>
    </div>
  );
}

function StepLink({ s }: { s: Sim }) {
  const found = FOUND.find((f) => f.id === s.picked);
  return (
    <Card className="p-8">
      <StepTitle title="Which template explains this offer?" />
      <div className="mt-5 flex h-11 items-center gap-2 rounded-full border border-(--s-line) bg-(--s-panel2) px-4 text-[14px]"><Search className="size-4 text-(--s-muted)" strokeWidth={1.75} />spring travel</div>
      <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
        {FOUND.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => s.setPicked(f.id)} className={cn("flex w-full cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-left", s.picked === f.id ? "border-(--s-accent) bg-(--s-info-bg)" : "border-(--s-line) hover:bg-(--s-panel2)")}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{f.name}</span>
                <span className="block text-[12px] text-(--s-muted)"><Mono>{f.id}</Mono> · {f.team} · {f.channels.join(", ")}</span>
              </span>
              <Pill tone="ok" className="h-6 px-2.5 text-[12px]">Active v{f.activeVersion}</Pill>
            </button>
          </li>
        ))}
      </ul>
      {found ? (
        <div className="mt-6 flex items-center justify-between rounded-2xl bg-(--s-panel2) p-4">
          <Seg label="Pinned version" value={String(s.pin) as "1" | "2"} onChange={(v) => s.setPin(v === "1" ? 1 : 2)} options={[{ value: "2", label: "v2 · Active" }, ...found.older.map((o) => ({ value: String(o.version), label: `v${o.version} · sunset ${o.sunset}` }))]} />
          <Btn kind="primary" className="h-10 px-5" onClick={() => s.setScreen("map")}>Pin and continue</Btn>
        </div>
      ) : null}
    </Card>
  );
}

function StepMap({ s }: { s: Sim }) {
  const blocked = s.unmapped.length > 0;
  return (
    <Card className="p-8">
      <StepTitle title="Where does each value come from?" />
      <ul className="m-0 mt-5 flex list-none flex-col divide-y divide-(--s-line) p-0">
        {s.variables.map((v) => (
          <li key={v.key} className="flex items-center gap-4 py-3">
            <div className="w-56"><Mono className="text-[13px] text-(--s-text)">{v.key}</Mono><p className="m-0 text-[12px] text-(--s-muted)">{v.type}{v.required ? " · required" : " · optional"}</p></div>
            <ArrowRight className="size-4 text-(--s-muted)" strokeWidth={1.75} />
            <FieldSelect label={`Field for ${v.key}`} value={v.mapped} invalid={v.required && !v.mapped} options={FIELD_OPTIONS} onChange={(val) => s.setMapping({ ...s.mapping, [v.key]: val })} />
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-center justify-between">
        <Btn kind="ghost" onClick={() => s.setScreen("link")}><ArrowLeft className="size-3.5" />Back</Btn>
        <div className="flex items-center gap-4">
          {blocked ? <span className="text-[13px] text-(--s-bad)">Map {s.unmapped.map((v) => v.key).join(", ")} to continue.</span> : null}
          <Btn kind="primary" className="h-10 px-5" disabled={blocked} onClick={() => s.setScreen("send")}>Continue</Btn>
        </div>
      </div>
    </Card>
  );
}

function StepPick({ s }: { s: Sim }) {
  const toggle = (id: string) => s.setSelected(s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id]);
  return (
    <Card className="p-8">
      <StepTitle title="Who should get it?" />
      <ul className="m-0 mt-5 grid list-none grid-cols-2 gap-2 p-0">
        {CUSTOMERS.map((c) => (
          <li key={c.id} className={cn("flex items-center gap-3 rounded-2xl border px-4 py-2.5", s.selected.includes(c.id) ? "border-(--s-accent) bg-(--s-info-bg)" : "border-(--s-line)")}>
            <Check on={s.selected.includes(c.id)} onChange={() => toggle(c.id)} label={`Select ${fullName(c)}`} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{fullName(c)}</span><span className="block text-[12px] text-(--s-muted)">{c.state} · APR {c.apr}</span></span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-center justify-between">
        <Seg label="Channel" value={s.channel} onChange={(v) => s.setChannel(v as Channel)} options={CHANNEL_CHOICES.map((c) => ({ value: c, label: c }))} />
        <Btn kind="primary" className="h-10 px-5" onClick={() => s.setSent(true)}><Send className="size-3.5" strokeWidth={2} />Send to {s.selected.length} customers</Btn>
      </div>
    </Card>
  );
}

function StepResults({ s }: { s: Sim }) {
  const delivered = s.results.filter((r) => r.status === "delivered").length;
  const failed = s.results.length - delivered;
  return (
    <Card className="p-8">
      <div className="flex items-start justify-between">
        <StepTitle title={failed ? `${delivered} delivered, ${failed} failed` : `All ${delivered} delivered`} />
        <Btn kind="secondary" onClick={() => s.setSent(false)}>Send again</Btn>
      </div>
      <ul className="m-0 mt-5 flex list-none flex-col gap-2 p-0">
        {s.results.map((r) => {
          const ok = r.status === "delivered";
          return (
            <li key={r.customer.id}>
              <button type="button" onClick={() => { s.setViewing(r.customer.id); if (ok) s.setScreen("customer"); }} className={cn("flex w-full cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-left", ok ? "border-(--s-line) hover:bg-(--s-panel2)" : "border-(--s-bad)/30 bg-(--s-bad-bg)/60")}>
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", ok ? "bg-(--s-ok-bg) text-(--s-ok)" : "bg-(--s-bad-bg) text-(--s-bad)")}>{ok ? <CheckIcon className="size-4" strokeWidth={2.5} /> : <X className="size-4" strokeWidth={2.5} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{fullName(r.customer)}</span>
                  <span className={cn("block text-[12px]", ok ? "text-(--s-muted)" : "text-(--s-bad)")}>{ok ? `${r.channel} · Delivered (mock)` : <><span className="font-medium">Failed.</span> <Mono className="text-(--s-bad)">{r.error}</Mono></>}</span>
                </span>
                {ok ? <span className="text-[12px] text-(--s-accent)">View as customer</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CustomerModal({ s }: { s: Sim }) {
  const c = CUSTOMERS.find((x) => x.id === s.viewing) ?? CUSTOMERS[0];
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-[#1d1a3a]/45 p-6">
      <div className="flex max-h-full w-[44rem] flex-col overflow-hidden rounded-[26px] bg-(--s-panel) shadow-[0_30px_80px_-20px_rgb(29_26_58/0.6)]">
        <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-3">
          <div className="min-w-0"><h3 className="m-0 truncate text-[17px] font-semibold">{fullName(c)}</h3><p className="m-0 text-[12px] text-(--s-muted)">Delivered (mock) · what the customer sees</p></div>
          <div className="flex items-center gap-3">
            <Seg label="Customer view" value={s.view} onChange={s.setView} options={[{ value: "phone", label: "Phone" }, { value: "inbox", label: "Inbox" }, { value: "pdf", label: "PDF" }]} />
            <Btn kind="ghost" className="size-8 px-0" aria-label="Close" onClick={() => s.setScreen("send")}><X className="size-4" /></Btn>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-(--s-panel2) p-6">
          <CustomerView mode={s.view} c={c} version={s.relinked ? 3 : 2} accent />
        </div>
      </div>
    </div>
  );
}

function RelinkWizard({ s }: { s: Sim }) {
  const labels = ["What changed", "Map new value", "Confirm"];
  const needs = !s.feeField;
  return (
    <div className="mx-auto flex max-w-[46rem] flex-col gap-6">
      <Stepper labels={labels} current={s.relinkStep} onGo={(n) => s.setRelinkStep(n as 1 | 2 | 3)} />
      <Card className="p-8">
        {s.relinkStep === 1 ? (
          <>
            <StepTitle title="Version 3 asks for one more value" />
            <div className="mt-5 flex items-center gap-3 rounded-2xl bg-(--s-ok-bg) px-4 py-3"><Pill tone="ok">Added</Pill><Mono className="text-(--s-text)">annual_fee</Mono><span className="text-[13px] text-(--s-muted)">Currency · required</span></div>
            <p className="m-0 mt-3 text-[13px] text-(--s-muted)">Your other four mappings carry over. Version 2 sunsets on February 15, 2027.</p>
            <div className="mt-6 flex justify-end"><Btn kind="primary" className="h-10 px-5" onClick={() => s.setRelinkStep(2)}>Continue</Btn></div>
          </>
        ) : s.relinkStep === 2 ? (
          <>
            <StepTitle title="Where does the annual fee come from?" />
            <div className="mt-5 flex items-center gap-4 rounded-2xl border border-(--s-line) p-4">
              <div className="w-44"><Mono className="text-[13px] text-(--s-text)">{NEW_VARIABLE.key}</Mono><p className="m-0 text-[12px] text-(--s-muted)">Currency · required</p></div>
              <FieldSelect label="Field for annual_fee" value={s.feeField} invalid={needs} options={FIELD_OPTIONS} onChange={s.setFeeField} />
            </div>
            <div className="mt-6 flex items-center justify-between"><Btn kind="ghost" onClick={() => s.setRelinkStep(1)}><ArrowLeft className="size-3.5" />Back</Btn><div className="flex items-center gap-4">{needs ? <span className="text-[13px] text-(--s-bad)">Map annual_fee to continue.</span> : null}<Btn kind="primary" className="h-10 px-5" disabled={needs} onClick={() => s.setRelinkStep(3)}>Continue</Btn></div></div>
          </>
        ) : (
          <>
            <StepTitle title="Move Spring Travel Rewards to v3?" />
            <dl className="m-0 mt-5 divide-y divide-(--s-line) rounded-2xl border border-(--s-line) text-[13px]">
              <div className="flex justify-between px-4 py-3"><dt className="text-(--s-muted)">Template</dt><dd className="m-0">Spring Travel Rewards — Terms</dd></div>
              <div className="flex justify-between px-4 py-3"><dt className="text-(--s-muted)">Pinned version</dt><dd className="m-0">v2 to v3</dd></div>
              <div className="flex justify-between px-4 py-3"><dt className="text-(--s-muted)">New mapping</dt><dd className="m-0"><Mono>annual_fee = {s.feeField || "—"}</Mono></dd></div>
            </dl>
            <div className="mt-6 flex items-center justify-between"><Btn kind="ghost" onClick={() => s.setRelinkStep(2)}><ArrowLeft className="size-3.5" />Back</Btn><Btn kind="primary" className="h-10 px-5" onClick={() => { s.setRelinked(true); s.setSent(false); s.setScreen("send"); }}>Relink to v3</Btn></div>
          </>
        )}
      </Card>
    </div>
  );
}

function InboxPage({ s }: { s: Sim }) {
  return (
    <div className="mx-auto max-w-[44rem]">
      <h1 className="m-0 text-[30px] font-semibold tracking-tight">Notices from Stencil</h1>
      <ul className="m-0 mt-6 flex list-none flex-col gap-3 p-0">
        {NOTICES.map((n) => {
          const bad = n.kind === "revoked";
          return (
            <li key={n.id}>
              <Card className="flex items-start gap-4 p-5">
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", bad ? "bg-(--s-bad-bg) text-(--s-bad)" : n.kind === "sunset" ? "bg-(--s-warn-bg) text-(--s-warn)" : "bg-(--s-info-bg) text-(--s-info)")}><Mail className="size-4" strokeWidth={1.75} /></span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[15px] font-semibold">{n.title}</p>
                  <p className="m-0 mt-1 text-[13px] leading-5 text-(--s-muted)">{n.body}</p>
                  <p className="m-0 mt-2 text-[12px] text-(--s-muted)">{n.offer} · {n.at}</p>
                </div>
                {n.unread ? <span className="mt-1 size-2.5 shrink-0 rounded-full bg-(--s-accent)" /> : null}
                <Btn kind="secondary" className="shrink-0" onClick={() => n.action !== "Dismiss" && s.setScreen("relink")}>{n.action}</Btn>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function VariantB({ s }: { s: Sim }) {
  const wizard = s.screen === "link" || s.screen === "map" || s.screen === "send" || s.screen === "customer";
  const step = stepOf(s);
  const goStep = (n: number) => s.setScreen(n === 1 ? "link" : n === 2 ? "map" : "send");
  return (
    <div style={{ ...VARS, fontFamily: "var(--s-font)" }} className="relative flex h-full min-h-0 flex-col bg-(--s-bg) text-(--s-text)">
      <header className="flex h-16 shrink-0 items-center gap-8 border-b border-(--s-line) bg-(--s-panel) px-8">
        <div className="flex items-center gap-2"><span className="size-6 rounded-full bg-gradient-to-br from-[#ff7a59] to-[#ff4d7d]" /><span className="text-[20px] font-bold tracking-tight">coral</span></div>
        <nav className="flex gap-1">
          {[{ l: "Offers", on: s.screen !== "notices", go: () => s.setScreen("offers") }, { l: "Customers", on: false, go: () => {} }, { l: "Reports", on: false, go: () => {} }].map((n) => (
            <button key={n.l} type="button" onClick={n.go} className={cn("h-9 cursor-pointer rounded-full px-4 text-[14px] font-medium", n.on ? "bg-(--s-info-bg) text-(--s-accent)" : "text-(--s-muted) hover:text-(--s-text)")}>{n.l}</button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button type="button" aria-label="Notices" onClick={() => s.setScreen("notices")} className={cn("relative grid size-9 cursor-pointer place-items-center rounded-full", s.screen === "notices" ? "bg-(--s-info-bg) text-(--s-accent)" : "text-(--s-muted) hover:bg-(--s-panel2)")}><Bell className="size-[18px]" strokeWidth={1.75} /><span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-(--s-accent)" /></button>
          <span className="grid size-9 place-items-center rounded-full bg-[#ffd9cc] text-[13px] font-semibold text-[#8a2f12]">DW</span>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-8 pb-14">
        {s.screen === "offers" ? <OffersGrid s={s} /> : null}
        {s.screen === "notices" ? <InboxPage s={s} /> : null}
        {s.screen === "relink" ? <RelinkWizard s={s} /> : null}
        {wizard ? (
          <div className="mx-auto flex max-w-[46rem] flex-col gap-6">
            <div className="flex items-center justify-between"><button type="button" onClick={() => s.setScreen("offers")} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-(--s-muted) hover:text-(--s-text)"><ArrowLeft className="size-3.5" />All offers</button><span className="text-[14px] font-semibold">Spring Travel Rewards</span><span className="w-16" /></div>
            <Stepper labels={["Template", "Values", "Customers", "Results"]} current={step} onGo={goStep} />
            <ScenarioStrip s={s} />
            {s.screen === "link" ? <StepLink s={s} /> : null}
            {s.screen === "map" ? <StepMap s={s} /> : null}
            {step === 3 ? <StepPick s={s} /> : null}
            {step === 4 ? <StepResults s={s} /> : null}
          </div>
        ) : null}
      </main>
      {s.screen === "customer" ? <CustomerModal s={s} /> : null}
    </div>
  );
}
