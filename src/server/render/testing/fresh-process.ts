// Renders in a brand-new Node process. An in-process test can't see state a render leaves behind
// for the next one (fontkit's glyph cache, module-level caches): every render in a test run shares
// it, so two runs agree even when both are wrong. A fresh process starts from nothing, and two
// fresh processes that render the same inputs in different orders must give the same bytes
// (docs/render-spec.md §12).
//
// The child loads this module through Vite's module runner with the project's vitest config (the
// same aliases and transforms the tests use), reads the jobs as JSON on stdin and writes the results
// as JSON on stdout after a marker line.

import { spawn } from "node:child_process";
import path from "node:path";
import { assertNever } from "@/domain/assert-never";
import type { RenderDoc, RenderError, RenderTarget } from "@/domain/render/types";
import type { Channel } from "@/domain/types";
import { renderPdf } from "@/server/render/channels/pdf";
import { runEngine, type RenderBody } from "@/server/render/engine";
import { engineInput, type RenderFixture } from "./fixture";

export type FreshJob =
  /** The engine (stages 6 to 9), as the render route runs it. */
  | { name: string; input: RenderFixture; target: RenderTarget }
  /** The PDF adapter alone, on a RenderDoc as given (no resolver in front of it). */
  | { name: string; pdfDoc: RenderDoc; at: string };

export interface FreshResult {
  name: string;
  ok: boolean;
  /** The output: a PDF as base64, a web page's HTML, an email as JSON. */
  body: string | null;
  error: RenderError | null;
}

const ROOT = process.cwd();
const MARKER = "\n@@fresh-process-results@@\n";

/** The child: boots Vite's module runner and hands stdin to `runJobs`. */
const CHILD = `
import { createServer, createServerModuleRunner } from "vite";
const server = await createServer({
  configFile: process.env.FRESH_CONFIG,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { runJobs } = await runner.import(process.env.FRESH_ENTRY);
const results = await runJobs(JSON.parse(input));
process.stdout.write(${JSON.stringify(MARKER)} + JSON.stringify(results));
await runner.close();
await server.close();
`;

/** Runs `jobs`, in order, in a new Node process; resolves with one result per job. */
export function renderInFreshProcess(jobs: readonly FreshJob[]): Promise<FreshResult[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD], {
      cwd: ROOT,
      env: {
        ...process.env,
        FRESH_CONFIG: path.join(ROOT, "vitest.config.mts"),
        FRESH_ENTRY: "/src/server/render/testing/fresh-process.ts",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (err += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const at = out.lastIndexOf(MARKER);
      if (code !== 0 || at < 0) {
        reject(new Error(`The fresh render process failed (exit ${code}).\n${err.slice(-4000)}`));
        return;
      }
      resolve(JSON.parse(out.slice(at + MARKER.length)) as FreshResult[]);
    });
    child.stdin.end(JSON.stringify(jobs));
  });
}

/** The child's side: runs each job in order. Exported for the child process only. */
export async function runJobs(jobs: readonly FreshJob[]): Promise<FreshResult[]> {
  const results: FreshResult[] = [];
  for (const job of jobs) {
    if ("pdfDoc" in job) {
      const bytes = await renderPdf(job.pdfDoc, { createdAt: new Date(job.at) });
      results.push({ name: job.name, ok: true, body: Buffer.from(bytes).toString("base64"), error: null });
      continue;
    }
    const result = await runEngine(engineInput(job.input), job.target, new Date(job.input.at));
    results.push(
      result.ok
        ? { name: job.name, ok: true, body: bodyText(job.target.channel, result.body), error: null }
        : { name: job.name, ok: false, body: null, error: result.error },
    );
  }
  return results;
}

function bodyText(channel: Channel, body: RenderBody): string {
  switch (channel) {
    case "pdf":
      return Buffer.from(body as Uint8Array).toString("base64");
    case "web":
      return body as string;
    case "email":
    case "push":
    case "sms":
      return JSON.stringify(body);
    default:
      return assertNever(channel, "channel");
  }
}

/** A PDF result's bytes. */
export function pdfBytes(result: FreshResult): Uint8Array {
  if (!result.ok || result.body === null) throw new Error(`${result.name} did not render: ${result.error?.message ?? "no body"}`);
  return new Uint8Array(Buffer.from(result.body, "base64"));
}
