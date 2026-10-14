import { redirect } from "next/navigation";
import { Stream } from "@/components/primitives/stream";
import { getShell } from "@/server/queries/spaces";

async function GoHome(): Promise<never> {
  // The first space the viewer may switch to (All teams for a platform role, else their first team by name).
  const [space] = (await getShell()).spaces;
  redirect(space ? `/${space.slug}/library` : "/request-access");
}

/** "/" sends everyone to their own space (or to request access when they have none). */
export default function HomePage() {
  return (
    <Stream fallback={<div className="min-h-[60vh]" />}>
      <GoHome />
    </Stream>
  );
}
