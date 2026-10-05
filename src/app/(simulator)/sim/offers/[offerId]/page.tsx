import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Stream } from "@/components/primitives/stream";
import { getSimOfferPage } from "@/simulator/queries";
import { OfferView, type OfferTab } from "@/simulator/ui/offer-view";
import { PageSkeleton } from "@/simulator/ui/page-frame";

export const metadata: Metadata = { title: "Offer" };

export default function SimOfferPage({ params }: PageProps<"/sim/offers/[offerId]">) {
  return (
    <Stream fallback={<PageSkeleton panels={[4, 3]} />}>
      <Offer params={params} />
    </Stream>
  );
}

async function Offer({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const page = await getSimOfferPage(offerId);
  if (!page) notFound();

  // A linked offer opens on Send, or on Values while required values are unmapped; an unlinked one on Template.
  // (?tab= overrides it; the client reads that itself.)
  const defaultTab: OfferTab = !page.link ? "template" : page.blocked ? "values" : "send";

  return <OfferView page={page} defaultTab={defaultTab} offerNames={{ [page.offer.id]: page.offer.name }} />;
}
