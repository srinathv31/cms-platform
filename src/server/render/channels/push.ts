import "server-only";
import { renderMessage, type MessageInput, type MessageResult } from "@/domain/render/message";
import type { PushRender } from "@/domain/render/types";
import type { PushPlatform } from "@/domain/messages/push";

// The push channel's adapter: the domain's `renderMessage`, the same function the composer's preview
// runs in the browser, so the server adds nothing to it. The title, the subtitle (iPhone only) and the
// body, in full, and the size of the platform's notification JSON; refused over 4,096 bytes.

export function renderPush(platform: PushPlatform, input: MessageInput): MessageResult<PushRender> {
  return renderMessage({ channel: "push", platform }, input);
}
