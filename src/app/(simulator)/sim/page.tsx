import type { Route } from "next";
import Link from "next/link";
import type { Metadata } from "next";
import { Stream } from "@/components/primitives/stream";
import { getSimHome } from "@/simulator/queries";
import { PageHeader, Strip } from "@/simulator/ui/bits";
import { NoticesPanel } from "@/simulator/ui/notices-panel";
import { OffersTable } from "@/simulator/ui/offers-table";
import { PageScroll, PageSkeleton } from "@/simulator/ui/page-frame";

export const metadata: Metadata = { title: "Offers" };

const HOME_NOTICES = 3;

export default function SimHomePage() {
  return (
    <Stream fallback={<PageSkeleton panels={[4, 2, 3]} />}>
      <Home />
    </Stream>
  );
}

async function Home() {
  const home = await getSimHome();
  const offerNames = Object.fromEntries(home.offers.map((o) => [o.id, o.name]));
  return (
    <PageScroll>
      <PageHeader crumbs="Coral Offers" title="Offers" />
      {home.apiError ? <Strip tone="bad">{home.apiError.message}</Strip> : null}
      <OffersTable offers={home.offers.filter((o) => o.kind === "offer")} />
      <OffersTable kind="alert" offers={home.offers.filter((o) => o.kind === "alert")} />
      <NoticesPanel
        notices={home.notices.slice(0, HOME_NOTICES)}
        offerNames={offerNames}
        footer={
          home.notices.length > HOME_NOTICES ? (
            <div className="border-t border-(--sim-line) px-4 py-2.5 text-[13px]">
              <Link href={"/sim/notices" as Route} className="text-(--sim-info)">
                All {home.notices.length} notices
              </Link>
            </div>
          ) : null
        }
      />
    </PageScroll>
  );
}
