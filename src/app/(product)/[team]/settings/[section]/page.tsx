import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPanel } from "@/components/settings/settings-panel";

// The dialog renders through a portal that only mounts on the client, so this page is never part of
// the server-rendered shell (same as the intercepted route). Skip the instant-navigation check, or every
// section action's refresh logs a dev error.
export const instant = false;

export default function SettingsPage({ params }: PageProps<"/[team]/settings/[section]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[34px] w-48" />}>
      <SettingsPanel params={params} />
    </Suspense>
  );
}
