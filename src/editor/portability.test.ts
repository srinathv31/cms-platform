// The editor lifts into another app by copying this folder. This test fails loudly the moment any
// file in it imports something outside the allowed set (app code, Next.js, a new dependency).
// Allowed: React, TipTap, Base UI, Floating UI, the shadcn primitives in @/components/ui, lucide,
// motion, zustand and relative imports inside the folder. Tests may also use their tooling.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd(), "src/editor");

const ALLOWED: RegExp[] = [
  /^react$/,
  /^react\/jsx-runtime$/,
  /^react-dom$/,
  /^@tiptap\/[a-z0-9-]+(\/.*)?$/,
  /^@base-ui\/react(\/.*)?$/,
  /^@floating-ui\/dom$/,
  /^@\/components\/ui\/[a-z0-9-]+$/,
  /^lucide-react$/,
  /^motion\/react$/,
  /^zustand(\/vanilla)?$/,
];

const TEST_ONLY: RegExp[] = [/^vitest$/, /^node:[a-z]+$/, /^react-dom\/(server|client)$/];

const SPECIFIER = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function imports(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) found.push(specifier);
  }
  return found;
}

describe("the editor folder is portable", () => {
  // This file's own examples (below) aren't imports.
  const all = files(ROOT).filter((file) => !file.endsWith("portability.test.ts"));

  it("finds the module's files", () => {
    expect(all.length).toBeGreaterThan(40);
    expect(all.some((f) => f.endsWith("schema.ts"))).toBe(true);
  });

  it("imports only React, TipTap, Base UI, Floating UI, shadcn ui, lucide, motion, zustand and itself", () => {
    const offenders: string[] = [];
    for (const file of all) {
      const isTest = /\.test\.tsx?$/.test(file);
      for (const specifier of imports(readFileSync(file, "utf8"))) {
        if (specifier.startsWith(".")) {
          // Relative imports must stay inside the folder.
          const target = resolve(dirname(file), specifier);
          if (relative(ROOT, target).startsWith("..")) offenders.push(`${relative(ROOT, file)} → ${specifier}`);
          continue;
        }
        const ok = ALLOWED.some((re) => re.test(specifier)) || (isTest && TEST_ONLY.some((re) => re.test(specifier)));
        if (!ok) offenders.push(`${relative(ROOT, file)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("catches an app import (the scanner itself works)", () => {
    expect(imports('import { db } from "@/server/db";\nexport { x } from "next/link";')).toEqual(["@/server/db", "next/link"]);
    expect(imports('const m = await import("@/domain/rules");')).toEqual(["@/domain/rules"]);
  });
});
