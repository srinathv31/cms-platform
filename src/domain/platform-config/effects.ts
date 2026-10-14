// The audit row every platform settings change writes, and how it reads. The row stores the area and that area's
// facts, names as they were, never a sentence (decision 0055); `describeConfigChange` words it when the Audit page
// reads it. The catalogue of each area's facts is in docs/reference/data-model.md ("Payloads").

import { ROLE_LABEL } from "../access/roles";
import type { AccessEffect, PlatformArea } from "../access-types";
import { zoneLabel } from "../business-zone";
import { formatCount } from "../numbers";
import { pluralWord } from "../plural";
import { CHANNEL_LABELS, joinWithAnd } from "../render/errors";
import { CHANNELS, TEAM_ROLES, type Channel, type TeamRole } from "../types";

export function configChanged(
  area: PlatformArea,
  teamId: string | null,
  details: Record<string, unknown>,
): AccessEffect {
  return {
    kind: "audit",
    action: "platform.config_changed",
    teamId,
    details: { area, ...details },
  };
}

/**
 * What a `platform.config_changed` row says was done, as it continues its actor's name: "created team Payments
 * with Sam Ortiz as Team Admin", "turned off PDF for Disclosure: 2 Active versions stopped rendering to PDF".
 * null when the details don't word one (the Audit page then names the area). Details are JSON from the
 * database, so they are read defensively.
 */
export function describeConfigChange(
  details: Record<string, unknown>,
): string | null {
  const d = details;
  switch (d.area) {
    case "teams": {
      const [team, admin] = [d.teamName, d.userName].map(text);
      return team && admin
        ? `created team ${team} with ${admin} as Team Admin`
        : null;
    }

    case "content_types": {
      const type = text(d.contentTypeName);
      if (!type) return null;
      if (d.created === true) return `created content type ${type}`;
      const added = titles(d.added);
      const removed = titles(d.removed);
      const renamed = Array.isArray(d.renamed)
        ? d.renamed.flatMap((r: unknown) => {
            const { from, to } = (r ?? {}) as Record<string, unknown>;
            return text(from) && text(to) ? [`renamed ${from} to ${to}`] : [];
          })
        : [];
      const parts = [
        added.length ? `added ${joinWithAnd(added)}` : null,
        removed.length ? `removed ${joinWithAnd(removed)}` : null,
        ...renamed,
        d.reordered === true ? "reordered the sections" : null,
      ].filter((p): p is string => p !== null);
      return parts.length
        ? `changed ${type} required sections: ${parts.join("; ")}`
        : null;
    }

    case "channel_rules": {
      const type = text(d.contentTypeName);
      const channel = (CHANNELS as readonly unknown[]).includes(d.channel)
        ? CHANNEL_LABELS[d.channel as Channel]
        : null;
      if (!type || !channel || typeof d.allowed !== "boolean") return null;
      if (d.allowed) return `turned on ${channel} for ${type}`;
      const stopped =
        typeof d.activeUsing === "number" && d.activeUsing > 0
          ? `: ${formatCount(d.activeUsing)} Active ${pluralWord(d.activeUsing, "version stopped", "versions stopped")} rendering to ${channel}`
          : "";
      return `turned off ${channel} for ${type}${stopped}`;
    }

    case "approval_chains": {
      const type = text(d.contentTypeName);
      const stages = Array.isArray(d.stages)
        ? d.stages.map((s: unknown) => stageText(s))
        : [];
      return type && stages.length > 0 && stages.every((s) => s !== null)
        ? `set ${type} approval chain: ${stages.join(" → ")}`
        : null;
    }

    case "business_zone": {
      const zone = text(d.to);
      return zone ? `set the business time zone to ${zoneLabel(zone)}` : null;
    }

    default:
      return null;
  }
}

/** "Compliance (Approver role)", "Legal (Sam Ortiz)": a stage of a chain as its row stored it. */
function stageText(stage: unknown): string | null {
  const { name, rule, userName } = (stage ?? {}) as Record<string, unknown>;
  const { kind, role, userId } = (rule ?? {}) as Record<string, unknown>;
  if (!text(name)) return null;
  if (kind === "team_role" && TEAM_ROLES.includes(role as TeamRole))
    return `${name} (${ROLE_LABEL[role as TeamRole]} role)`;
  if (kind === "user" && text(userId))
    return `${name} (${text(userName) ?? userId})`;
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function titles(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v !== "")
    : [];
}
