"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PaletteResults } from "@/domain/import-types";
import { normalizePaletteQuery } from "@/domain/palette";
import type { Refused } from "@/domain/refusals";
import { emptyPaletteCache, nearestAnswer, paletteAskKey, withAnswer, type PaletteAsk } from "./palette-cache";

// The palette's side of GET /api/palette/{space}: nothing is asked until the palette opens. Each
// opening asks once for what it shows, at once for the resting list and after a pause in typing for a
// search, and shows what the cache has meanwhile. The cache is one viewer's (`palette-cache.ts`);
// `CommandPalette` mounts a new palette, with a new cache, when the viewer changes.

/** How long typing pauses before the search is asked. */
export const SEARCH_PAUSE_MS = 150;

/** `/api/palette/coral-offers?q=cash&template=UC-4F7K2Q` */
export function paletteUrl(ask: Pick<PaletteAsk, "space" | "current" | "query">): string {
  const params = new URLSearchParams();
  if (ask.query) params.set("q", ask.query);
  if (ask.current) params.set("template", ask.current);
  const search = params.toString();
  return `/api/palette/${encodeURIComponent(ask.space)}${search ? `?${search}` : ""}`;
}

/** The route's answer. Throws when it is a refusal or not an answer at all (no network, an error page). */
async function readPalette(ask: PaletteAsk): Promise<PaletteResults> {
  const url = paletteUrl(ask);
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  const body = (await response.json()) as ({ ok: true } & PaletteResults) | Refused;
  if (body.ok !== true) throw new Error(`GET ${url} answered ${response.status}.`);
  return {
    viewerId: body.viewerId,
    space: body.space,
    query: body.query,
    canCreate: body.canCreate,
    current: body.current,
    recent: body.recent,
    templates: body.templates,
  };
}

export interface PaletteView {
  /** The answer to show: the one to what was typed, or an earlier one to narrow (`exact` false). Null when none has come. */
  results: PaletteResults | null;
  exact: boolean;
  /** Asking for what was typed failed; the palette lists what it can without the answer. */
  failed: boolean;
}

export function usePaletteResults({
  viewerId,
  space,
  current,
  query,
  open,
}: {
  viewerId: string;
  space: string;
  current: string | null;
  query: string;
  open: boolean;
}): PaletteView {
  const normalized = normalizePaletteQuery(query);
  const ask = useMemo<PaletteAsk>(() => ({ viewerId, space, current, query: normalized }), [viewerId, space, current, normalized]);
  const key = paletteAskKey(ask);
  const [cache, setCache] = useState(() => emptyPaletteCache(viewerId));
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  /** Which opening this is, and in which one each question was last asked. */
  const opening = useRef(0);
  const asked = useRef(new Map<string, number>());

  useEffect(() => {
    if (open) opening.current += 1;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(
      () => {
        const round = opening.current;
        if (asked.current.get(key) === round) return;
        asked.current.set(key, round);
        readPalette(ask)
          .then((results) => {
            // Read for somebody else (the persona changed while it was asked): never kept, never shown.
            if (results.viewerId !== ask.viewerId) throw new Error("Answered for another viewer.");
            setCache((now) => withAnswer(now, ask, results));
            setFailed((now) => (now.has(key) ? new Set([...now].filter((k) => k !== key)) : now));
          })
          .catch(() => {
            asked.current.delete(key); // the next opening asks again
            setFailed((now) => new Set(now).add(key));
          });
      },
      ask.query ? SEARCH_PAUSE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [open, ask, key]);

  const near = nearestAnswer(cache, ask);
  return { results: near?.results ?? null, exact: near?.exact ?? false, failed: failed.has(key) && !near?.exact };
}
