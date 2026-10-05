"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DevBar } from "./dev-bar";
import { useSim, type SimInitial } from "./use-sim";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

/*
 * The frame is UCOMP's (warm stone, dashed): the "← Back to UCOMP" pill and the "Coral — simulated"
 * label mark the boundary. Everything below it is Coral's own system, in its own look.
 */
export function SimMock({ initial }: { initial: SimInitial }) {
  const s = useSim(initial);
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-app">
      {s.chrome ? (
        <DevBar
          variant={s.variant}
          onVariant={s.setVariant}
          screen={s.screen}
          onScreen={s.setScreen}
          scenario={s.scenario}
          onScenario={s.setScenario}
          view={s.view}
          onView={s.setView}
          onReset={() => {
            s.setRelinked(false);
            s.setFeeField("");
            s.setSent(false);
            s.setScreen("offers");
          }}
        />
      ) : null}
      <div className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-dashed border-hairline-strong bg-app px-3">
        <Link
          href="/"
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-text px-3.5 text-[13px] font-medium text-surface outline-none hover:bg-text/90 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden strokeWidth={1.75} className="size-4" />
          Back to UCOMP
        </Link>
        <span className="rounded-md border border-dashed border-hairline-strong px-2.5 py-1 text-[12px] font-medium tracking-wider text-label uppercase">
          Coral — simulated
        </span>
        <span className="w-[8.5rem]" />
      </div>
      <div className="min-h-0 flex-1">
        {s.variant === "a" ? <VariantA s={s} /> : s.variant === "b" ? <VariantB s={s} /> : <VariantC s={s} />}
      </div>
    </div>
  );
}
