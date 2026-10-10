// What a push notification weighs: the JSON payload Stencil's text makes, in UTF-8 bytes, against the 4,096-byte
// limit that both Apple (APNs) and Google (FCM) enforce. Pure TypeScript, for the composer to run as the author
// types and for render, which refuses a payload over the limit.
//
// Sources:
//   - APNs, "Sending notification requests to APNs": the JSON payload is the request body, "limited to a maximum
//     size of 4 KB (4096 bytes)" (5 KB for VoIP, which Stencil doesn't send). The device token is in the request
//     path, /3/device/<token>, not in the payload.
//   - FCM, "FCM error codes" (INVALID_ARGUMENT, message too big): "4096 bytes for most messages, or 2048 bytes in
//     the case of messages to topics. This includes both the keys and the values."
//
// The size counts only what Stencil renders. A consumer adds its own keys (a deep link, a data payload, a badge,
// a sound, a category or thread id) and, for FCM, the device token or topic. Those only make the payload bigger,
// so this number is a lower bound on what the consumer sends: their payload is `pushPayloadBytes` plus the bytes
// of their own keys, and they have PUSH_MAX_BYTES − pushPayloadBytes left for them. A consumer sending to an FCM
// topic has 2,048 bytes in all, not 4,096. On Android the number also counts the request's `{"message":…}`
// envelope, which FCM's own count may leave out, so there it errs a few bytes high: the safe side.
//
// The bytes are those of JSON.stringify's compact output: no whitespace, non-ASCII characters written as UTF-8
// (é is 2 bytes, ’ 3, an emoji 4), and only ", \ and control characters escaped (a line break is the 2 bytes \n).
// A serializer that escapes non-ASCII as \uXXXX, such as Python's json.dumps by default, writes é as 6 bytes and
// an emoji as 12, so it can push a payload Stencil measured as fitting over the limit.

/** The payload limit on both platforms, in bytes. */
export const PUSH_MAX_BYTES = 4096;

export const PUSH_PLATFORMS = ["ios", "android"] as const;
/** The platform a push is rendered for. The API asks for it: Android output never has a subtitle. */
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** A push notification's text, after variables are resolved. */
export interface PushContent {
  title: string;
  /** iPhone only. Left out of the payload when absent or empty. */
  subtitle?: string;
  body: string;
}

/** The APNs payload: `{"aps":{"alert":{"title","subtitle","body"}}}`. */
export interface ApnsPayload {
  aps: { alert: { title: string; subtitle?: string; body: string } };
}

/** The FCM HTTP v1 request body: `{"message":{"notification":{"title","body"}}}`. FCM has no subtitle. */
export interface FcmPayload {
  message: { notification: { title: string; body: string } };
}

/** The notification JSON for one platform, as Stencil sends it, before any keys the consumer adds. */
export function pushPayload(platform: "ios", content: PushContent): ApnsPayload;
export function pushPayload(platform: "android", content: PushContent): FcmPayload;
export function pushPayload(platform: PushPlatform, content: PushContent): ApnsPayload | FcmPayload;
export function pushPayload(platform: PushPlatform, { title, subtitle, body }: PushContent): ApnsPayload | FcmPayload {
  switch (platform) {
    case "ios":
      return { aps: { alert: subtitle ? { title, subtitle, body } : { title, body } } };
    case "android":
      return { message: { notification: { title, body } } };
  }
}

/** The UTF-8 size of `pushPayload(platform, content)` as compact JSON. Compare it with PUSH_MAX_BYTES. */
export function pushPayloadBytes(platform: PushPlatform, content: PushContent): number {
  return utf8ByteLength(JSON.stringify(pushPayload(platform, content)));
}

/**
 * How many bytes `text` takes in UTF-8: 1 for ASCII, 2 up to U+07FF, 3 for the rest of the Basic Multilingual Plane,
 * 4 for a surrogate pair (an emoji). A lone surrogate counts 3, as the U+FFFD an encoder writes in its place.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (isHighSurrogate(unit) && i + 1 < text.length && isLowSurrogate(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}
