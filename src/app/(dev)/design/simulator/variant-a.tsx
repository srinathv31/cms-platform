"use client";

import type { CSSProperties } from "react";
import { AlertTriangle, ArrowRight, Bell, Check as CheckIcon, FileText, Inbox, Layers, Search, Send, Users, X } from "lucide-react";
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
  type Notice,
} from "./data";
import { Btn, Check, Dot, FieldSelect, Mono, Pill, Seg } from "./bits";
import { CustomerView } from "./customer-views";
import type { Sim } from "./use-sim";

/*
 * A: Ops console. Navy sidebar, dense tables, one offer = one page with tabs.
 * Helvetica, 5px corners, signal orange on cool grey: a back-office tool.
 */

const VARS = {
  "--s-bg": "#eef1f6",
  "--s-panel": "#ffffff",
  "--s-panel2": "#f4f6fa",
  "--s-line": "#d8dee8",
  "--s-text": "#172033",
  "--s-muted": "#5f6b7f",
  "--s-accent": "#e8553e",
  "--s-accent-text": "#ffffff",
  "--s-ok": "#0b8a5f",
  "--s-ok-bg": "#dff4ea",
  "--s-bad": "#c62e2e",
  "--s-bad-bg": "#fce8e8",
  "--s-warn": "#8f5b00",
  "--s-warn-bg": "#fff1d0",
  "--s-info": "#2459c7",
  "--s-info-bg": "#e3ebfd",
  "--s-rs": "3px",
  "--s-rb": "5px",
  "--s-font": '"Helvetica Neue", Helvetica, Arial, sans-serif',
  "--s-mono": 'Menlo, "SF Mono", ui-monospace, monospace',
} as CSSProperties;

type Tab = "template" | "values" | "send";
const TAB_OF: Record<string, Tab | undefined> = { link: "template", map: "values", send: "send", customer: "send", relink: "template" };

function Header({ crumbs, title, right }: { crumbs: string[]; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="m-0 text-[12px] text-(--s-muted)">{crumbs.join("  /  ")}</p>
        <h1 className="m-0 mt-1 truncate text-[22px] leading-7 font-semibold tracking-tight text-(--s-text)">{title}</h1>
      </div>
      {right}
    </div>
  );
}

function Panel({ title, right, children, className }: { title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-md border border-(--s-line) bg-(--s-panel)", className)}>
      {title ? (
        <div className="flex h-11 items-center justify-between border-b border-(--s-line) px-4">
          <h2 className="m-0 text-[13px] font-semibold text-(--s-text)">{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const TH = "h-9 px-4 text-left text-[11px] font-semibold tracking-wider text-(--s-muted) uppercase";
const TD = "px-4 py-2.5 align-middle text-[13px]";

function Banner({ s }: { s: Sim }) {
  const st = linkStatus(s.scenario);
  if (s.scenario === "live") return null;
  const bad = st.tone === "bad";
  return (
    <div className={cn("flex items-center gap-3 rounded-md border px-4 py-2.5 text-[13px]", bad ? "border-(--s-bad)/30 bg-(--s-bad-bg) text-(--s-bad)" : "border-(--s-info)/25 bg-(--s-info-bg) text-(--s-info)")}>
      {bad ? <AlertTriangle className="size-4 shrink-0" strokeWidth={2} /> : <Layers className="size-4 shrink-0" strokeWidth={2} />}
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">{bad ? "Render failed. " : "v3 available. "}</strong>
        {st.detail}
      </span>
      <Btn kind="secondary" className="h-7 bg-white text-(--s-text)" onClick={() => s.setScreen("relink")}>
        Relink to v3 <ArrowRight className="size-3.5" />
      </Btn>
    </div>
  );
}

function OffersPage({ s }: { s: Sim }) {
  return (
    <div className="flex flex-col gap-5">
      <Header crumbs={["Offers"]} title="Offers" right={<Btn kind="secondary">New offer</Btn>} />
      <Panel>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-(--s-line) bg-(--s-panel2)">
              <th className={TH}>Offer</th>
              <th className={TH}>Linked template</th>
              <th className={TH}>Pin</th>
              <th className={TH}>Link status</th>
              <th className={cn(TH, "text-right")}>Sends, 30 days</th>
              <th className={TH}>Last send</th>
            </tr>
          </thead>
          <tbody>
            {OFFERS.map((o) => {
              const st = offerStatus(o, s.scenario);
              return (
                <tr key={o.id} className="cursor-pointer border-b border-(--s-line) last:border-0 hover:bg-(--s-panel2)" onClick={() => s.setScreen(o.id === SPRING_ID ? "send" : "map")}>
                  <td className={TD}>
                    <p className="m-0 font-medium text-(--s-text)">{o.name}</p>
                    <p className="m-0 mt-0.5 text-[12px] text-(--s-muted)">{o.headline}</p>
                  </td>
                  <td className={TD}>
                    <p className="m-0 text-(--s-text)">{o.templateName}</p>
                    <Mono className="text-(--s-muted)">{o.templateId}</Mono>
                  </td>
                  <td className={TD}><Mono>{pinnedLabel(o)}</Mono></td>
                  <td className={TD}><Pill tone={st.tone}>{st.label}</Pill></td>
                  <td className={cn(TD, "text-right tabular-nums")}>{o.sends30.toLocaleString("en-US")}</td>
                  <td className={cn(TD, "text-(--s-muted)")}>{o.lastSend}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function OfferTabs({ s }: { s: Sim }) {
  const tab = TAB_OF[s.screen] ?? "send";
  const tabs: { id: Tab; label: string; go: () => void }[] = [
    { id: "template", label: "Template", go: () => s.setScreen("link") },
    { id: "values", label: "Values", go: () => s.setScreen("map") },
    { id: "send", label: "Send", go: () => s.setScreen("send") },
  ];
  return (
    <div className="flex gap-6 border-b border-(--s-line)">
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={t.go} className={cn("-mb-px h-10 cursor-pointer border-b-2 text-[13px] font-medium", tab === t.id ? "border-(--s-accent) text-(--s-text)" : "border-transparent text-(--s-muted) hover:text-(--s-text)")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function LinkTab({ s }: { s: Sim }) {
  const found = FOUND.find((f) => f.id === s.picked);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_22rem] gap-5">
      <Panel title="Find a template">
        <div className="p-4">
          <div className="flex h-9 items-center gap-2 rounded-(--s-rb) border border-(--s-line) bg-(--s-panel2) px-3 text-[13px]">
            <Search className="size-4 text-(--s-muted)" strokeWidth={1.75} />
            <span>spring</span>
          </div>
          <ul className="m-0 mt-3 list-none divide-y divide-(--s-line) rounded-(--s-rb) border border-(--s-line) p-0">
            {FOUND.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => s.setPicked(f.id)} className={cn("flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-(--s-panel2)", s.picked === f.id && "bg-(--s-info-bg)")}>
                  <FileText className="size-4 shrink-0 text-(--s-muted)" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{f.name}</span>
                    <span className="block text-[12px] text-(--s-muted)"><Mono>{f.id}</Mono> · {f.team}</span>
                  </span>
                  <Pill tone="ok">Active v{f.activeVersion}</Pill>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Panel>
      <Panel title="Pin a version">
        <div className="flex flex-col gap-4 p-4">
          {found ? (
            <>
              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2.5 rounded-(--s-rb) border border-(--s-line) p-3 text-[13px] has-[:checked]:border-(--s-accent)">
                  <input type="radio" name="pin-a" checked={s.pin === 2} onChange={() => s.setPin(2)} className="accent-(--s-accent)" />
                  <span className="flex-1 font-medium">Version 2</span><Pill tone="ok">Active</Pill>
                </label>
                {found.older.map((o) => (
                  <label key={o.version} className="flex cursor-pointer items-center gap-2.5 rounded-(--s-rb) border border-(--s-line) p-3 text-[13px] has-[:checked]:border-(--s-accent)">
                    <input type="radio" name="pin-a" checked={s.pin === 1} onChange={() => s.setPin(1)} className="accent-(--s-accent)" />
                    <span className="flex-1 font-medium">Version {o.version}</span><Pill tone="warn">Sunset {o.sunset}</Pill>
                  </label>
                ))}
              </div>
              <p className="m-0 text-[12px] text-(--s-muted)">Channels: {found.channels.join(", ")}</p>
              <Btn kind="primary" onClick={() => s.setScreen("map")}>Link and map values</Btn>
            </>
          ) : (
            <p className="m-0 text-[13px] text-(--s-muted)">Choose a template.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}

function ValuesTab({ s }: { s: Sim }) {
  const blocked = s.unmapped.length > 0;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Map values" right={<Mono className="text-(--s-muted)">UC-7H2M9X · v2</Mono>}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-(--s-line) bg-(--s-panel2)">
              <th className={TH}>Variable</th><th className={TH}>Type</th><th className={TH}>Required</th><th className={TH}>Simulator field</th>
            </tr>
          </thead>
          <tbody>
            {s.variables.map((v) => (
              <tr key={v.key} className="border-b border-(--s-line) last:border-0">
                <td className={TD}><Mono className="text-(--s-text)">{v.key}</Mono></td>
                <td className={cn(TD, "text-(--s-muted)")}>{v.type}</td>
                <td className={TD}>{v.required ? "Yes" : "No"}</td>
                <td className={TD}>
                  <FieldSelect label={`Field for ${v.key}`} value={v.mapped} invalid={v.required && !v.mapped} options={FIELD_OPTIONS} onChange={(val) => s.setMapping({ ...s.mapping, [v.key]: val })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="flex items-center justify-between">
        <p className={cn("m-0 flex items-center gap-2 text-[13px]", blocked ? "text-(--s-bad)" : "text-(--s-ok)")}>
          {blocked ? <><AlertTriangle className="size-4" strokeWidth={2} />Map {s.unmapped.map((v) => v.key).join(", ")} to send.</> : <><CheckIcon className="size-4" strokeWidth={2} />All required values are mapped.</>}
        </p>
        <Btn kind="primary" disabled={blocked} onClick={() => s.setScreen("send")}>Continue to send</Btn>
      </div>
    </div>
  );
}

function SendTab({ s }: { s: Sim }) {
  const delivered = s.results.filter((r) => r.status === "delivered").length;
  const failed = s.results.length - delivered;
  const toggle = (id: string) => s.setSelected(s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id]);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-5">
        <Panel title="Customers" right={<span className="text-[12px] text-(--s-muted)">{s.selected.length} selected</span>}>
          <table className="w-full border-collapse">
            <tbody>
              {CUSTOMERS.slice(0, 6).map((c) => (
                <tr key={c.id} className="border-b border-(--s-line) last:border-0">
                  <td className="w-10 px-4 py-2"><Check on={s.selected.includes(c.id)} onChange={() => toggle(c.id)} label={`Select ${fullName(c)}`} /></td>
                  <td className="max-w-[18rem] truncate py-2 pr-4 text-[13px]">{fullName(c)}</td>
                  <td className="py-2 pr-4 text-[13px] text-(--s-muted)">{c.state}</td>
                  <td className="py-2 pr-4 text-right text-[13px] tabular-nums">{c.apr}{c.badApr ? "" : "%"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Send" className="w-60">
          <div className="flex flex-col gap-3 p-4">
            <Seg label="Channel" value={s.channel} onChange={(v) => s.setChannel(v as Channel)} options={CHANNEL_CHOICES.map((c) => ({ value: c, label: c }))} />
            <Btn kind="primary" onClick={() => s.setSent(true)}><Send className="size-3.5" strokeWidth={2} />Send to {s.selected.length} customers</Btn>
          </div>
        </Panel>
      </div>
      {s.sent ? (
        <Panel title="Results" right={<span className="flex items-center gap-3 text-[12px] text-(--s-muted)"><span className="flex items-center gap-1.5"><Dot tone="ok" />{delivered} delivered</span>{failed ? <span className="flex items-center gap-1.5"><Dot tone="bad" />{failed} failed</span> : null}</span>}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-(--s-line) bg-(--s-panel2)">
                <th className={TH}>Customer</th><th className={TH}>Channel</th><th className={TH}>Status</th><th className={TH}>Render result</th>
              </tr>
            </thead>
            <tbody>
              {s.results.map((r) => (
                <tr key={r.customer.id} onClick={() => { s.setViewing(r.customer.id); if (r.status === "delivered") s.setScreen("customer"); }} className={cn("cursor-pointer border-b border-(--s-line) last:border-0 hover:bg-(--s-panel2)", s.screen === "customer" && s.viewing === r.customer.id && "bg-(--s-info-bg)")}>
                  <td className={cn(TD, "max-w-[16rem] truncate")}>{fullName(r.customer)}</td>
                  <td className={TD}>{r.channel}</td>
                  <td className={TD}>{r.status === "delivered" ? <Pill tone="ok">Delivered (mock)</Pill> : <Pill tone="bad">Failed</Pill>}</td>
                  <td className={cn(TD, "text-[12px]", r.status === "failed" ? "text-(--s-bad)" : "text-(--s-muted)")}>
                    {r.status === "failed" ? <Mono className="text-(--s-bad)">{r.error}</Mono> : "View as customer →"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}
    </div>
  );
}

function Drawer({ s }: { s: Sim }) {
  const c = CUSTOMERS.find((x) => x.id === s.viewing) ?? CUSTOMERS[0];
  return (
    <aside className="flex w-[26rem] shrink-0 flex-col border-l border-(--s-line) bg-(--s-panel)">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-(--s-line) px-4">
        <div className="min-w-0">
          <p className="m-0 truncate text-[13px] font-semibold">{fullName(c)}</p>
          <p className="m-0 text-[11px] text-(--s-muted)">As the customer sees it</p>
        </div>
        <Btn kind="ghost" className="size-8 px-0" aria-label="Close" onClick={() => s.setScreen("send")}><X className="size-4" /></Btn>
      </div>
      <div className="flex shrink-0 justify-center border-b border-(--s-line) py-2.5">
        <Seg label="Customer view" value={s.view} onChange={s.setView} options={[{ value: "phone", label: "App" }, { value: "inbox", label: "Email" }, { value: "pdf", label: "PDF" }]} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-(--s-bg) p-4">
        <CustomerView mode={s.view} c={c} version={s.relinked ? 3 : 2} narrow accent />
      </div>
    </aside>
  );
}

function NoticeRow({ n, s }: { n: Notice; s: Sim }) {
  const tone = n.kind === "revoked" ? "bad" : n.kind === "active" ? "ok" : n.kind === "sunset" ? "warn" : "info";
  return (
    <li className="flex items-start gap-4 px-4 py-3.5">
      <span className="mt-1.5"><Dot tone={n.unread ? "warn" : "ok"} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="m-0 text-[13px] font-semibold">{n.title}</p>
          <Pill tone={tone}>{n.offer}</Pill>
        </div>
        <p className="m-0 mt-1 text-[13px] text-(--s-muted)">{n.body}</p>
      </div>
      <span className="shrink-0 pt-0.5 text-[12px] text-(--s-muted)">{n.at}</span>
      <Btn kind="secondary" className="h-7 shrink-0" onClick={() => n.action !== "Dismiss" && s.setScreen("relink")}>{n.action}</Btn>
    </li>
  );
}

function NoticesPage({ s }: { s: Sim }) {
  return (
    <div className="flex flex-col gap-5">
      <Header crumbs={["Notices"]} title="Notices from UCOMP" />
      <Panel>
        <ul className="m-0 list-none divide-y divide-(--s-line) p-0">
          {NOTICES.map((n) => <NoticeRow key={n.id} n={n} s={s} />)}
        </ul>
      </Panel>
    </div>
  );
}

function RelinkTab({ s }: { s: Sim }) {
  const needs = !s.feeField;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_20rem] gap-5">
      <div className="flex flex-col gap-4">
        <Panel title="What changes in v3">
          <table className="w-full border-collapse">
            <tbody>
              <tr className="border-b border-(--s-line)"><td className={TD}><Pill tone="ok">Added</Pill></td><td className={TD}><Mono className="text-(--s-text)">annual_fee</Mono></td><td className={cn(TD, "text-(--s-muted)")}>Currency · required</td></tr>
              <tr className="border-b border-(--s-line)"><td className={TD}><Pill>Same</Pill></td><td className={TD}><Mono className="text-(--s-text)">first_name, last_name, purchase_apr, home_state</Mono></td><td className={cn(TD, "text-(--s-muted)")}>Mapping kept</td></tr>
              <tr><td className={TD}><Pill>Same</Pill></td><td className={TD}><Mono className="text-(--s-text)">offer_end_date</Mono></td><td className={cn(TD, "text-(--s-muted)")}>Optional</td></tr>
            </tbody>
          </table>
        </Panel>
        <Panel title="Map the new value">
          <div className="flex items-center gap-4 p-4">
            <div className="w-40"><Mono className="text-(--s-text)">{NEW_VARIABLE.key}</Mono><p className="m-0 text-[12px] text-(--s-muted)">Currency · required</p></div>
            <FieldSelect label="Field for annual_fee" value={s.feeField} invalid={needs} options={FIELD_OPTIONS} onChange={s.setFeeField} />
          </div>
        </Panel>
      </div>
      <Panel title="Relink">
        <div className="flex flex-col gap-3 p-4 text-[13px]">
          <p className="m-0 flex justify-between"><span className="text-(--s-muted)">From</span><Mono>v2 · sunset Feb 15</Mono></p>
          <p className="m-0 flex justify-between"><span className="text-(--s-muted)">To</span><Mono>v3 · Active</Mono></p>
          {needs ? <p className="m-0 text-(--s-bad)">Map annual_fee to relink.</p> : null}
          <Btn kind="primary" disabled={needs} onClick={() => { s.setRelinked(true); s.setScreen("send"); }}>Relink to v3</Btn>
        </div>
      </Panel>
    </div>
  );
}

function OfferPage({ s }: { s: Sim }) {
  const st = linkStatus(s.scenario);
  return (
    <div className="flex flex-col gap-4">
      <Header
        crumbs={["Offers", "Spring Travel Rewards"]}
        title="Spring Travel Rewards"
        right={<div className="flex items-center gap-2"><Pill tone={s.relinked ? "ok" : st.tone}>{s.relinked ? "Pinned to v3" : st.label}</Pill></div>}
      />
      {s.relinked ? null : <Banner s={s} />}
      <OfferTabs s={s} />
      {s.screen === "link" ? <LinkTab s={s} /> : null}
      {s.screen === "map" ? <ValuesTab s={s} /> : null}
      {s.screen === "relink" ? <RelinkTab s={s} /> : null}
      {s.screen === "send" || s.screen === "customer" ? <SendTab s={s} /> : null}
    </div>
  );
}

export function VariantA({ s }: { s: Sim }) {
  const nav = [
    { label: "Offers", icon: Layers, on: s.screen !== "notices", go: () => s.setScreen("offers") },
    { label: "Customers", icon: Users, on: false, go: () => {} },
    { label: "Deliveries", icon: Send, on: false, go: () => {} },
    { label: "Notices", icon: Inbox, on: s.screen === "notices", go: () => s.setScreen("notices"), badge: 2 },
  ];
  return (
    <div style={{ ...VARS, fontFamily: "var(--s-font)" }} className="relative flex h-full min-h-0 bg-(--s-bg) text-(--s-text)">
      <aside className="flex w-56 shrink-0 flex-col bg-[#101a2e] text-[#c9d2e3]">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <span className="grid size-7 place-items-center rounded-md bg-(--s-accent) text-[15px] font-bold text-white">c</span>
          <span className="text-[16px] font-semibold tracking-tight text-white">coral</span>
          <span className="rounded-[3px] bg-white/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-[#9fb0cc] uppercase">Ops</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-3 pt-2">
          {nav.map((n) => (
            <button key={n.label} type="button" onClick={n.go} className={cn("flex h-9 cursor-pointer items-center gap-3 rounded-[5px] px-3 text-left text-[13px]", n.on ? "bg-white/10 font-medium text-white" : "hover:bg-white/5")}>
              <n.icon className="size-4" strokeWidth={1.75} />
              <span className="flex-1">{n.label}</span>
              {n.badge ? <span className="grid h-4 min-w-4 place-items-center rounded-full bg-(--s-accent) px-1 text-[10px] font-semibold text-white">{n.badge}</span> : null}
            </button>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 p-4 text-[12px] text-[#8c9bb8]">
          <p className="m-0 text-white">Dana Whitfield</p>
          <p className="m-0">Offers operations</p>
        </div>
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-(--s-line) bg-(--s-panel) px-8">
          <div className="flex h-8 w-72 items-center gap-2 rounded-(--s-rb) bg-(--s-panel2) px-3 text-[13px] text-(--s-muted)"><Search className="size-4" strokeWidth={1.75} />Search offers</div>
          <button type="button" aria-label="Notices" onClick={() => s.setScreen("notices")} className="relative grid size-8 cursor-pointer place-items-center rounded-(--s-rb) text-(--s-muted) hover:bg-(--s-panel2)"><Bell className="size-[18px]" strokeWidth={1.75} /><span className="absolute top-1 right-1 size-2 rounded-full bg-(--s-accent)" /></button>
        </div>
        <div className="flex min-h-0 flex-1">
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-6 pb-12">
            <div className="mx-auto max-w-[68rem]">
              {s.screen === "offers" ? <OffersPage s={s} /> : s.screen === "notices" ? <NoticesPage s={s} /> : <OfferPage s={s} />}
            </div>
          </main>
          {s.screen === "customer" ? <Drawer s={s} /> : null}
        </div>
      </div>
    </div>
  );
}
