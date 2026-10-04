import { redirect } from "next/navigation";
import { DialogTitle } from "@/components/ui/dialog";
import { requireSpace, settingsAccessFor } from "@/server/queries/spaces";
import { findSection, groupOfSection } from "./sections";

/**
 * One settings section: serif title and a calm empty body. Phase 6 fills the body.
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

  return (
    <div data-slot="settings-panel" data-section={section}>
      <DialogTitle className="leading-none">
        <span className="display-lg">{meta.label}</span>
      </DialogTitle>
      <div className="mt-8 min-h-72" data-slot="settings-body" />
    </div>
  );
}
