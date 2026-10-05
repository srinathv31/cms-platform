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

// teams.icon holds a lucide key. Unknown keys fall back to a neutral glyph.
const ICONS: Record<string, LucideIcon> = {
  layers: Layers,
  users: Users,
  building: Building2,
  "building-2": Building2,
  sparkles: Sparkles,
  tag: Tag,
  tags: Tag,
  gift: Gift,
  landmark: Landmark,
  bank: Landmark,
  "piggy-bank": PiggyBank,
  wallet: Wallet,
  "credit-card": CreditCard,
  receipt: Receipt,
  "receipt-text": ReceiptText,
  home: Home,
  car: Car,
  briefcase: Briefcase,
  "shield-check": ShieldCheck,
  scale: Scale,
  megaphone: Megaphone,
};

export function TeamIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICONS[name] ?? Building2;
  return <Icon aria-hidden strokeWidth={1.75} className={className} />;
}
