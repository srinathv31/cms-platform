import type { ComponentType } from "react";

// The contract between the settings panel and a section's body. Each group owns its registry
// (team/index.tsx, platform/index.tsx), so the two groups are built without touching the same file.

export interface SectionBodyProps {
  /** The space the modal opened in: a team slug, or "all" (Platform group only). */
  teamSlug: string;
}

/** A section body: usually an async server component that reads its query inside the panel's Suspense. */
export type SectionBody = ComponentType<SectionBodyProps>;
