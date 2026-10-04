"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRailOpen, useWorkspaceSession } from "../session/workspace-session";
import { WS } from "../workspace-grid";

/**
 * The rail: Channels above Variables, a flush strip beside the header, tabs and document with its own
 * scroll. Wide canvas: always there. Narrow: closed until the tab bar's toggle opens it over the
 * right edge; Esc or the close button puts it away.
 *
 * `children` are the sections after Channels (Variables today, Email details later sit under the
 * Email channel).
 */
export function Rail({ channels, children }: { channels: React.ReactNode; children: React.ReactNode }) {
  const session = useWorkspaceSession();
  const open = useRailOpen();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") session.setRailOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, session]);

  return (
    <aside aria-label="Channels and variables" data-slot="rail" data-open={open ? "" : undefined} className={WS.rail}>
      <div className="flex h-6 items-center justify-between px-2">
        <div className="caps-label">Channels</div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          className="-mr-1.5 @min-[53rem]:hidden"
          onClick={() => session.setRailOpen(false)}
        >
          <X strokeWidth={1.75} />
        </Button>
      </div>
      <div className="mt-3 px-2">{channels}</div>
      <div className="mt-8">{children}</div>
    </aside>
  );
}
