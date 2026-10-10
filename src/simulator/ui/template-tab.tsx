import type { Route } from "next";
import type { SimOfferPage } from "@/simulator/types";
import { Mono, Panel, Pill } from "./bits";
import { NavButton } from "./nav-button";
import { channelList, dayLabel, linkStatus } from "./format";

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-9 grid-cols-[9rem_minmax(0,1fr)] items-center gap-3 border-b border-(--sim-line) px-4 py-2 text-[13px] last:border-0">
      <dt className="text-(--sim-muted)">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

/** Template tab: what the offer is linked to, and the offer's own terms (the fields a mapping can read). */
export function TemplateTab({ page }: { page: SimOfferPage }) {
  const { link, offer } = page;
  const status = linkStatus(link);
  const linkHref = `/sim/offers/${offer.id}/link` as Route;
  const t = offer.terms;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(20rem,1fr))] items-start gap-5">
      <Panel
        title="Linked template"
        right={
          link ? (
            <NavButton href={linkHref} className="h-7">
              Change template
            </NavButton>
          ) : null
        }
      >
        {link ? (
          <dl className="m-0">
            <Row label="Template">
              <span className="block truncate">{link.templateName}</span>
              <Mono className="text-(--sim-muted)">{link.templateId}</Mono>
            </Row>
            <Row label="Pinned version">
              <span className="flex items-center gap-2">
                <Mono>v{link.pinnedVersion}</Mono>
                <Pill tone={status.tone}>{status.label}</Pill>
              </span>
            </Row>
            <Row label="Channels">{channelList(link.channels)}</Row>
            <Row label="Linked">{dayLabel(link.linkedAt)}</Row>
          </dl>
        ) : (
          <div className="flex items-center justify-between gap-4 p-4">
            <span className="text-[13px] text-(--sim-muted)">No template linked.</span>
            <NavButton href={linkHref} kind="primary">
              Link template
            </NavButton>
          </div>
        )}
      </Panel>
      {t ? (
        <Panel title="Offer terms">
          <dl className="m-0">
            <Row label="Spend">{money(t.spend)}</Row>
            <Row label="Bonus">{money(t.bonus)}</Row>
            <Row label="Months">{t.months}</Row>
            <Row label="Annual fee">{t.annualFee === undefined ? <span className="text-(--sim-muted)">None</span> : money(t.annualFee)}</Row>
            <Row label="Ends on">{t.endsOn ? dayLabel(t.endsOn) : <span className="text-(--sim-muted)">None</span>}</Row>
          </dl>
        </Panel>
      ) : (
        <Panel title="Alert">
          <dl className="m-0">
            <Row label="Sent when">{offer.headline}</Row>
          </dl>
        </Panel>
      )}
    </div>
  );
}
