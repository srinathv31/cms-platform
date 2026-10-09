import {
  Briefcase,
  Building2,
  Car,
  CreditCard,
  Gift,
  Home,
  Landmark,
  Layers,
  Megaphone,
  PiggyBank,
  Receipt,
  ReceiptText,
  Scale,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { TEAM_ICONS } from "@/domain/platform-config";

// `teams.icon` holds a Lucide key. The keys a team can pick (`TEAM_ICONS`, which `createTeam` checks)
// each have an icon and the name the picker reads out; a typed record, so a key added there needs an
// icon here. A few keys older rows may hold still draw. Anything else draws a building.

const PICKABLE: Readonly<Record<(typeof TEAM_ICONS)[number], { Icon: LucideIcon; label: string }>> = {
  "credit-card": { Icon: CreditCard, label: "Credit card" },
  "piggy-bank": { Icon: PiggyBank, label: "Piggy bank" },
  "receipt-text": { Icon: ReceiptText, label: "Receipt" },
  landmark: { Icon: Landmark, label: "Bank" },
  wallet: { Icon: Wallet, label: "Wallet" },
  home: { Icon: Home, label: "Home" },
  car: { Icon: Car, label: "Car" },
  briefcase: { Icon: Briefcase, label: "Briefcase" },
  "shield-check": { Icon: ShieldCheck, label: "Shield" },
  scale: { Icon: Scale, label: "Scale" },
  megaphone: { Icon: Megaphone, label: "Megaphone" },
  "building-2": { Icon: Building2, label: "Building" },
};

const OLDER: Readonly<Record<string, LucideIcon>> = {
  layers: Layers,
  users: Users,
  building: Building2,
  sparkles: Sparkles,
  tag: Tag,
  tags: Tag,
  gift: Gift,
  bank: Landmark,
  receipt: Receipt,
};

function pickable(name: string) {
  return Object.hasOwn(PICKABLE, name) ? PICKABLE[name as keyof typeof PICKABLE] : undefined;
}

/** A team's icon. Decorative: the team's name is always beside it. */
export function TeamIcon({ name, className }: { name: string; className?: string }) {
  const Icon = pickable(name)?.Icon ?? (Object.hasOwn(OLDER, name) ? OLDER[name] : Building2);
  return <Icon aria-hidden strokeWidth={1.75} className={className} />;
}

/** What the icon picker calls an icon ("Piggy bank"). An unknown key reads as itself. */
export function teamIconLabel(name: string): string {
  return pickable(name)?.label ?? name;
}
