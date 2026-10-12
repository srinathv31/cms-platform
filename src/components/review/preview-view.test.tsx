// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  channelNotAllowed,
  renderFailed,
  renderFailedGlyphs,
} from "@/domain/render/errors";
import type { RenderError } from "@/domain/render/types";
import type { PreviewSlot } from "@/components/preview/use-preview-render";
import type { Channel } from "@/domain/types";
import { PreviewView } from "./preview-view";

// What the review Preview tells the screen about the output it shows (decision 0037): `onViewed` once it has
// rendered, `onFailed` while the route refuses it for a reason of the version's own. The route's answer is
// stood in for, and so is the pane that draws it.

const route = vi.hoisted(() => ({ slots: {} as Record<string, unknown> }));
vi.mock("@/components/preview/use-preview-render", () => ({
  usePreviewRender: () => ({
    slots: route.slots,
    rendering: false,
    retry: () => {},
  }),
}));
vi.mock("@/components/preview/preview-pane", () => ({
  PreviewPane: (props: {
    channel: Channel;
    onPdfShown?: () => void;
  }): ReactNode => (
    <div data-channel={props.channel}>
      <button type="button" onClick={props.onPdfShown}>
        pdf shown
      </button>
    </div>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const onViewed = vi.fn();
const onFailed = vi.fn();
let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  route.slots = {};
  onViewed.mockClear();
  onFailed.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function show(channels: Channel[], enabled = true) {
  act(() =>
    root!.render(
      <PreviewView
        templateId="UC-4F7K2Q"
        versionNumber={3}
        round={1}
        teamName="Coral Offers"
        channels={channels}
        variables={[]}
        channelFields={{}}
        messageRules={{ smsFooter: null, smsMaxParts: 10 }}
        senders={{ appName: "Coral", smsSender: "26725" }}
        today="2026-10-10"
        values={{}}
        setId="typical"
        enabled={enabled}
        onSeen={() => {}}
        viewed={[]}
        onViewed={onViewed}
        onFailed={onFailed}
        onEditValues={() => {}}
      />,
    ),
  );
}

const slot = (over: Partial<PreviewSlot>): PreviewSlot => ({
  output: null,
  error: null,
  ...over,
});
const WEB = { kind: "web", html: "<p>Hi</p>" } as const;
const PDF = {
  kind: "pdf",
  bytes: new Uint8Array([1]),
  filename: "UC-4F7K2Q-v3.pdf",
} as const;

describe("PreviewView reports the output on screen", () => {
  it("a rendered output is viewed and not failed", () => {
    route.slots = { web: slot({ output: WEB }) };
    show(["web", "pdf"]);
    expect(onViewed).toHaveBeenCalledWith("web");
    expect(onFailed).toHaveBeenLastCalledWith("web", false);
  });

  it("a PDF is viewed once the viewer says it is shown, not when its bytes arrive", () => {
    route.slots = { pdf: slot({ output: PDF }) };
    show(["pdf"]);
    expect(onViewed).not.toHaveBeenCalled();
    act(() => host.querySelector("button")!.click());
    expect(onViewed).toHaveBeenCalledWith("pdf");
  });

  it("a PDF the font can't draw is failed, never viewed", () => {
    route.slots = { pdf: slot({ error: renderFailedGlyphs(["\u{1F600}"]) }) };
    show(["pdf", "web"]);
    expect(onFailed).toHaveBeenLastCalledWith("pdf", true);
    expect(onViewed).not.toHaveBeenCalled();
  });

  it("a channel the content type no longer allows is failed", () => {
    route.slots = {
      web: slot({ error: channelNotAllowed("Disclosure", "web") }),
    };
    show(["web"]);
    expect(onFailed).toHaveBeenLastCalledWith("web", true);
  });

  it("a failure on top of an earlier good render is still failed, and stops being once it renders again", () => {
    route.slots = {
      web: slot({ output: WEB, error: channelNotAllowed("Disclosure", "web") }),
    };
    show(["web"]);
    expect(onFailed).toHaveBeenLastCalledWith("web", true);
    route.slots = { web: slot({ output: WEB }) };
    show(["web"]);
    expect(onFailed).toHaveBeenLastCalledWith("web", false);
  });

  it("a problem with the sample set's values, or a failure that may pass on trying again, is not failed", () => {
    const values: RenderError = {
      code: "missing_variables",
      message: "Missing required variables: first_name.",
      details: { missing: ["first_name"], invalid: [] },
    };
    route.slots = { pdf: slot({ error: values }) };
    show(["pdf"]);
    expect(onFailed).toHaveBeenLastCalledWith("pdf", false);

    route.slots = { pdf: slot({ error: renderFailed("pdf") }) };
    show(["pdf"]);
    expect(onFailed).toHaveBeenLastCalledWith("pdf", false);
    expect(onViewed).not.toHaveBeenCalled();
  });

  it("says nothing while the Preview isn't the view showing", () => {
    route.slots = {
      web: slot({ error: channelNotAllowed("Disclosure", "web") }),
    };
    show(["web"], false);
    expect(onFailed).not.toHaveBeenCalled();
    expect(onViewed).not.toHaveBeenCalled();
  });
});
