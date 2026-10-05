// Version rules for consumer renders (CMS previews skip them). Pure TypeScript.
//
//   active                      renders
//   superseded, before sunset   renders, and the response names the newer (Active) version
//   superseded, sunset passed   410 version_sunset
//   revoked                     410 version_revoked
//   in_review, changes_requested, draft
//                               409 version_not_released

import type { VersionState } from "../types";
import { versionNotReleased, versionRevoked, versionSunset } from "./errors";
import type { RenderError } from "./types";

export interface VersionFacts {
  number: number;
  state: VersionState;
  sunsetAt: Date | null;
  revokedAt: Date | null;
}

export type VersionCheck = { ok: true; newerVersion: number | null } | { ok: false; error: RenderError };

export function checkVersion(input: { version: VersionFacts; activeNumber: number | null; now: Date }): VersionCheck {
  const { version, activeNumber, now } = input;

  switch (version.state) {
    case "active":
      return { ok: true, newerVersion: null };

    case "superseded":
      if (version.sunsetAt && version.sunsetAt.getTime() <= now.getTime()) {
        return { ok: false, error: versionSunset(version.number, version.sunsetAt, activeNumber) };
      }
      return { ok: true, newerVersion: activeNumber };

    case "revoked":
      return { ok: false, error: versionRevoked(version.number, version.revokedAt, activeNumber) };

    case "in_review":
    case "changes_requested":
    case "draft":
      return { ok: false, error: versionNotReleased(version.number, version.state, activeNumber) };
  }
}
