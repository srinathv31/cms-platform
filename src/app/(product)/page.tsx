import { redirect } from "next/navigation";
import { Stream } from "@/components/primitives/stream";
import { defaultSpace } from "@/domain/permissions";
import { requireRequestContext } from "@/server/context/request";

async function GoHome(): Promise<never> {
  const { viewer } = await requireRequestContext();
  const space = defaultSpace(viewer);
  redirect(space ? `/${space}/library` : "/request-access");
}

/** "/" sends everyone to their own space (or to request access when they have none). */
export default function HomePage() {
  return (
    <Stream fallback={<div className="min-h-[60vh]" />}>
      <GoHome />
    </Stream>
  );
}
