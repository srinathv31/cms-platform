import { requireSpaceFromParams } from "@/server/queries/spaces";

/** The team's name above the page title ("Coral Offers", "All teams"). Reads inside a <Stream>. */
export async function UsageEyebrow({ params }: { params: Promise<{ team: string }> }) {
  const space = await requireSpaceFromParams(params);
  return <>{space.name}</>;
}
