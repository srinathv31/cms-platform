import type { JSONContent } from "@/domain/types";
import { disclosure } from "../seed/content";

/** Just the content type's three required H2 sections, in order. */
export function blankBody(scope: string): JSONContent {
  return disclosure(scope, { offer: [], rates: [], legal: [] });
}
