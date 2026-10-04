import {
  Building2,
  CreditCard,
  Gift,
  Landmark,
  Layers,
  PiggyBank,
  Receipt,
  ReceiptText,
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
