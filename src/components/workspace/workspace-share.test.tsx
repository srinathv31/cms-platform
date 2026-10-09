// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationPanelData } from "@/domain/golive-types";
import type { ActionResult } from "@/domain/review-types";

// The SHARE ring reads its panel from GET /api/templates/[templateId]/integration: on focus (or hover)
// as a prefetch, and on open. A GET route, so the prefetch doesn't queue with the page's server actions.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The integration route as the browser reaches it: handed the URL fetched, it gives the body. */
const integrationRoute = vi.hoisted(() => vi.fn<(url: string) => Promise<ActionResult<{ panel: IntegrationPanelData }>>>());
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string) => {
    const body = await integrationRoute(url);
    return { status: body.ok ? 200 : 409, json: async () => body };
  }),
);

const { WorkspaceShare } = await import("./workspace-share");

const NO_ACTIVE = "This template has no Active version yet.";
const READ_URL = "/api/templates/UC-ABC123/integration";

let root: Root;
let container: HTMLElement;

const ring = () => container.querySelector<HTMLButtonElement>('[data-slot="share-ring"]')!;
const tick = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(async () => {
  integrationRoute.mockReset().mockResolvedValue({ ok: false, code: "no_active_version", reason: NO_ACTIVE });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<WorkspaceShare templateId="UC-ABC123" templateName="Rate notice" activeVersion={2} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("WorkspaceShare", () => {
  it("reads the panel from the integration route when the ring takes focus, before it opens", async () => {
    await act(async () => ring().focus());
    await tick();
    expect(integrationRoute).toHaveBeenCalledExactlyOnceWith(READ_URL);
  });

  it("reads it on open, and shows the route's refusal in the panel", async () => {
    await act(async () => ring().click());
    await tick();
    expect(integrationRoute).toHaveBeenLastCalledWith(READ_URL);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(NO_ACTIVE);
  });
});
