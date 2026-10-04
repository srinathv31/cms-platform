import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/primitives/status-badge";
import { TemplateId } from "@/components/primitives/template-id";

/** A workspace header as it will appear on a template: serif title, status, ID, and (optionally) the ring. */
export function HeaderMock({
  ring,
  idSlot = <TemplateId id="UC-4F7K2Q" />,
  className,
}: {
  /** Top-right slot: the SHARE ring. */
  ring?: React.ReactNode;
  /** The template ID treatment, shown beside the status badge. */
  idSlot?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-8 rounded-2xl border border-hairline bg-canvas px-8 py-6",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="display-xl truncate text-text">Coral Rewards card disclosure</h3>
        <div className="mt-2 flex items-center gap-3">
          <StatusBadge state="active" />
          {idSlot}
          <span className="text-[13px] leading-5 text-text-muted">Version 2 · Edited 2 hours ago</span>
        </div>
      </div>
      {ring ? <div className="shrink-0">{ring}</div> : null}
    </div>
  );
}
