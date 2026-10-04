// Variable type → lucide icon. Presentational and server-safe (no hooks).

import { Calendar, DollarSign, Hash, MapPin, Percent, Type, type LucideIcon } from "lucide-react";
import type { VariableType } from "../model/types";

/** Mirrors TYPE_META[type].icon from the pure model. */
export const TYPE_ICONS: Record<VariableType, LucideIcon> = {
  text: Type,
  currency: DollarSign,
  percent: Percent,
  date: Calendar,
  number: Hash,
  us_state: MapPin,
};
