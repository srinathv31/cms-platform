"use client";

import { useState, type ReactNode } from "react";
import {
  PushPreview,
  SCREEN_SIZES,
  SIZE_UNIT,
  SmsPreview,
  frameSize,
  pushScreenLabel,
  type DeviceAppearance,
  type DevicePlatform,
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
import { ControlsRow, WELL_FIT, Well, type RailState } from "./rail-mock";

// The phone kit (src/components/device) on fixture data: a working rail mock to try every option in,
// iPhone and Android side by side, then each view at 1:1 per platform, in light and dark, at each text size
// and width, and inside the tightest preview well (469 × 581, a 1280 × 800 window).

/** The preview wells measured in the running app: 1440 × 900, 1280 × 800, and 1000 × 700 (the rail's overlay). */
const WELLS = {
  wide: { width: 563, height: 681 },
  tight: { width: 469, height: 581 },
  overlay: { width: 682, height: 481 },
} as const;

/**
 * The box a specimen draws at 1:1 in: its own phone's size, and never smaller than the platform's standard
 * phone, which is what the kit scales a smaller phone against (so a compact phone sits in a standard one's box).
 */
function specimenBox(platform: DevicePlatform, width: DeviceSettings["width"]) {
  const own = frameSize(platform, width);
  const standard = frameSize(platform, "standard");
  return { width: Math.max(own.width, standard.width), height: Math.max(own.height, standard.height) };
}

const PLATFORMS: DevicePlatform[] = ["ios", "android"];
const PLATFORM_NAMES: Record<DevicePlatform, string> = { ios: "iPhone", android: "Android" };
const APPEARANCES: DeviceAppearance[] = ["light", "dark"];

type ViewKey = "lock" | "hidden" | "banner" | "expanded" | "sms";
type View = { key: ViewKey; screen: PushScreen | "sms"; hidden?: boolean };

const VIEWS: View[] = [
  { key: "lock", screen: "lock" },
  { key: "hidden", screen: "lock", hidden: true },
  { key: "banner", screen: "banner" },
  { key: "expanded", screen: "expanded" },
  { key: "sms", screen: "sms" },
];
const view = (key: ViewKey) => VIEWS.find((v) => v.key === key)!;

/** A view's name on a platform: "Banner" on iPhone is "Heads-up" on Android. */
function viewLabel(platform: DevicePlatform, v: View): string {
  if (v.screen === "sms") return "Messages";
  const name = pushScreenLabel(platform, v.screen);
  return v.hidden ? `${name}, previews hidden` : name;
}

/** A phone at 1:1: its box fits the whole phone, so one point is one pixel. */
function Specimen({
  settings,
  view: v,
  content = PUSH,
  onMeasure,
}: {
  settings: DeviceSettings;
  view: View;
  content?: PushContent;
  onMeasure?: (m: PushMeasure) => void;
}) {
  return (
    <div
      data-specimen={v.key}
      data-platform={settings.platform}
      data-appearance={settings.appearance}
      style={specimenBox(settings.platform, settings.width)}
      className="shrink-0"
    >
      {v.screen === "sms" ? (
        <SmsPreview settings={settings} content={SMS} clock={CLOCK} />
      ) : (
        <PushPreview
          settings={{ ...settings, previewsHidden: Boolean(v.hidden) }}
          screen={v.screen}
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

const settingsFor = (platform: DevicePlatform, patch: Partial<DeviceSettings> = {}): DeviceSettings => ({
  ...SETTINGS,
  platform,
  ...patch,
});

export function DeviceGallery() {
  return (
    <div className="min-h-screen bg-app p-(--canvas-inset)">
      <main className="rounded-4xl border border-hairline bg-canvas px-6 pt-14 pb-20 lg:px-(--canvas-pad-x)">
        <div className="mx-auto max-w-[82.5rem]">
          <PageHeader title="Phone previews" className="pb-12">
            <p className="mt-2 max-w-xl text-[15px] leading-6 text-text-muted">
              Push and SMS on iOS-style and Android-style phones, from{" "}
              <code className="font-mono text-[13px]">src/components/device</code>. Fixture data only.
            </p>
          </PageHeader>

          <Section id="playground" label="Playground" note="The rail's controls row and well, at each window size. Click the notification to expand it.">
            <Playground />
          </Section>

          <Section id="compare" label="Side by side" note="One alert on both phones. Android shows a single line of text and never the subtitle.">
            <Row>
              {[view("lock"), view("sms")].flatMap((v) =>
                PLATFORMS.map((platform) => (
                  <Group key={`${v.key}-${platform}`} title={`${viewLabel(platform, v)}, ${PLATFORM_NAMES[platform]}`}>
                    <div data-compare={`${v.key}-${platform}`}>
                      <Specimen settings={settingsFor(platform)} view={v} />
                    </div>
                  </Group>
                )),
              )}
            </Row>
          </Section>

          {PLATFORMS.flatMap((platform) =>
            APPEARANCES.map((appearance) => (
              <Section
                key={`${platform}-${appearance}`}
                id={`views-${platform}-${appearance}`}
                label={`${PLATFORM_NAMES[platform]}, ${appearance}`}
                note={`At 1:1 on a ${SCREEN_SIZES[platform].standard.width}${SIZE_UNIT[platform]} phone.`}
              >
                <Row>
                  {VIEWS.map((v) => (
                    <Group key={v.key} title={viewLabel(platform, v)}>
                      <Specimen settings={settingsFor(platform, { appearance })} view={v} />
                    </Group>
                  ))}
                </Row>
              </Section>
            )),
          )}

          <Section id="truncation" label="Truncation" note="One long notification on each screen, with what onMeasure reports.">
            <div className="flex flex-col gap-14">
              {PLATFORMS.map((platform) => (
                <Row key={platform}>
                  {[view("lock"), view("hidden"), view("banner"), view("expanded")].map((v) => (
                    <MeasuredSpecimen key={v.key} platform={platform} view={v} />
                  ))}
                </Row>
              ))}
            </div>
          </Section>

          <Section id="text-size" label="Text size" note="iPhone: Large, xxxLarge, AX1. Android: 100%, 130%, 200% (non-linear). The clock doesn't scale.">
            <div className="flex flex-col gap-14">
              {PLATFORMS.map((platform) => (
                <Row key={platform}>
                  {(["default", "large", "ax"] as const).flatMap((textSize) =>
                    [view("lock"), view("sms")].map((v) => (
                      <Group key={`${textSize}-${v.key}`} title={`${PLATFORM_NAMES[platform]}, ${viewLabel(platform, v)}, ${textSize === "ax" ? "AX" : textSize}`}>
                        <Specimen settings={settingsFor(platform, { textSize })} view={v} content={PUSH_LONG} />
                      </Group>
                    )),
                  )}
                </Row>
              ))}
            </div>
          </Section>

          <Section id="width" label="Width" note="iPhone 375, 402 and 440pt; Android 360, 412 and 448dp.">
            <div className="flex flex-col gap-14">
              {PLATFORMS.map((platform) => (
                <Row key={platform}>
                  {(["compact", "standard", "large"] as const).map((width) => (
                    <Group key={width} title={`${PLATFORM_NAMES[platform]}, ${SCREEN_SIZES[platform][width].width}${SIZE_UNIT[platform]}`}>
                      <Specimen settings={settingsFor(platform, { width })} view={view("lock")} content={PUSH_LONG} />
                    </Group>
                  ))}
                </Row>
              ))}
            </div>
          </Section>

          <Section id="tight-well" label="Tightest well" note="469 × 581, a 1280 × 800 window. Each phone fits whole; a large Android one holds the smallest scale, and the well scrolls.">
            <Row>
              {[
                ...PLATFORMS.flatMap((platform) => [
                  { platform, v: view("lock"), settings: settingsFor(platform) },
                  { platform, v: view("hidden"), settings: settingsFor(platform, { previewsHidden: true }) },
                  { platform, v: view("banner"), settings: settingsFor(platform) },
                  { platform, v: view("expanded"), settings: settingsFor(platform) },
                  { platform, v: view("sms"), settings: settingsFor(platform) },
                  { platform, v: view("lock"), settings: settingsFor(platform, { appearance: "dark" }) },
                  { platform, v: view("sms"), settings: settingsFor(platform, { appearance: "dark" }) },
                  { platform, v: view("lock"), settings: settingsFor(platform, { width: "large", textSize: "ax" }) },
                ]),
              ].map(({ platform, v, settings }, i) => (
                <Group
                  key={i}
                  title={`${PLATFORM_NAMES[platform]}, ${viewLabel(platform, v)}, ${settings.appearance}${settings.width === "large" ? ", large, AX" : ""}`}
                >
                  <div data-tight-well={`${platform}-${v.key}-${settings.appearance}${settings.width === "large" ? "-large-ax" : ""}`}>
                    <TightWell view={v} settings={settings} />
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

/** A view in the 469 × 581 well, under the controls row (which works). */
function TightWell({ view: v, settings }: { view: View; settings: DeviceSettings }) {
  const [state, setState] = useState<RailState>({
    channel: v.screen === "sms" ? "sms" : "push",
    screen: v.screen === "sms" ? "lock" : v.screen,
    settings,
  });
  return (
    <div className="flex flex-col gap-3" style={{ width: WELLS.tight.width }}>
      <ControlsRow state={state} onChange={setState} />
      <Well {...WELLS.tight}>
        {state.channel === "sms" ? (
          <SmsPreview settings={state.settings} content={SMS} clock={CLOCK} fit={WELL_FIT} />
        ) : (
          <PushPreview
            settings={state.settings}
            screen={state.screen}
            content={PUSH}
            clock={CLOCK}
            fit={WELL_FIT}
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
            <SmsPreview settings={state.settings} content={sms} clock={CLOCK} fit={WELL_FIT} />
          ) : (
            <PushPreview
              settings={state.settings}
              screen={state.screen}
              content={content}
              clock={CLOCK}
              fit={WELL_FIT}
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
            { value: "overlay", label: "1000 × 700" },
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
function MeasuredSpecimen({ platform, view: v }: { platform: DevicePlatform; view: View }) {
  const [measure, setMeasure] = useState<PushMeasure | null>(null);
  const settings = settingsFor(platform);
  return (
    <Group title={`${PLATFORM_NAMES[platform]}, ${viewLabel(platform, v)}`}>
      <Specimen settings={settings} view={v} content={PUSH_LONG} onMeasure={setMeasure} />
      <div style={{ width: frameSize(platform, "standard").width }}>{measure ? <MeasureTable measure={measure} /> : null}</div>
    </Group>
  );
}

const FIELDS = ["title", "subtitle", "body"] as const;

function MeasureTable({ measure }: { measure: PushMeasure }) {
  return (
    <table data-measure={`${measure.platform}-${measure.screen}`} className="w-full text-left text-[13px] leading-5">
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
