import { redirect } from "next/navigation";
import { DialogTitle } from "@/components/ui/dialog";
import { requireSpace, settingsAccessFor } from "@/server/queries/spaces";
import { findSection, groupOfSection } from "./sections";
import type { SectionBody } from "./section-body";
import { PLATFORM_SECTION_BODIES } from "./platform";
import { TEAM_SECTION_BODIES } from "./team";

const BODIES: Record<string, SectionBody> = { ...TEAM_SECTION_BODIES, ...PLATFORM_SECTION_BODIES };

/**
 * One settings section: serif title, then the section's body from its group's registry.
 * Unknown or not-permitted sections go back to the library.
 */
export async function SettingsPanel({
  params,
}: {
  params: Promise<{ team: string; section: string }>;
}) {
  const { team, section } = await params;
  const space = await requireSpace(team);
  const meta = findSection(section);
  const group = groupOfSection(section);
  const access = settingsAccessFor(space.viewer, space.slug);
  if (!meta || !group || !access[group]) redirect(`/${space.slug}/library`);
  const Body = BODIES[section];

  return (
    <div data-slot="settings-panel" data-section={section}>
      <DialogTitle className="leading-none">
        <span className="display-lg">{meta.label}</span>
      </DialogTitle>
      <div className="mt-8 min-h-72" data-slot="settings-body">
        {Body ? <Body teamSlug={space.slug} /> : null}
      </div>
    </div>
  );
}
