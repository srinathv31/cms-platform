import type { Route } from "next";
import Link from "next/link";
import type { SimOfferCard } from "@/simulator/types";
import { Mono, Panel, Pill, TableWrap, TD, TH } from "./bits";
import { dayLabel, linkStatus, resultsHeadline, upgradeLabel } from "./format";

/** Coral's offers: one row each, with the link's state, any upgrade badge and the last send. */
export function OffersTable({ offers }: { offers: SimOfferCard[] }) {
  return (
    <Panel>
      <TableWrap>
        <table aria-label="Offers" className="w-full min-w-[44rem] border-collapse">
          <thead>
            <tr className="border-b border-(--sim-line) bg-(--sim-panel2)">
              <th className={TH}>Offer</th>
              <th className={TH}>Linked template</th>
              <th className={TH}>Pin</th>
              <th className={TH}>Link status</th>
              <th className={TH}>Last send</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => {
              const status = linkStatus(offer.link);
              return (
                <tr key={offer.id} className="border-b border-(--sim-line) last:border-0 hover:bg-(--sim-panel2)">
                  <td className={TD}>
                    <Link href={`/sim/offers/${offer.id}` as Route} className="font-medium text-(--sim-text) no-underline hover:underline">
                      {offer.name}
                    </Link>
                    <p className="m-0 mt-0.5 text-[12px] text-(--sim-muted)">{offer.headline}</p>
                  </td>
                  <td className={TD}>
                    {offer.link ? (
                      <>
                        <p className="m-0 text-(--sim-text)">{offer.link.templateName}</p>
                        <Mono className="text-(--sim-muted)">{offer.link.templateId}</Mono>
                      </>
                    ) : (
                      <span className="text-(--sim-muted)">None</span>
                    )}
                  </td>
                  <td className={TD}>{offer.link ? <Mono>v{offer.link.pinnedVersion}</Mono> : <span className="text-(--sim-muted)">None</span>}</td>
                  <td className={TD}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Pill tone={status.tone}>{status.label}</Pill>
                      {offer.upgrade ? <Pill tone="info">{upgradeLabel(offer.upgrade)}</Pill> : null}
                    </span>
                  </td>
                  <td className={TD}>
                    {offer.lastSend ? (
                      <>
                        <p className="m-0">{resultsHeadline(offer.lastSend)}</p>
                        <p className="m-0 text-[12px] text-(--sim-muted)">{dayLabel(offer.lastSend.at)}</p>
                      </>
                    ) : (
                      <span className="text-(--sim-muted)">Never</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </Panel>
  );
}
