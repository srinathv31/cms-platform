import { SettingsShell } from "@/components/settings/settings-shell";

// Intercepted: opens over the page the user is on. The dialog chrome lives here, in a layout,
// so it stays mounted (and the nav pill keeps sliding) while sections change.
export default function SettingsModalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ team: string }>;
}) {
  return (
    <SettingsShell params={params} closeMode="back">
      {children}
    </SettingsShell>
  );
}
