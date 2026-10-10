import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PushContent } from "../types";
import { ANDROID_HIDDEN_BODY, AndroidNotification } from "./notification-card";

const CONTENT: PushContent = {
  appName: "Coral",
  appMark: { monogram: "C" },
  title: "Payment due Wednesday",
  subtitle: "Coral Rewards card ending 4821",
  body: "Hi Maya, your minimum payment of $35.00 is due Wednesday.",
  time: "now",
};

function render(props: Partial<Parameters<typeof AndroidNotification>[0]> = {}) {
  return renderToStaticMarkup(
    <AndroidNotification
      content={CONTENT}
      screen="lock"
      textSize="default"
      motion={{}}
      background="var(--device-m3-lock-card)"
      corners={[24, 24, 6, 6]}
      {...props}
    />,
  );
}

describe("AndroidNotification", () => {
  it("never shows the subtitle, on any screen", () => {
    for (const screen of ["lock", "banner", "expanded"] as const) {
      expect(render({ screen })).not.toContain(CONTENT.subtitle);
    }
  });

  it("with previews hidden, still shows the app's name and the title, and hides only the text", () => {
    const html = render({ previewsHidden: true });
    expect(html).toContain("Coral");
    expect(html).toMatch(/data-field="title"[^>]*>Payment due Wednesday</);
    expect(html).toContain(ANDROID_HIDDEN_BODY);
    expect(html).not.toContain(CONTENT.body);
    expect(html).not.toContain('data-field="body"');
  });

  it("is a toggle button only when it can toggle", () => {
    expect(render()).not.toContain("<button");
    expect(render({ onToggle: () => {} })).toMatch(/<button[^>]*aria-expanded="false"/);
  });
});
