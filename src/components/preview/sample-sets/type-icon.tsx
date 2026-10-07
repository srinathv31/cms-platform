// A variable type's outline icon: the same set the editor's chips, panel and form use, picked from
// the type's `TYPE_META.icon` key.

import { Calendar, DollarSign, Hash, MapPin, Percent, Type, type LucideIcon } from "lucide-react";
import type { VariableType } from "@/editor/model/types";
import { TYPE_META, type VariableIconKey } from "@/editor/model/variables";
import { cn } from "@/lib/utils";

const ICONS: Record<VariableIconKey, LucideIcon> = {
  type: Type,
  "dollar-sign": DollarSign,
  percent: Percent,
  calendar: Calendar,
  hash: Hash,
  "map-pin": MapPin,
};

export function TypeIcon({ type, className }: { type: VariableType; className?: string }) {
  const Icon = ICONS[TYPE_META[type].icon];
  return <Icon aria-hidden strokeWidth={1.75} className={cn("size-3.5 shrink-0 text-text-muted", className)} />;
}
