import type { Metadata } from "next";
import { Stream } from "@/components/primitives/stream";
import { getSimHome } from "@/simulator/queries";
import { PageHeader, Strip } from "@/simulator/ui/bits";
import { NoticesPanel } from "@/simulator/ui/notices-panel";
import { PageScroll, PageSkeleton } from "@/simulator/ui/page-frame";

export const metadata: Metadata = { title: "Notices" };

export default function SimNoticesPage() {
  return (
    <Stream fallback={<PageSkeleton panels={[5]} />}>
      <Notices />
    </Stream>
  );
}

async function Notices() {
  const home = await getSimHome();
  const offerNames = Object.fromEntries(home.offers.map((o) => [o.id, o.name]));
  return (
    <PageScroll>
      <PageHeader crumbs="Coral Offers" title="Notices from UCOMP" />
      {home.apiError ? <Strip tone="bad">{home.apiError.message}</Strip> : null}
      <NoticesPanel title="Inbox" notices={home.notices} offerNames={offerNames} />
    </PageScroll>
  );
}
