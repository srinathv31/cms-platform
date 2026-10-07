import type { Metadata } from "next";
import { BackToUcomp } from "@/components/demo/back-to-ucomp";
import { DemoPillHole } from "@/components/demo/demo-pill-hole";
import { Stream } from "@/components/primitives/stream";
import { NavList, SimNav } from "@/simulator/ui/nav";
import { NoticeBadge } from "@/simulator/ui/notice-badge";
import "@/simulator/theme.css";

export const metadata: Metadata = { title: { absolute: "Coral Offers (simulated)" } };

/*
 * The frame is UCOMP's (warm stone, dashed): the "← Back to Stencil" pill (to where the simulator was
 * opened) and the "Coral — simulated" label mark the boundary. Everything under it is Coral's own system in its own look (src/simulator/theme.css).
 * The Demo pill is mounted here too, so the presenter can move the clock without leaving Coral.
 */
export default function SimulatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-app">
      <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-dashed border-hairline-strong bg-app px-3">
        <BackToUcomp />
        <span className="rounded-md border border-dashed border-hairline-strong px-2.5 py-1 text-[12px] font-semibold tracking-wider text-label uppercase">
          Coral — simulated
        </span>
        <span aria-hidden className="w-[8.5rem]" />
      </header>
      <div data-sim className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col bg-(--sim-nav) text-(--sim-nav-text)">
          <div className="flex h-14 items-center gap-2.5 px-5">
            <span aria-hidden className="grid size-7 place-items-center rounded-md bg-(--sim-accent) text-[15px] font-bold text-(--sim-accent-text)">
              c
            </span>
            <span className="text-[16px] font-semibold tracking-tight text-(--sim-nav-on)">coral</span>
            <span className="rounded-(--sim-rs) bg-(--sim-nav-active) px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-(--sim-nav-muted) uppercase">
              Ops
            </span>
          </div>
          <Stream fallback={<NavList pathname={null} noticesBadge={null} />}>
            <SimNav
              noticesBadge={
                <Stream fallback={null}>
                  <NoticeBadge />
                </Stream>
              }
            />
          </Stream>
          <div className="mt-auto border-t border-(--sim-nav-hover) p-4 text-[12px] text-(--sim-nav-muted)">
            <p className="m-0 text-(--sim-nav-on)">Dana Whitfield</p>
            <p className="m-0">Offers operations</p>
          </div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1">{children}</main>
      </div>
      <DemoPillHole />
    </div>
  );
}
