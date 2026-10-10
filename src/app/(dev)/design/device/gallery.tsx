"use client";

import { useState, type ReactNode } from "react";
import {
  PushPreview,
  SCREEN_SIZES,
  SmsPreview,
  type DeviceSettings,
  type FieldFit,
  type PushContent,
  type PushMeasure,
  type PushScreen,
} from "@/components/device";
import { PageHeader } from "@/components/primitives/page-header";
import { Segmented } from "@/components/primitives/segmented";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Group, Section } from "../section";
import { CLOCK, PUSH, PUSH_LONG, SETTINGS, SMS } from "./fixtures";
import { ControlsRow, Well, type RailState } from "./rail-mock";

// The phone kit (src/components/device) on fixture data: a working rail mock to try every option in,
// then each view side by side at 1:1, in light and dark, at each text size and width, and inside the
// tightest preview well (469 × 581, a 1280 × 800 window).

/** The preview wells measured in the running app: 1440 × 900 and 1280 × 800 windows. */
const WELLS = { wide: { width: 563, height: 681 }, tight: { width: 469, height: 581 } } as const;

/** How tall a 1:1 specimen is: about the wide well's inner height. */
const SPECIMEN_HEIGHT = 640;

type View = { key: string; label: string; screen: PushScreen | "sms"; hidden?: boolean };

const VIEWS: View[] = [
  { key: "lock", label: "Lock screen", screen: "lock" },
  { key: "hidden", label: "Lock screen, previews hidden", screen: "lock", hidden: true },
  { key: "banner", label: "Banner", screen: "banner" },
  { key: "expanded", label: "Expanded", screen: "expanded" },
  { key: "sms", label: "Messages", screen: "sms" },
];

/** A phone at 1:1: its container is exactly the frame's width, so one point is one pixel. */
function Specimen({
  settings,
  view,
  content = PUSH,
  height = SPECIMEN_HEIGHT,
  onMeasure,
}: {
  settings: DeviceSettings;
  view: View;
  content?: PushContent;
  height?: number;
  onMeasure?: (m: PushMeasure) => void;
}) {
  const size = SCREEN_SIZES[settings.platform][settings.width];
  return (
    <div data-specimen={view.key} style={{ width: size.width + 20, height }} className="shrink-0">
      {view.screen === "sms" ? (
        <SmsPreview settings={settings} content={SMS} clock={CLOCK} />
      ) : (
        <PushPreview
          settings={{ ...settings, previewsHidden: Boolean(view.hidden) }}
          screen={view.screen}
          content={content}
          clock={CLOCK}
          onMeasure={onMeasure}
        />
      )}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-x-8 gap-y-10">{children}</div>;
}

export function DeviceGallery() {
  return (
    <div className="min-h-screen bg-app p-(--canvas-inset)">
      <main className="rounded-4xl border border-hairline bg-canvas px-6 pt-14 pb-20 lg:px-(--canvas-pad-x)">
        <div className="mx-auto max-w-[82.5rem]">
          <PageHeader title="Phone previews" className="pb-12">
            <p className="mt-2 max-w-xl text-[15px] leading-6 text-text-muted">
              Push and SMS on an iOS-style phone, from <code className="font-mono text-[13px]">src/components/device</code>.
              Fixture data only.
            </p>
          </PageHeader>

          <Section id="playground" label="Playground" note="The rail's controls row and well, at either window size. Click the notification to expand it.">
            <Playground />
          </Section>

          {(["light", "dark"] as const).map((appearance) => (
            <Section
              key={appearance}
              id={`views-${appearance}`}
              label={appearance === "light" ? "Views, light" : "Views, dark"}
              note="At 1:1 on a 402pt phone."
            >
              <Row>
                {VIEWS.map((view) => (
                  <Group key={view.key} title={view.label}>
                    <Specimen settings={{ ...SETTINGS, appearance }} view={view} />
                  </Group>
                ))}
              </Row>
            </Section>
          ))}

          <Section id="truncation" label="Truncation" note="One long notification on each screen, with what onMeasure reports.">
            <Row>
              {VIEWS.slice(0, 4)
                .filter((v) => !v.hidden)
                .map((view) => (
                  <MeasuredSpecimen key={view.key} view={view} />
                ))}
            </Row>
          </Section>

          <Section id="text-size" label="Text size" note="Default (Large), Large (xxxLarge) and AX (AX1). The clock doesn't scale.">
            <Row>
              {(["default", "large", "ax"] as const).flatMap((textSize) =>
                [VIEWS[0]!, VIEWS[4]!].map((view) => (
                  <Group key={`${textSize}-${view.key}`} title={`${view.label}, ${textSize === "ax" ? "AX" : textSize}`}>
                    <Specimen settings={{ ...SETTINGS, textSize }} view={view} content={PUSH_LONG} />
                  </Group>
                )),
              )}
            </Row>
          </Section>

          <Section id="width" label="Width" note="375, 402 and 440 points.">
            <Row>
              {(["compact", "standard", "large"] as const).map((width) => (
                <Group key={width} title={`${width[0]!.toUpperCase()}${width.slice(1)}, ${SCREEN_SIZES.ios[width].width}pt`}>
                  <Specimen settings={{ ...SETTINGS, width }} view={VIEWS[0]!} content={PUSH_LONG} />
                </Group>
              ))}
            </Row>
          </Section>

          <Section id="tight-well" label="Tightest well" note="469 × 581, a 1280 × 800 window. The large width scales down to fit.">
            <Row>
              {[
                { view: VIEWS[0]!, settings: SETTINGS },
                { view: VIEWS[2]!, settings: SETTINGS },
                { view: VIEWS[3]!, settings: SETTINGS },
                { view: VIEWS[4]!, settings: SETTINGS },
                { view: VIEWS[0]!, settings: { ...SETTINGS, appearance: "dark" as const } },
                { view: VIEWS[4]!, settings: { ...SETTINGS, appearance: "dark" as const } },
                { view: VIEWS[0]!, settings: { ...SETTINGS, width: "large" as const } },
                { view: VIEWS[0]!, settings: { ...SETTINGS, textSize: "ax" as const } },
              ].map(({ view, settings }, i) => (
                <Group key={i} title={`${view.label}, ${settings.appearance}, ${settings.width}${settings.textSize === "ax" ? ", AX" : ""}`}>
                  <div data-tight-well={i}>
                    <TightWell view={view} settings={settings} />
                  </div>
                </Group>
              ))}
            </Row>
          </Section>
        </div>
      </main>
    </div>
  );
}

/** A view in the 469 × 581 well, under a static controls row. */
function TightWell({ view, settings }: { view: View; settings: DeviceSettings }) {
  const [state, setState] = useState<RailState>({
    channel: view.screen === "sms" ? "sms" : "push",
    screen: view.screen === "sms" ? "lock" : view.screen,
    settings,
  });
  return (
    <div className="flex flex-col gap-3" style={{ width: WELLS.tight.width }}>
      <ControlsRow state={state} onChange={setState} />
      <Well {...WELLS.tight}>
        {state.channel === "sms" ? (
          <SmsPreview settings={state.settings} content={SMS} clock={CLOCK} />
        ) : (
          <PushPreview
            settings={state.settings}
            screen={state.screen}
            content={PUSH}
            clock={CLOCK}
            onScreenChange={(screen) => setState((s) => ({ ...s, screen }))}
          />
        )}
      </Well>
    </div>
  );
}

/** The interactive rail: every option, the content editable, and the measurement printed beside it. */
function Playground() {
  const [state, setState] = useState<RailState>({ channel: "push", screen: "lock", settings: SETTINGS });
  const [windowSize, setWindowSize] = useState<keyof typeof WELLS>("wide");
  const [content, setContent] = useState(PUSH);
  const [sms, setSms] = useState(SMS);
  const [measure, setMeasure] = useState<PushMeasure | null>(null);
  const well = WELLS[windowSize];

  return (
    <div className="flex flex-wrap items-start gap-10">
      <div className="flex flex-col gap-3" style={{ width: well.width }}>
        <ControlsRow state={state} onChange={setState} />
        <Well {...well}>
          {state.channel === "sms" ? (
            <SmsPreview settings={state.settings} content={sms} clock={CLOCK} />
          ) : (
            <PushPreview
              settings={state.settings}
              screen={state.screen}
              content={content}
              clock={CLOCK}
              onScreenChange={(screen) => setState((s) => ({ ...s, screen }))}
              onMeasure={setMeasure}
            />
          )}
        </Well>
      </div>

      <div className="flex w-[22rem] flex-col gap-5">
        <Segmented
          label="Window"
          value={windowSize}
          options={[
            { value: "wide", label: "1440 × 900" },
            { value: "tight", label: "1280 × 800" },
          ]}
          onChange={setWindowSize}
        />
        {state.channel === "push" ? (
          <>
            <Field label="Title">
              <Input value={content.title} onChange={(e) => setContent({ ...content, title: e.target.value })} />
            </Field>
            <Field label="Subtitle">
              <Input value={content.subtitle ?? ""} onChange={(e) => setContent({ ...content, subtitle: e.target.value })} />
            </Field>
            <Field label="Body">
              <Textarea rows={5} value={content.body} onChange={(e) => setContent({ ...content, body: e.target.value })} />
            </Field>
            {measure ? <MeasureTable measure={measure} /> : null}
          </>
        ) : (
          <Field label="Message">
            <Textarea rows={6} value={sms.text} onChange={(e) => setSms({ ...sms, text: e.target.value })} />
          </Field>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] leading-5 font-medium text-text">{label}</span>
      {children}
    </label>
  );
}

/** A long notification on one screen, with its measurement under it. */
function MeasuredSpecimen({ view }: { view: View }) {
  const [measure, setMeasure] = useState<PushMeasure | null>(null);
  return (
    <Group title={view.label}>
      <Specimen settings={SETTINGS} view={view} content={PUSH_LONG} onMeasure={setMeasure} height={560} />
      <div style={{ width: SCREEN_SIZES.ios.standard.width + 20 }}>{measure ? <MeasureTable measure={measure} /> : null}</div>
    </Group>
  );
}

const FIELDS = ["title", "subtitle", "body"] as const;

function MeasureTable({ measure }: { measure: PushMeasure }) {
  return (
    <table data-measure={measure.screen} className="w-full text-left text-[13px] leading-5">
      <thead className="text-text-muted">
        <tr>
          <th className="py-1 pr-3 font-normal">Field</th>
          <th className="py-1 pr-3 font-normal">Lines</th>
          <th className="py-1 font-normal">Cuts after</th>
        </tr>
      </thead>
      <tbody className="text-text">
        {FIELDS.map((name) => {
          const fit: FieldFit | null = measure[name];
          if (!fit) return null;
          return (
            <tr key={name} className="border-t border-hairline align-top">
              <td className="py-1.5 pr-3 capitalize">{name}</td>
              <td className="py-1.5 pr-3 tabular-nums">{fit.shown ? `${fit.lines} of ${fit.maxLines}` : "Hidden"}</td>
              <td className="py-1.5 text-text-muted">{fit.cut ? `…${fit.visibleText.slice(-28)}` : fit.shown ? "Not cut" : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
