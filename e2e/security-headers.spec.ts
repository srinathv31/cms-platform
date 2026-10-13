import { expect, test, type Page } from "@playwright/test";
import { isDocument, pick, render, validValues } from "./api/helpers";
import { allVersions } from "./helpers/state";

// The security headers next.config.ts sends on every response, and the framing they allow: the app's own
// pages may frame its pages (Coral's customer view frames its stored deliveries), another origin may not.
// A route's own headers stay: the rendered web page keeps its scriptless Content-Security-Policy.

const STATIC = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "SAMEORIGIN",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

/** Every value of a header, however many times the response sends it. */
const values = (headers: { name: string; value: string }[], name: string) =>
  headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);

test("a page, a consumer API answer and a rendered web page carry the security headers", async ({
  request,
}) => {
  const web = pick(
    (await allVersions()).filter(isDocument),
    "Active version with web on",
    (v) => v.state === "active" && v.channels.includes("web"),
  );
  const responses = {
    page: await request.get("/coral-offers/library"),
    api: await request.get("/api/v1/templates", {
      headers: { "X-Consumer-Id": "coral" },
    }),
    render: (
      await render(request, {
        templateId: web.templateId,
        body: {
          version: web.number,
          channel: "web",
          values: validValues(web.variables),
        },
      })
    ).res,
  };
  for (const [what, res] of Object.entries(responses)) {
    expect(res.status(), what).toBe(200);
    const headers = res.headersArray();
    for (const [name, value] of Object.entries(STATIC))
      expect(values(headers, name), `${what}: ${name}`).toContain(value);
  }
  // The rendered page keeps its own scriptless policy: a header next.config.ts set by the same name would
  // replace it.
  expect(
    values(responses.render.headersArray(), "content-security-policy"),
  ).toEqual([expect.stringContaining("default-src 'none'")]);
});

/** Puts an iframe of `src` on the page and returns the frame once it has loaded (or failed to). */
async function frameOf(page: Page, src: string) {
  await page.evaluate(
    (url) =>
      new Promise<void>((resolve) => {
        const frame = document.createElement("iframe");
        frame.id = "probe";
        frame.src = url;
        frame.addEventListener("load", () => resolve(), { once: true });
        document.body.append(frame);
      }),
    src,
  );
  const frame = await (await page.$("#probe"))!.contentFrame();
  return frame!;
}

test("the app's pages frame its pages; another origin can't", async ({
  page,
  baseURL,
}) => {
  const target = new URL("/request-access", baseURL).href;

  // Same origin: the page loads in the frame.
  await page.goto("/request-access");
  const own = await frameOf(page, target);
  await expect(
    own.getByRole("heading", { level: 1, name: "Request access" }),
  ).toBeVisible();

  // Another origin (127.0.0.1 is not localhost): the browser refuses to show it.
  const other = new URL(baseURL!);
  other.hostname = "127.0.0.1";
  await page.goto(new URL("/request-access", other).href);
  const foreign = await frameOf(page, target);
  expect(foreign.url()).not.toBe(target);
  await expect(foreign.getByRole("heading", { level: 1 })).toHaveCount(0);
});
