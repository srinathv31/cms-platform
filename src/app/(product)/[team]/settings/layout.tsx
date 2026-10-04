import { LibraryView } from "@/components/library/library-view";
import { SettingsShell } from "@/components/settings/settings-shell";

// Hard navigation (reload, shared link): the same dialog, over the library.
export default function SettingsLayout({ children, params }: LayoutProps<"/[team]/settings">) {
  return (
    <>
      <LibraryView params={params} />
      <SettingsShell params={params} closeMode="library">
        {children}
      </SettingsShell>
    </>
  );
}
