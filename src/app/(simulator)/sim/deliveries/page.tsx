import type { Route } from "next";
import type { Metadata } from "next";
import Link from "next/link";
import { Stream } from "@/components/primitives/stream";
import { Mono, PageHeader, Panel, TableWrap, TD, TH } from "@/simulator/ui/bits";
import { plural, resultsHeadline, whenLabel } from "@/simulator/ui/format";
import { getSimBatches } from "@/simulator/ui/lists";
import { PageScroll, PageSkeleton } from "@/simulator/ui/page-frame";

export const metadata: Metadata = { title: "Deliveries" };

export default function SimDeliveriesPage() {
  return (
    <Stream fallback={<PageSkeleton panels={[4]} />}>
      <Deliveries />
    </Stream>
  );
}

async function Deliveries() {
  const batches = await getSimBatches();
  return (
    <PageScroll>
      <PageHeader crumbs="Coral Offers" title="Deliveries" />
      <Panel>
        {batches.length === 0 ? (
          <p className="m-0 px-4 py-6 text-[13px] text-(--sim-muted)">Nothing sent yet.</p>
        ) : (
          <TableWrap>
            <table aria-label="Sends" className="w-full min-w-[40rem] border-collapse">
              <thead>
                <tr className="border-b border-(--sim-line) bg-(--sim-panel2)">
                  <th className={TH}>Sent</th>
                  <th className={TH}>Offer</th>
                  <th className={TH}>Template</th>
                  <th className={TH}>Customers</th>
                  <th className={TH}>Result</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-(--sim-line) last:border-0">
                    <td className={`${TD} text-(--sim-muted)`}>{whenLabel(b.at)}</td>
                    <td className={TD}>
                      <Link href={`/sim/offers/${b.offerId}` as Route} className="text-(--sim-text) no-underline hover:underline">
                        {b.offerName}
                      </Link>
                    </td>
                    <td className={TD}>
                      <Mono>{b.templateId ?? "None"}</Mono>
                      {b.versionNumber ? <Mono className="text-(--sim-muted)"> · v{b.versionNumber}</Mono> : null}
                    </td>
                    <td className={TD}>{plural(b.customers, "customer", "customers")}</td>
                    <td className={TD}>{resultsHeadline({ delivered: b.delivered, failed: b.failed })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </PageScroll>
  );
}
