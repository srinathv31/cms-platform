import { cn } from "@/lib/utils";
import { WS } from "@/components/workspace/workspace-grid";
import { now } from "@/server/clock";
import { getVersions } from "@/server/queries/versions";
import { CompareVersions } from "./compare-dialog";
import type { VersionContext } from "./version-actions";
import { TOOLBAR } from "./versions-skeleton";
import { VersionEntry } from "./version-entry";

/**
 * The Versions tab: the open draft (if any) and every version, newest first, as a calm timeline.
 * Compare sits above it, in a row that is there for every template (empty, with fewer than two
 * versions to compare), so the timeline starts at the same place whatever the template has and the
 * skeleton, which can't know, has the same geometry. Reads inside the page's <Stream>.
 */
export async function VersionsContent({
  params,
}: {
  params: Promise<{ team: string; templateId: string }>;
}) {
  const { team, templateId } = await params;
  const data = await getVersions(team, templateId);
  const nowDate = await now();

  const ctx: VersionContext = {
    templateId: data.template.id,
    activeNumber: data.items.find((v) => v.state === "active")?.number ?? null,
    usage: data.consumerUsage,
    sunsetCalendar: data.sunsetCalendar,
    nowIso: nowDate.toISOString(),
  };

  return (
    <section data-slot="versions" aria-label="Versions" className={cn(WS.doc, "flex flex-col")}>
      <div data-slot="versions-toolbar" className={TOOLBAR}>
        <CompareVersions templateId={data.template.id} options={data.compareOptions} />
      </div>
      {data.items.length === 0 ? (
        <p className="text-[14px] text-text-muted">No versions yet.</p>
      ) : (
        <ol className="flex flex-col">
          {data.items.map((item, i) => (
            <VersionEntry key={item.id} item={item} ctx={ctx} space={team} now={nowDate} last={i === data.items.length - 1} />
          ))}
        </ol>
      )}
    </section>
  );
}
