import type { Metadata } from "next";
import { Check } from "lucide-react";
import { PageHeader } from "@/components/primitives/page-header";
import { StatCard } from "@/components/primitives/stat-card";
import { TemplateId } from "@/components/primitives/template-id";
import { StatusBadge } from "@/components/primitives/status-badge";
import { ShareRing } from "@/components/signature/share-ring";
import { Buttons, Controls, StatusBadges } from "./controls";
import { HeaderMock } from "./header-mock";
import { Group, Section } from "./section";
import { ColorTokens, Surfaces } from "./surfaces";
import { PairingSpecimen } from "./type-pairings";

export const metadata: Metadata = { title: "Design" };

const TEMPLATE_ID = "UC-4F7K2Q";

const ID_STYLES = [{ key: "C", name: "Labeled", variant: "labeled" }] as const;

export default function DesignPage() {
  return (
    <div className="min-h-screen bg-app p-(--canvas-inset)">
      <main className="rounded-4xl border border-hairline bg-canvas px-6 pt-14 pb-20 lg:px-(--canvas-pad-x)">
        <div className="mx-auto max-w-[82.5rem]">
          <PageHeader title="Design" className="pb-12">
            <p className="mt-2 max-w-xl text-[15px] leading-6 text-text-muted">
              Type, color, surfaces and the SHARE ring, on real UCOMP content.
            </p>
          </PageHeader>

          <Section
            id="type"
            label="Type"
            note="Newsreader for titles, Figtree for the interface, Geist Mono for keys."
          >
            <div className="max-w-2xl">
              <PairingSpecimen pairing="b" />
            </div>
          </Section>

          <Section
            id="template-id"
            label="Template ID"
            note="Labeled, with copy. Used in the workspace header and the integration panel."
          >
            <div className="flex flex-col gap-6">
              {ID_STYLES.map((s) => (
                <div key={s.key} className="grid items-center gap-4 lg:grid-cols-[6.5rem_minmax(0,1fr)]">
                  <div className="flex items-center gap-2.5 text-[13px] leading-5 font-medium text-text">
                    <span
                      aria-hidden
                      className="inline-grid size-6 place-items-center rounded-full bg-tan text-[12px] text-label"
                    >
                      {s.key}
                    </span>
                    {s.name}
                  </div>
                  <TemplateIdHeader />
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="share-ring"
            label="SHARE ring"
            note="The one playful moment. Hover or tab to it."
          >
            <div className="flex flex-col gap-6">
              {[64, 76, 88].map((size) => (
                <Group
                  key={size}
                  title={`${size}px`}
                  aside={size === 76 ? "Default" : undefined}
                >
                  <HeaderMock ring={<ShareRing size={size} />} />
                </Group>
              ))}
            </div>

            <Group title="Now live" aside="The reprise when a version goes live; it then settles into the header">
              <div className="flex flex-wrap items-center gap-x-16 gap-y-8 rounded-2xl border border-hairline bg-canvas px-10 py-9">
                <figure className="m-0 flex flex-col items-center gap-3">
                  <ShareRing
                    size={76}
                    text="NOW LIVE"
                    repeat={2}
                    icon={<Check />}
                    label="Now live"
                  />
                  <figcaption className="text-[13px] leading-5 text-text-muted">76px</figcaption>
                </figure>
                <figure className="m-0 flex flex-col items-center gap-3">
                  <ShareRing size={132} text="NOW LIVE" repeat={2} icon={<Check />} label="Now live" />
                  <figcaption className="text-[13px] leading-5 text-text-muted">Centered, 132px</figcaption>
                </figure>
                <figure className="m-0 flex flex-col items-center gap-3">
                  <ShareRing size={176} />
                  <figcaption className="text-[13px] leading-5 text-text-muted">SHARE at 176px, for detail</figcaption>
                </figure>
              </div>
            </Group>
          </Section>

          <Section id="stat-card" label="Stat cards" note="A tracked label over a regular-weight numeral.">
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                label="Renders this month"
                value={12480}
                trend="12% this month"
                footnote="Up from 11,140 in August"
              />
              <StatCard label="Templates" value={42} footnote="Across 3 teams" />
              <StatCard
                label="Revocations"
                value={1}
                trend="1 this quarter"
                trendTone="negative"
                footnote="Coral Offers"
              />
            </div>
          </Section>

          <Section id="status" label="Status badges" note="The only way a lifecycle state is shown.">
            <StatusBadges />
          </Section>

          <Section id="buttons" label="Buttons" note="One black button per screen.">
            <Buttons />
          </Section>

          <Section id="controls" label="Keycaps and controls">
            <Controls />
          </Section>

          <Section id="surfaces" label="Surfaces" note="Warm neutrals. Hairline borders. Radius by role.">
            <Surfaces />
          </Section>

          <Section id="color" label="Color tokens" note="Values are read live from the CSS tokens.">
            <ColorTokens />
          </Section>
        </div>
      </main>
    </div>
  );
}

/** The chosen Template ID treatment (style C) in a header-sized row. */
function TemplateIdHeader() {
  return (
    <div className="flex items-center justify-between gap-8 rounded-2xl border border-hairline bg-canvas px-8 py-6">
      <div className="flex min-w-0 items-center gap-4">
        <h3 className="display-lg truncate text-text">Coral Rewards card disclosure</h3>
        <StatusBadge state="active" />
      </div>
      <TemplateId id={TEMPLATE_ID} />
    </div>
  );
}
