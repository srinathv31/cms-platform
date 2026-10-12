import { Suspense } from "react";
import { requireSpaceFromParams } from "@/server/queries/spaces";

/** Not found for an unknown team or one the viewer can't see. Renders nothing; pages guard themselves too. */
async function TeamGuard({ params }: { params: Promise<{ team: string }> }) {
  await requireSpaceFromParams(params);
  return null;
}

export default function TeamLayout({
  children,
  modal,
  params,
}: LayoutProps<"/[team]">) {
  return (
    <>
      <Suspense fallback={null}>
        <TeamGuard params={params} />
      </Suspense>
      {children}
      {modal}
    </>
  );
}
