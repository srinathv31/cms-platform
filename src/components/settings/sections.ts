import {
  Building2,
  GitMerge,
  Globe,
  Hourglass,
  Inbox,
  ShieldCheck,
  Shapes,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

// The settings modal's navigation. Section keys are the URL segment: /{team}/settings/{section}.

export type SettingsGroupKey = "team" | "platform";

export interface SettingsSection {
  key: string;
  label: string;
  icon: LucideIcon;
}

export interface SettingsGroup {
  key: SettingsGroupKey;
  label: string;
  sections: SettingsSection[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    key: "team",
    label: "Team",
    sections: [
      { key: "members", label: "Members", icon: Users },
      { key: "access-requests", label: "Access requests", icon: Inbox },
      { key: "recertification", label: "Recertification", icon: ShieldCheck },
      { key: "inactivity", label: "Inactivity", icon: Hourglass },
    ],
  },
  {
    key: "platform",
    label: "Platform",
    sections: [
      { key: "teams", label: "Teams", icon: Building2 },
      { key: "content-types", label: "Content types", icon: Shapes },
      { key: "channel-rules", label: "Channel rules", icon: SlidersHorizontal },
      { key: "approval-chains", label: "Approval chains", icon: GitMerge },
      { key: "time-zone", label: "Time zone", icon: Globe },
    ],
  },
];

export interface SettingsAccessLike {
  team: boolean;
  platform: boolean;
}

/** Only the groups this viewer may use. */
export function visibleGroups(access: SettingsAccessLike): SettingsGroup[] {
  return SETTINGS_GROUPS.filter((g) => access[g.key]);
}

export function firstSettingsSection(access: SettingsAccessLike): string | null {
  return visibleGroups(access)[0]?.sections[0]?.key ?? null;
}

export function findSection(key: string): SettingsSection | undefined {
  return SETTINGS_GROUPS.flatMap((g) => g.sections).find((s) => s.key === key);
}

export function groupOfSection(key: string): SettingsGroupKey | undefined {
  return SETTINGS_GROUPS.find((g) => g.sections.some((s) => s.key === key))?.key;
}
