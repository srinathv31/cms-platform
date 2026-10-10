"use client";

import { useMemo, useState } from "react";
import { PushPreview, frameSize, type DeviceSettings, type PushContent, type PushMeasure } from "@/components/device";
import { monogramOf } from "@/components/preview/phone-output";
import { channelFieldsFrom, channelFieldsOf, type ChannelFieldValues } from "@/domain/channel-fields";
import { PUSH_PLATFORMS, type PushPlatform } from "@/domain/messages/push";
import type { LockScreenFit } from "@/domain/messages/truncation";
import type { MessageTypeRules } from "@/domain/platform-config";
import { resolveMessage } from "@/domain/render/message";
import { validateValues } from "@/domain/render/validate";
import type { Variable, VariableValues } from "@/domain/types";

// Where each phone's lock screen cuts the push, measured from the phone kit itself, so a warning in the
// composer says exactly what that phone draws. Two phones the author never sees, one per platform, sit
// off screen (aria-hidden, inert, invisible but laid out), always at the lock screen, the standard
// width and the default text size, whatever the preview shows and whether or not it is open.
//
// Each one's `onMeasure` reports how its fields fit whenever that changes. It reports from a layout
// effect, so a new text and its measurement reach the screen in the same paint; a text that changes
// nothing on screen (typing past where the body is cut) reports nothing, and the last fit still holds.
//
// The phones redraw only when the push does: `usePushContent` reads the push's own fields, so a
// keystroke in the SMS leaves the content as it was, and `usePushFit` keeps the phones as they were.

/** The phone the warnings are measured on: the most common one, not the preview's choice. */
const MEASURED: Omit<DeviceSettings, "platform"> = {
  appearance: "light",
  previewsHidden: false,
  textSize: "default",
  width: "standard",
};

const [TITLE, SUBTITLE, BODY] = channelFieldsOf("push");

/**
 * The push as the selected set resolves it, for the phones the cuts are measured on: iPhone's (the
 * fields with the subtitle). Null while Push is off or while the values don't render. The same object
 * until a push field, the variables, the values, the rules or the app change.
 */
export function usePushContent({
  on,
  fields,
  variables,
  values,
  rules,
  appName,
}: {
  on: boolean;
  /** Every field as typed; only the push's are read. */
  fields: ChannelFieldValues;
  variables: readonly Variable[];
  values: VariableValues;
  rules: MessageTypeRules;
  appName: string;
}): PushContent | null {
  const title = fields[TITLE!.id];
  const subtitle = fields[SUBTITLE!.id];
  const body = fields[BODY!.id];
  return useMemo(() => {
    if (!on) return null;
    const checked = validateValues(variables, values);
    if (!checked.ok) return null;
    const push = resolveMessage(
      { channel: "push", platform: "ios" },
      {
        fields: channelFieldsFrom({ [TITLE!.id]: title, [SUBTITLE!.id]: subtitle, [BODY!.id]: body }),
        variables,
        values: checked.values,
        rules,
      },
    );
    return { appName, appMark: { monogram: monogramOf(appName) }, ...push, time: "now" };
  }, [on, title, subtitle, body, variables, values, rules, appName]);
}

/** The lock screens' fit for `content` (null: nothing to measure), and the hidden phones that measure it. */
export function usePushFit(content: PushContent | null): { fits: LockScreenFit[]; probe: React.ReactNode } {
  const [measured, setMeasured] = useState<Partial<Record<PushPlatform, PushMeasure>>>({});

  const fits = content
    ? PUSH_PLATFORMS.flatMap((platform) => {
        const fit = measured[platform];
        return fit ? [{ platform, title: fit.title, subtitle: fit.subtitle, body: fit.body }] : [];
      })
    : [];

  // The same element while the content is the same, so a render of the composer for anything else (an
  // SMS keystroke, a new measurement) doesn't redraw the phones.
  const probe = useMemo(
    () =>
      content ? (
        <div aria-hidden inert data-slot="push-fit" className="pointer-events-none invisible fixed top-0 left-[-10000px]">
          {PUSH_PLATFORMS.map((platform) => {
            // The whole phone's size: it draws at 1:1 (it would cut the same at any scale).
            const size = frameSize(platform, MEASURED.width);
            return (
              <div key={platform} style={{ width: size.width, height: size.height }}>
                <PushPreview
                  settings={{ platform, ...MEASURED }}
                  screen="lock"
                  content={content}
                  onMeasure={(measure) => setMeasured((all) => ({ ...all, [platform]: measure }))}
                />
              </div>
            );
          })}
        </div>
      ) : null,
    [content],
  );

  return { fits, probe };
}
