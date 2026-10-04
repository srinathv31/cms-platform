import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDraftPatch } from "@/server/drafts/parse-patch";
import { newSessionKey } from "./session-key";

afterEach(() => vi.unstubAllGlobals());

const accepted = (sessionKey: string) => parseDraftPatch({ rev: 0, sessionKey, name: "A" }).ok;

describe("newSessionKey", () => {
  it("is a UUID where crypto.randomUUID exists, and the route accepts it", () => {
    const key = newSessionKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(accepted(key)).toBe(true);
  });

  it("is different each time", () => {
    expect(newSessionKey()).not.toBe(newSessionKey());
  });

  it("falls back to random bytes where randomUUID is missing (plain http)", () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const key = newSessionKey();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(newSessionKey()).not.toBe(key);
    expect(accepted(key)).toBe(true);
  });
});
