"use client";

import { useState } from "react";
import { DevBar } from "./dev-bar";
import { ShellFrame } from "./bits";
import type { ScopeId, VariantId } from "./data";
import { TemplateTab } from "./template-tab";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export interface UsageInitial {
  variant: VariantId;
  scope: ScopeId;
  chrome: boolean;
  tab?: string;
}

export function UsageMock({ initial }: { initial: UsageInitial }) {
  const [variant, setVariant] = useState(initial.variant);
  const [scope, setScope] = useState(initial.scope);
  const [nonce, setNonce] = useState(0);
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-app">
      {initial.chrome ? (
        <DevBar
          scope={scope}
          onScope={setScope}
          variant={variant}
          onVariant={setVariant}
          onReset={() => {
            setVariant("a");
            setScope("team");
            setNonce((n) => n + 1);
          }}
        />
      ) : null}
      <div className="min-h-0 flex-1" key={nonce}>
        <ShellFrame>
          {scope === "template" ? <TemplateTab /> : variant === "a" ? <VariantA /> : variant === "b" ? <VariantB /> : <VariantC initialMetric={initial.tab} />}
        </ShellFrame>
      </div>
    </div>
  );
}
