import { chainFor, type RecordedDecision } from "@/domain/approval-chain";
import type { MessageTypeRules } from "@/domain/platform-config/limits";
import type { ApprovalStage } from "@/domain/review-types";
import type { FakeState } from "./state";

// The review configuration and decisions in memory: the twins of services/local/chain.ts's loaders (a content
// type's chain and message rules, a version's decisions), read from the fake's arrays.

/** The content type's stages in order, or the default chain when it has none (`chainFor`). */
export function chainOf(
  state: FakeState,
  contentTypeId: string,
): ApprovalStage[] {
  const chains = new Map<string, ApprovalStage[]>();
  for (const s of [...state.approvalStages].sort(
    (a, b) => a.position - b.position,
  )) {
    const stage = {
      id: s.id,
      position: s.position,
      name: s.name,
      rule: s.approverRule,
    };
    chains.set(s.contentTypeId, [
      ...(chains.get(s.contentTypeId) ?? []),
      stage,
    ]);
  }
  return chainFor(chains, contentTypeId);
}

/** The content type's SMS footer and part budget, which submit measures a message with. */
export function messageRulesOf(
  state: FakeState,
  contentTypeId: string,
): MessageTypeRules {
  const type = state.contentTypes.find((c) => c.id === contentTypeId);
  if (!type) throw new Error(`No content type ${contentTypeId}.`);
  return { smsFooter: type.smsFooter, smsMaxParts: type.smsMaxParts };
}

/** A version's decisions (the "two stages need two people" guard reads them). */
export function decisionsOf(
  state: FakeState,
  versionId: string,
): RecordedDecision[] {
  return state.approvals
    .filter((a) => a.versionId === versionId)
    .map(({ stageId, actorId, decision }) => ({ stageId, actorId, decision }));
}
