"use server";

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { can } from "@/domain/permissions";
import type { IntegrationPanelData } from "@/domain/golive-types";
import type { ActionResult } from "@/domain/review-types";
import { db } from "@/server/db/client";
import { templates } from "@/server/db/schema/ucomp";
import { getIntegrationPanel } from "@/server/queries/integration";
import { getViewer } from "@/server/viewer";

// The integration panel loads when it opens (and on hover/focus of the ring, as a prefetch), so the
// headers that host it keep their props. Read-only: no refresh, no audit.

const REASONS = {
  noTemplate: "This template no longer exists.",
  noActive: "This template has no Active version yet.",
} as const;

const Input = z.object({ templateId: z.string().trim().min(1).max(64) });

/** "https://ucomp.example": the origin the page was requested on (behind a proxy, its forwarded host). */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "localhost:3000";
  const forwarded = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwarded || (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export async function loadIntegrationPanel(input: { templateId: string }): Promise<ActionResult<{ panel: IntegrationPanelData }>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, reason: REASONS.noTemplate };
  const { templateId } = parsed.data;

  const viewer = await getViewer();
  const [template] = await db
    .select({ teamId: templates.teamId })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1);
  if (!template) return { ok: false, reason: REASONS.noTemplate };

  const permitted = can(viewer, "integration.view", { teamId: template.teamId });
  if (!permitted.ok) return { ok: false, reason: permitted.reason };

  const panel = await getIntegrationPanel(templateId, await requestOrigin());
  return panel ? { ok: true, panel } : { ok: false, reason: REASONS.noActive };
}
