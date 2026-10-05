import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Stream } from "@/components/primitives/stream";
import { getSimLinkFlow } from "@/simulator/queries";
import { LinkFlow } from "@/simulator/ui/link-flow";
import { PageSkeleton } from "@/simulator/ui/page-frame";

export const metadata: Metadata = { title: "Link template" };

export default function SimLinkPage({ params, searchParams }: PageProps<"/sim/offers/[offerId]/link">) {
  return (
    <Stream fallback={<PageSkeleton panels={[5]} />}>
      <LinkStep params={params} searchParams={searchParams} />
    </Stream>
  );
}

async function LinkStep({
  params,
  searchParams,
}: {
  params: Promise<{ offerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { offerId } = await params;
  const { template } = await searchParams;
  const templateId = (Array.isArray(template) ? template[0] : template)?.trim() || null;
  const flow = await getSimLinkFlow(offerId, templateId);
  if (!flow) notFound();
  return <LinkFlow key={`${offerId}:${flow.candidate?.template.id ?? "search"}:${flow.candidate?.version ?? 0}`} flow={flow} />;
}
