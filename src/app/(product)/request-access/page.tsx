import { Stream } from "@/components/primitives/stream";
import { PageHeader } from "@/components/primitives/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamIcon } from "@/components/app-shell/team-icon";
import { getAllTeams } from "@/server/queries/teams";

const GRID = "grid grid-cols-3 gap-4";
const CARD = "flex min-h-40 flex-col gap-4 rounded-2xl border border-hairline bg-surface-tinted p-6";

async function TeamCards() {
  const teams = await getAllTeams();
  return (
    <div className={GRID}>
      {teams.map((team) => (
        <div key={team.slug} className={CARD}>
          <div className="grid size-10 place-items-center rounded-xl border border-hairline bg-surface">
            <TeamIcon name={team.icon} className="size-5 text-text" />
          </div>
          <div>
            <h2 className="text-[17px] leading-6 font-medium">{team.name}</h2>
            <p className="mt-1 text-sm leading-5 text-text-muted">{team.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamCardsSkeleton() {
  return (
    <div className={GRID} aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className={CARD}>
          <Skeleton className="size-10 rounded-xl" />
          <div>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2.5 h-3.5 w-full" />
            <Skeleton className="mt-1.5 h-3.5 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

// The request form is Phase 6. For now: the teams, as quiet cards.
export default function RequestAccessPage() {
  return (
    <div>
      <PageHeader title="Request access" />
      <Stream fallback={<TeamCardsSkeleton />}>
        <TeamCards />
      </Stream>
    </div>
  );
}
