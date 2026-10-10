"use client";

import { useLayoutEffect, type RefObject } from "react";
import type { SmsContent, SmsMessage } from "./types";

// A text thread: the earlier messages from the sender, then the newest. Shared by both skins' messaging
// apps.

/** Every message of the thread, oldest first: the earlier ones, then the newest. */
export function threadMessages(content: SmsContent): SmsMessage[] {
  return [...(content.earlier ?? []), { text: content.text, time: content.time, day: content.day }];
}

const stamp = (message: SmsMessage) => `${message.day ?? "Today"} ${message.time}`;

/** Whether the message at `index` prints its day and time: the first does, and any that differs from the one before. */
export function showsStamp(messages: readonly SmsMessage[], index: number): boolean {
  return index === 0 || stamp(messages[index]!) !== stamp(messages[index - 1]!);
}

/**
 * Opens a thread that has earlier messages on the newest one, as a phone does: the scroller shows the
 * newest message from its top, or the end of the thread when the rest fits. A thread of one message
 * keeps its top in view.
 */
export function useOpenOnNewest(scroller: RefObject<HTMLElement | null>, newest: RefObject<HTMLElement | null>, count: number) {
  useLayoutEffect(() => {
    const box = scroller.current;
    const last = newest.current;
    if (!box || !last || count < 2) return;
    const pad = Number.parseFloat(getComputedStyle(box).paddingTop) || 0;
    box.scrollBy({ top: last.getBoundingClientRect().top - box.getBoundingClientRect().top - pad, behavior: "instant" });
  }, [scroller, newest, count]);
}
