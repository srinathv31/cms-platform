"use client";

import { useSyncExternalStore } from "react";

// Resolved token values are read from the live CSS custom properties, so this page never
// carries a hex of its own. Server render shows no value; the client fills it in on hydration.
const noopSubscribe = () => () => {};

function useTokenValue(cssVar: string) {
  return useSyncExternalStore(
    noopSubscribe,
    () => getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim(),
    () => "",
  );
}

function Value({ cssVar }: { cssVar: string }) {
  const value = useTokenValue(cssVar);
  return <span className="font-mono text-[11px] leading-4 text-text-subtle uppercase">{value || "\u00A0"}</span>;
}

export function Swatch({ cssVar, name }: { cssVar: string; name: string }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <div
        aria-hidden
        className="h-14 rounded-lg border border-hairline"
        style={{ background: `var(${cssVar})` }}
      />
      <figcaption className="flex flex-col">
        <span className="truncate text-[13px] leading-5 font-medium text-text">{name}</span>
        <span className="truncate font-mono text-[11px] leading-4 text-text-muted">{cssVar}</span>
        <Value cssVar={cssVar} />
      </figcaption>
    </figure>
  );
}

/** A status tone is three tokens (fill, text, border), so it is shown as the badge colors in use. */
export function StatusSwatch({ tone }: { tone: string }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <div
        aria-hidden
        className="grid h-14 place-items-center rounded-lg border text-[15px] font-medium"
        style={{
          background: `var(--status-${tone}-bg)`,
          color: `var(--status-${tone}-text)`,
          borderColor: `var(--status-${tone}-border)`,
        }}
      >
        Aa
      </div>
      <figcaption className="flex flex-col">
        <span className="truncate text-[13px] leading-5 font-medium text-text">{tone}</span>
        <span className="truncate font-mono text-[11px] leading-4 text-text-muted">--status-{tone}-*</span>
        <span className="flex gap-1.5">
          <Value cssVar={`--status-${tone}-bg`} />
        </span>
      </figcaption>
    </figure>
  );
}
