// The audit row every platform settings change writes.

import type { AccessEffect, PlatformArea } from "../access-types";

export function configChanged(
  area: PlatformArea,
  teamId: string | null,
  summary: string,
  details: Record<string, unknown>,
): AccessEffect {
  return {
    kind: "audit",
    action: "platform.config_changed",
    teamId,
    details: { area, summary, ...details },
  };
}
