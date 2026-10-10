import "server-only";
import { renderMessage, type MessageInput, type MessageResult } from "@/domain/render/message";
import type { SmsRender } from "@/domain/render/types";

// The SMS channel's adapter: the domain's `renderMessage`, the same function the composer's preview
// runs in the browser, so the server adds nothing to it. The message with the content type's footer on
// its own line, its encoding, parts and characters; refused over 10 parts. Never truncated, never
// transliterated.

export function renderSms(input: MessageInput): MessageResult<SmsRender> {
  return renderMessage({ channel: "sms" }, input);
}
