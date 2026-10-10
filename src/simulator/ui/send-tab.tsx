import { Send } from "lucide-react";
import type { ApiChannel } from "@/contracts/api-v1";
import { cn } from "@/lib/utils";
import type { SimApiError, SimBatch, SimCustomerRow, SimDeliveryResult, SimLinkSummary } from "@/simulator/types";
import { Mono, Panel, Pill, TableWrap, TD, TH, btnClass } from "./bits";
import { CHANNEL_LABEL, PLATFORM_LABEL, channelList, linkStatus, phoneLabel, plural, resultsHeadline, whenLabel } from "./format";

function Checkbox({ on, label, onClick }: { on: boolean; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[4px] border",
        on ? "border-(--sim-accent) bg-(--sim-accent) text-(--sim-accent-text)" : "border-(--sim-line) bg-(--sim-panel)",
      )}
    >
      {on ? (
        <svg aria-hidden viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5 5 9l4.5-5.5" />
        </svg>
      ) : null}
    </button>
  );
}

const fee = (value: string | null) => (value === null ? "None" : `$${Number(value).toLocaleString("en-US")}`);

/** Send tab: pick customers, send, and read the results. */
export function SendTab({
  link,
  customers,
  selected,
  onSelect,
  sentence,
  sending,
  sendError,
  onSend,
  batch,
  outcome,
  onView,
  viewing,
  onMapValues,
}: {
  link: SimLinkSummary;
  customers: SimCustomerRow[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  /** "Map Annual fee to send." while required values are unmapped. */
  sentence: string;
  sending: boolean;
  sendError: string | null;
  onSend: () => void;
  batch: SimBatch | null;
  /** "0 delivered, 6 failed" for the send made on this page; null until one is. */
  outcome: string | null;
  onView: (customerId: string, channel: ApiChannel) => void;
  viewing: { customerId: string; channel: ApiChannel } | null;
  /** Opens the Values tab, where the missing value is mapped. */
  onMapValues: () => void;
}) {
  const all = selected.length === customers.length;
  const toggle = (id: string) => onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const disabled = sending || sentence !== "" || selected.length === 0;
  const reason = sentence || (selected.length === 0 ? "Choose at least one customer." : "");
  // The consequence, before the commitment: what this send makes, and when the pin already fails (the
  // button stays enabled: the failure is the demo).
  const documents = selected.length * link.channels.length;
  // An alert goes to phones: the picker shows each customer's phone and card instead of their terms.
  const toPhones = link.channels.some((c) => c === "push" || c === "sms");
  const failing = linkStatus(link);
  const stopped =
    link.pinnedState === "revoked" || link.revokedAt ? `v${link.pinnedVersion} was revoked.` : `v${link.pinnedVersion} stopped rendering.`;

  return (
    <div className="flex flex-col gap-5">
      <div className="@container">
        <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_16rem]">
          <Panel title="Customers" right={<span className="text-[12px] text-(--sim-muted)">{selected.length} selected</span>} className="min-w-0">
            <TableWrap>
              <table aria-label="Customers" className="w-full min-w-[26rem] border-collapse">
                <thead>
                  <tr className="border-b border-(--sim-line) bg-(--sim-panel2)">
                    <th className="h-9 w-10 pl-4">
                      <Checkbox on={all} label="Select all customers" onClick={() => onSelect(all ? [] : customers.map((c) => c.id))} />
                    </th>
                    <th className={TH}>Customer</th>
                    {toPhones ? (
                      <>
                        <th className={TH}>Phone</th>
                        <th className={cn(TH, "text-right")}>Number</th>
                      </>
                    ) : (
                      <>
                        <th className={TH}>State</th>
                        <th className={cn(TH, "text-right")}>Purchase APR</th>
                        <th className={cn(TH, "text-right")}>Annual fee</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id} onClick={() => toggle(c.id)} className="cursor-pointer border-b border-(--sim-line) last:border-0 hover:bg-(--sim-panel2)">
                      <td className="w-10 py-2 pl-4">
                        <Checkbox on={selected.includes(c.id)} label={`Select ${c.name}`} />
                      </td>
                      <td className="max-w-[16rem] truncate px-4 py-2 text-[13px]" title={c.name}>
                        {c.name}
                      </td>
                      {toPhones ? (
                        <>
                          <td className={cn(TD, "py-2 text-(--sim-muted)")}>{PLATFORM_LABEL[c.platform]}</td>
                          <td className={cn(TD, "py-2 text-right whitespace-nowrap tabular-nums")}>{phoneLabel(c.phone)}</td>
                        </>
                      ) : (
                        <>
                          <td className={cn(TD, "py-2 text-(--sim-muted)")}>{c.homeState}</td>
                          <td className={cn(TD, "py-2 text-right tabular-nums")}>{c.purchaseApr}%</td>
                          <td className={cn(TD, "py-2 text-right tabular-nums")}>{fee(c.annualFee)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Panel>
          <Panel title="Send" className="order-first self-start @3xl:order-none">
            <div className="flex flex-col gap-3 p-4">
              <div className="text-[13px]">
                <p className="m-0 truncate font-medium" title={link.templateName}>
                  {link.templateName}
                </p>
                <p className="m-0 mt-0.5 text-[12px] text-(--sim-muted)">
                  {selected.length > 0 ? (
                    <>
                      {toPhones ? plural(documents, "message", "messages") : plural(documents, "document", "documents")} · {channelList(link.channels)} ·{" "}
                      <Mono>v{link.pinnedVersion}</Mono>
                    </>
                  ) : (
                    <>
                      <Mono>v{link.pinnedVersion}</Mono> · {channelList(link.channels)}
                    </>
                  )}
                </p>
              </div>
              <button type="button" disabled={disabled} onClick={onSend} aria-describedby="send-note" className={btnClass("primary", "w-full")}>
                <Send aria-hidden className="size-3.5" strokeWidth={2} />
                {sending ? "Sending…" : selected.length > 0 ? `Send to ${plural(selected.length, "customer", "customers")}` : "Send"}
              </button>
              <p id="send-note" className={cn("m-0 min-h-4 text-[12px]", sentence ? "text-(--sim-bad)" : "text-(--sim-muted)")}>
                {sentence ? (
                  <button type="button" onClick={onMapValues} className="p-0 text-left underline underline-offset-2">
                    {sentence}
                  </button>
                ) : (
                  reason
                )}
              </p>
              {failing.failing ? <p className="m-0 text-[12px] text-(--sim-bad)">{stopped} Sends will fail.</p> : null}
              <p role="status" className="m-0 min-h-4 text-[12px] font-medium">
                {outcome}
              </p>
              {sendError ? (
                <p role="alert" className="m-0 text-[13px] text-(--sim-bad)">
                  {sendError}
                </p>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>
      {batch ? <Results batch={batch} onView={onView} viewing={viewing} /> : null}
    </div>
  );
}

/** The one error every failed render shares, when they all do: shown once, in the header. */
function sharedError(batch: SimBatch): SimApiError | null {
  const errors = batch.rows.flatMap((row) => row.results.filter((r) => r.status === "failed").map((r) => r.error));
  const first = errors[0];
  if (!first || errors.some((e) => !e || e.status !== first.status || e.code !== first.code || e.message !== first.message)) return null;
  return first;
}

const errorCode = (e: SimApiError) => `${e.status > 0 ? `${e.status} ` : ""}${e.code}`;

function Results({ batch, onView, viewing }: { batch: SimBatch; onView: (customerId: string, channel: ApiChannel) => void; viewing: { customerId: string; channel: ApiChannel } | null }) {
  const shared = sharedError(batch);
  const cell = (customerName: string, customerId: string, r: SimDeliveryResult | undefined) => {
    if (!r) return <span className="text-(--sim-muted)">None</span>;
    if (r.status === "failed") {
      return (
        <div className="max-w-[18rem]">
          <Pill tone="bad">Failed</Pill>
          {r.error ? (
            <>
              {shared ? null : <p className="m-0 mt-1 text-[12px] leading-4 text-(--sim-bad)">{r.error.message}</p>}
              <Mono className={cn("text-[11px] text-(--sim-muted)", shared && "mt-1 block")}>{errorCode(r.error)}</Mono>
            </>
          ) : null}
        </div>
      );
    }
    const open = viewing?.customerId === customerId && viewing.channel === r.channel;
    return (
      <div>
        <button
          type="button"
          onClick={() => onView(customerId, r.channel)}
          aria-expanded={open}
          className={cn("inline-flex h-6 items-center rounded-(--sim-rs) bg-(--sim-ok-bg) px-1.5 text-[11px] font-medium text-(--sim-ok) hover:brightness-95", open && "ring-1 ring-(--sim-ok)")}
        >
          Delivered
          <span className="sr-only">, view {customerName} · {CHANNEL_LABEL[r.channel]}</span>
        </button>
        {r.newerVersion ? <p className="m-0 mt-1 text-[11px] text-(--sim-warn)">Newer: v{r.newerVersion}</p> : null}
        {r.platform ? <p className="m-0 mt-1 text-[11px] text-(--sim-muted)">{PLATFORM_LABEL[r.platform]}</p> : null}
        {r.sms ? (
          <p className="m-0 mt-1 text-[11px] text-(--sim-muted) tabular-nums">
            {r.sms.encoding} · {plural(r.sms.parts, "part", "parts")}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <Panel id="results-panel" title="Results" label="Results" className="scroll-mt-4">
      <div className="border-b border-(--sim-line) px-4 py-3">
        <h3 className="m-0 flex items-center gap-2 text-[16px] font-semibold">
          <span aria-hidden className={cn("size-2 rounded-full", batch.counts.failed > 0 ? "bg-(--sim-bad)" : "bg-(--sim-ok)")} />
          {resultsHeadline(batch.counts)}
        </h3>
        <p className="m-0 mt-0.5 text-[12px] text-(--sim-muted)">
          {plural(batch.rows.length, "customer", "customers")} · {channelList(batch.channels)} · v{batch.versionNumber} · {whenLabel(batch.at)}
        </p>
        {shared ? (
          <p className="m-0 mt-1.5 text-[13px] text-(--sim-bad)">
            {shared.message} <Mono className="text-(--sim-muted)">{errorCode(shared)}</Mono>
          </p>
        ) : null}
      </div>
      <TableWrap>
        <table aria-label="Results" className="w-full min-w-[30rem] border-collapse">
          <thead>
            <tr className="border-b border-(--sim-line) bg-(--sim-panel2)">
              <th className={TH}>Customer</th>
              {batch.channels.map((c) => (
                <th key={c} className={TH}>
                  {CHANNEL_LABEL[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batch.rows.map((row) => (
              <tr key={row.customerId} className="border-b border-(--sim-line) align-top last:border-0">
                <th scope="row" className={cn(TD, "w-56 max-w-[14rem] text-left font-medium break-words")}>
                  {row.customerName}
                </th>
                {batch.channels.map((c) => (
                  <td key={c} className={cn(TD, "py-3")}>
                    {cell(row.customerName, row.customerId, row.results.find((r) => r.channel === c))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Panel>
  );
}
