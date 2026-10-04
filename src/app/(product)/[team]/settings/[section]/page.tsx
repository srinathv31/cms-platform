import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPanel } from "@/components/settings/settings-panel";

export default function SettingsPage({ params }: PageProps<"/[team]/settings/[section]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[34px] w-48" />}>
      <SettingsPanel params={params} />
    </Suspense>
  );
}
