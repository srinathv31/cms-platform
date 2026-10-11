import type { Reporter, TestModule, Vitest } from "vitest/node";

// Vitest runs files and tests in a random order (vitest.config.mts) and prints its seed once, at the top.
// A run that fails is long, so this repeats the seed at the bottom, with the command that replays the order.
export default class SeedReporter implements Reporter {
  private vitest: Vitest | undefined;

  onInit(vitest: Vitest) {
    this.vitest = vitest;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
    if (!testModules.some((module) => module.state() === "failed")) return;
    const seed = this.vitest?.config.sequence.seed;
    if (seed === undefined) return;
    console.error(`\nTests run in a random order. Run this order again with: npx vitest run --sequence.seed=${seed}\n`);
  }
}
