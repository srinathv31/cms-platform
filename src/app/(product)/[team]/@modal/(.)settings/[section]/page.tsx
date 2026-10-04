import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPanel } from "@/components/settings/settings-panel";

// The dialog renders through a portal that only mounts on the client, so this page is never part of
// the server-rendered shell. Skip the instant-navigation check for it.
export const instant = false;

export default function SettingsModalPage({
  params,
}: {
  params: Promise<{ team: string; section: string }>;
}) {
  return (
    <Suspense fallback={<Skeleton className="h-[34px] w-48" />}>
      <SettingsPanel params={params} />
    </Suspense>
  );
}
