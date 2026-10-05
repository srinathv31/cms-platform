import { Cog } from "lucide-react";
import { UserAvatar } from "@/components/app-shell/user-avatar";
import { cn } from "@/lib/utils";
import { WS } from "@/components/workspace/workspace-grid";
import type { ActivityItem } from "@/domain/review-types";
import { formatRelative, formatStamp } from "@/components/versions/format";
import { now } from "@/server/clock";
import { getActivity } from "@/server/queries/activity";
import { Stamp } from "./stamp";
import { dayGroups } from "./day-groups";

/** Who did it: their avatar, or a quiet gear for the system. */
function Actor({ actor }: { actor: ActivityItem["actor"] }) {
  if (actor) return <UserAvatar initials={actor.initials} hue={actor.hue} size="sm" />;
  return (
    <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-tinted text-text-muted">
      <Cog strokeWidth={1.75} className="size-3.5" />
    </span>
  );
}

/** The sentence, with the actor's name set in medium weight (it opens every sentence). */
function Sentence({ item }: { item: ActivityItem }) {
  const name = item.actor?.name;
  if (name && item.summary.startsWith(name)) {
    return (
      <>
        <span className="font-medium">{name}</span>
        {item.summary.slice(name.length)}
      </>
    );
  }
  return <>{item.summary}</>;
}

/**
 * The Activity tab: the template's audit trail as sentences, newest first, grouped by day under quiet
 * labels. Each row: who, what happened, the version, and when (relative on the demo clock; the
 * absolute time, in UTC, on hover or focus). Days are UTC days, like every absolute date on these tabs.
 * Reads inside the page's <Stream>.
 */
export async function ActivityContent({
  params,
}: {
  params: Promise<{ team: string; templateId: string }>;
}) {
  const { team, templateId } = await params;
  const items = await getActivity(team, templateId);
  const nowDate = await now();
  const groups = dayGroups(items, nowDate);

  return (
    <section data-slot="activity" aria-label="Activity" className={cn(WS.doc, "flex flex-col gap-8")}>
      {groups.length === 0 ? (
        <p className="text-[14px] text-text-muted">No activity yet.</p>
      ) : (
        groups.map((group) => (
          <div key={group.key} data-slot="activity-day">
            <h2 className="caps-label mb-1.5">{group.label}</h2>
            <ul className="flex flex-col divide-y divide-hairline">
              {group.items.map((item) => (
                <li key={item.id} className="flex items-start gap-3 py-3">
                  <Actor actor={item.actor} />
                  {/* A long note or reason stops at two lines; the Versions tab has all of it. */}
                  <p className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-6 text-text">
                    <Sentence item={item} />
                  </p>
                  {item.versionNumber !== null ? (
                    <span className="flex h-6 shrink-0 items-center rounded-md border border-hairline bg-surface-sunken px-1.5 text-[12px] font-medium text-text-muted">
                      v{item.versionNumber}
                    </span>
                  ) : null}
                  <span className="flex h-6 w-24 shrink-0 items-center justify-end">
                    <Stamp iso={item.at} relative={formatRelative(item.at, nowDate)} absolute={formatStamp(item.at)} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
