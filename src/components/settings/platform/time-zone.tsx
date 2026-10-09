"use client";

import { useRef, useState } from "react";
import type { BusinessZoneSection } from "@/domain/access-types";
import { zoneLabel } from "@/domain/business-zone";
import { describeZoneChange } from "@/domain/platform-config";
import { Button } from "@/components/ui/button";
import { setBusinessZone } from "@/server/actions/platform";
import { Blocked, FullRow, HeaderRow, Pick, Strip, useFocusAfterCommit } from "./ui";

// Settings > Platform > Time zone: the business time zone a sunset date is read in (decision 0017). One
// row; "Change time zone" opens a picker of the zones on offer under it with the consequence strip. What
// the zone picked does comes from the domain as the admin picks (`describeZoneChange`); what stays put
// (the sunsets already set) comes decided in the read model's `consequences` (decision 0018).

const COLS = "minmax(0,1fr) minmax(0,1.4fr) 10rem";

export function TimeZoneSectionView({ section }: { section: BusinessZoneSection }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const focusAfter = useFocusAfterCommit();

  const close = () => {
    focusAfter(() => opener.current);
    setOpen(false);
  };

  return (
    <div data-slot="platform-section" data-section="time-zone" role="table" aria-label="Time zone">
      <HeaderRow cols={COLS} columns={["Setting", "Time zone", null]} />
      <div role="rowgroup" className="border-b border-hairline">
        <div role="row" className="grid min-h-16 items-center gap-x-4 py-2.5" style={{ gridTemplateColumns: COLS }}>
          <div role="cell" className="min-w-0">
            <div className="truncate text-[15px] font-medium text-text">Business time zone</div>
            <div className="truncate text-[13px] text-text-muted">For sunset dates</div>
          </div>
          <div role="cell" data-slot="business-zone" className="min-w-0 truncate text-[14px] text-text">
            {zoneLabel(section.zone)}
          </div>
          <div role="cell" className="flex justify-end">
            {open ? null : (
              <Blocked reason={section.can.change.ok ? null : section.can.change.reason}>
                <Button
                  ref={opener}
                  variant="outline"
                  aria-disabled={!section.can.change.ok}
                  className="aria-disabled:opacity-50"
                  onClick={() => section.can.change.ok && setOpen(true)}
                >
                  Change time zone
                </Button>
              </Blocked>
            )}
          </div>
        </div>
        {open ? (
          <FullRow span={3}>
            <ZoneEditor section={section} onClose={close} />
          </FullRow>
        ) : null}
      </div>
    </div>
  );
}

function ZoneEditor({ section, onClose }: { section: BusinessZoneSection; onClose: () => void }) {
  const [zone, setZone] = useState(section.zone);
  const change = describeZoneChange({ current: section.zone, next: zone });

  return (
    <Strip
      lines={change.changed && !change.problem ? [...change.lines, ...section.consequences] : []}
      confirmLabel="Change time zone"
      blocked={!change.changed || !!change.problem}
      message={change.problem}
      onConfirm={() => setBusinessZone({ zone })}
      onCancel={onClose}
      onDone={onClose}
      className="mb-3"
    >
      <Pick value={zone} onChange={setZone} label="Business time zone" className="w-80 max-w-full" autoFocus>
        {section.zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.label}
          </option>
        ))}
      </Pick>
    </Strip>
  );
}
