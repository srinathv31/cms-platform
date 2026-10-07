"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Clapperboard, FlaskConical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { advanceClockAction, resetDemoAction } from "@/server/actions/demo";
import { rememberSimReturn } from "./back-to-ucomp";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-dashed border-hairline-strong px-5 py-5">
      <h3 className="caps-label">{label}</h3>
      {children}
    </section>
  );
}

/**
 * A reset brings the seeded sidebar cards back: forget every card dismissal (`sidebar-card.tsx`
 * remembers them in localStorage as `ucomp:dismissed:<card id>`), and tell mounted cards.
 */
function clearCardDismissals() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith("ucomp:dismissed:")) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    /* storage blocked: nothing was remembered */
  }
  window.dispatchEvent(new Event("ucomp:card-dismissed"));
}

/**
 * Demo-only tools: a dashed pill, deliberately unlike the product's own controls.
 * `clock` is a server-rendered readout passed in as a slot.
 */
export function DemoPill({ clock }: { clock: React.ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Controlled, so the drawer closes when the presenter leaves for the simulator: the product's layout stays
  // mounted behind it (Next keeps visited routes alive), and "Back to Stencil" must not land on an open drawer.
  const [open, setOpen] = useState(false);

  const advance = (n: number) =>
    startTransition(async () => {
      await advanceClockAction(n);
    });

  const custom = Number(days);
  const customValid = Number.isInteger(custom) && custom >= 1 && custom <= 3650;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="fixed right-5 bottom-5 z-40 inline-flex h-8 items-center gap-2 rounded-full border border-dashed border-hairline-strong bg-surface px-3.5 text-xs font-medium text-text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Clapperboard aria-hidden strokeWidth={1.75} className="size-3.5" />
        Demo
      </SheetTrigger>
      <SheetContent side="right" className="w-[22rem] gap-0 border-l border-dashed border-hairline-strong sm:max-w-[22rem]">
        <SheetHeader className="px-5 pt-5 pb-5">
          <SheetTitle className="font-sans text-[15px] font-medium">Demo</SheetTitle>
          <SheetDescription className="sr-only">Tools for running the demo. Not part of the product.</SheetDescription>
        </SheetHeader>

        <Section label="Data">
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger
              render={
                <Button variant="outline" size="lg" className="justify-start gap-2.5 bg-surface px-3" />
              }
            >
              <RotateCcw aria-hidden strokeWidth={1.75} />
              Reset demo
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-sans">Reset demo?</AlertDialogTitle>
                <AlertDialogDescription>
                  Every template, review and change returns to the starting data, and you continue as Maya Chen.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={() => {
                    // Before the action: it redirects, so nothing after it is sure to run.
                    clearCardDismissals();
                    startTransition(async () => {
                      await resetDemoAction();
                    });
                  }}
                >
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Section>

        <Section label="Clock">
          {clock}
          <div className="flex gap-2">
            <Button variant="outline" size="lg" disabled={pending} onClick={() => advance(1)} className="bg-surface">
              +1 day
            </Button>
            <Button variant="outline" size="lg" disabled={pending} onClick={() => advance(15)} className="bg-surface">
              +15 days
            </Button>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (customValid) {
                advance(custom);
                setDays("");
              }
            }}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              aria-label="Days to advance"
              className="h-9 w-24 bg-surface"
            />
            <Button type="submit" variant="outline" size="lg" disabled={pending || !customValid} className="bg-surface">
              Advance
            </Button>
          </form>
        </Section>

        <Section label="Consumer simulator">
          <Button
            variant="outline"
            size="lg"
            nativeButton={false}
            render={
              <Link
                href="/sim"
                onClick={() => {
                  rememberSimReturn();
                  setOpen(false);
                }}
              />
            }
            className="justify-start gap-2.5 bg-surface px-3"
          >
            <FlaskConical aria-hidden strokeWidth={1.75} />
            Open simulator
          </Button>
        </Section>
      </SheetContent>
    </Sheet>
  );
}
