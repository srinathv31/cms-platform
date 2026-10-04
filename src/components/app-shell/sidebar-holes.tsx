import { getShell } from "@/server/queries/spaces";
import { SidebarBody } from "./sidebar-body";
import { TeamSwitcher } from "./team-switcher";

// Persona-dependent parts of the sidebar. Rendered inside <Stream> boundaries by the frame.

export async function TeamSwitcherHole() {
  const { spaces } = await getShell();
  return <TeamSwitcher spaces={spaces} />;
}

export async function SidebarBodyHole() {
  const { spaces } = await getShell();
  return <SidebarBody spaces={spaces} />;
}
