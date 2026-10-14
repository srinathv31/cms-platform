// What "Revert to v3" reads: GET /api/templates/[templateId]/base-version?draft=<version id> answers the versions
// service's facts as they are (`VersionService.baseVersion` in src/server/services/versions.ts): the content of
// the version the draft on screen was started from. The client puts it on screen and saves it through autosave
// like any other edit (so the toast can undo it), which keeps the permission, rev and audit rules in one place.
// Types only, under the name the header reads it by.

export type { BaseVersionFacts as BaseVersionContent } from "@/server/services/versions";
