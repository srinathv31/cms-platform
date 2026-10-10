import type { Metadata } from "next";
import { Stream } from "@/components/primitives/stream";
import { PageHeader, Panel, TableWrap, TD, TH } from "@/simulator/ui/bits";
import { PLATFORM_LABEL, phoneLabel } from "@/simulator/ui/format";
import { getSimCustomers } from "@/simulator/ui/lists";
import { PageScroll, PageSkeleton } from "@/simulator/ui/page-frame";

export const metadata: Metadata = { title: "Customers" };

export default function SimCustomersPage() {
  return (
    <Stream fallback={<PageSkeleton panels={[10]} />}>
      <Customers />
    </Stream>
  );
}

async function Customers() {
  const customers = await getSimCustomers();
  return (
    <PageScroll>
      <PageHeader crumbs="Coral Offers" title="Customers" />
      <Panel>
        <TableWrap>
          <table aria-label="Customers" className="w-full min-w-[40rem] border-collapse">
            <thead>
              <tr className="border-b border-(--sim-line) bg-(--sim-panel2)">
                <th className={TH}>Customer</th>
                <th className={TH}>Email</th>
                <th className={TH}>Phone</th>
                <th className={TH}>State</th>
                <th className={`${TH} text-right`}>Purchase APR</th>
                <th className={`${TH} text-right`}>Annual fee</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-(--sim-line) align-top last:border-0">
                  <td className={`${TD} max-w-[16rem] break-words`}>{c.name}</td>
                  <td className={`${TD} max-w-[16rem] break-all text-(--sim-muted)`}>{c.email}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <span className="tabular-nums">{phoneLabel(c.phone)}</span>
                    <span className="block text-[12px] text-(--sim-muted)">{PLATFORM_LABEL[c.platform]}</span>
                  </td>
                  <td className={`${TD} text-(--sim-muted)`}>{c.homeState}</td>
                  <td className={`${TD} text-right tabular-nums`}>{c.purchaseApr}%</td>
                  <td className={`${TD} text-right tabular-nums`}>{c.annualFee === null ? "None" : `$${Number(c.annualFee).toLocaleString("en-US")}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Panel>
    </PageScroll>
  );
}
