import { DEMO_MODE } from "@/server/config";
import { requireRequestContext } from "@/server/context/request";
import { getShell } from "@/server/queries/spaces";
import { getPersonaSummaries } from "@/server/queries/personas";
import { getNotificationsData } from "@/server/queries/notifications";
import { CommandPalette } from "./command-palette";
import { NotificationsPopover } from "./notifications-popover";
import { ProfileMenu } from "./profile-menu";

/**
 * Search, bell and profile. Everything here depends on who is looking, so it streams. The palette gets
 * no templates: it asks GET /api/palette/{space} when it opens, so no page carries the catalog.
 */
export async function TopBarHole() {
  const [viewer, shell, personas, notifications] = await Promise.all([
    requireRequestContext().then((context) => context.viewer),
    getShell(),
    getPersonaSummaries(),
    getNotificationsData(),
  ]);
  const me = personas.find((p) => p.id === viewer.userId) ?? {
    id: viewer.userId,
    name: viewer.name,
    initials: viewer.initials,
    hue: 0,
    summary: "",
  };

  return (
    <div className="flex items-center gap-2">
      {shell.spaces.length > 0 ? (
        <CommandPalette viewerId={viewer.userId} spaces={shell.spaces} />
      ) : null}
      <NotificationsPopover data={notifications} />
      <ProfileMenu
        me={me}
        // The switcher is a demo tool (decision 0051). Request time: the viewer is read above.
        personas={DEMO_MODE ? personas : null}
        canRequestAccess={shell.canRequestAccess.ok}
      />
    </div>
  );
}
