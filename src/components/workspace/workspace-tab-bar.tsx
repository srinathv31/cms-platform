import { Suspense } from "react";
import { Stream } from "@/components/primitives/stream";
import { getWorkspaceHeader } from "@/server/queries/workspace";
import { EditButton, RailToggle } from "./workspace-actions";
import { WS } from "./workspace-grid";
import { WorkspaceTabs, WorkspaceTabsSkeleton } from "./workspace-tabs";

type Params = Promise<{ team: string; templateId: string }>;

/**
 * Content / Versions / Usage / Activity over a hairline, with the template's actions at the right
 * end of the same line. The bar stays stuck to the top while the document scrolls, which keeps the
 * black button in reach. The tabs need only the route; the actions wait for the template.
 */
export function WorkspaceTabBar({ params }: { params: Params }) {
  return (
    <div data-slot="tab-bar" className={WS.tabs}>
      <Stream fallback={<WorkspaceTabsSkeleton />}>
        {params.then(({ team, templateId }) => (
          <WorkspaceTabs base={`/${team}/templates/${templateId}`} />
        ))}
      </Stream>
      <div className="flex h-11 shrink-0 items-center gap-2">
        {/* Reads which tab is selected; the boundary keeps it out of the static shell if that is ever dynamic. */}
        <Suspense fallback={null}>
          <RailToggle />
        </Suspense>
        {/* Nothing to hold the place of: the button appears in free space at the right end. */}
        <Stream fallback={<span aria-hidden />}>
          <TemplateActions params={params} />
        </Stream>
      </div>
    </div>
  );
}

/**
 * The one black button the state calls for. Today only Edit, on an Active template the viewer can
 * edit. A draft has none until Submit for review (Phase 4), and Preview comes in Phase 3, so a
 * viewer, or a draft, shows no button rather than a dead one.
 */
async function TemplateActions({ params }: { params: Params }) {
  const { team, templateId } = await params;
  const t = await getWorkspaceHeader(team, templateId);
  return t.canStartDraft ? <EditButton templateId={t.id} /> : null;
}
