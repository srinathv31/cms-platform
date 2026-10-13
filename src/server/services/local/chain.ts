import "server-only";
import { cache } from "react";
import { asc, eq, inArray } from "drizzle-orm";
import { DEFAULT_CHAIN, type RecordedDecision } from "@/domain/approval-chain";
import {
  DEFAULT_SMS_MAX_PARTS,
  type MessageTypeRules,
} from "@/domain/platform-config/limits";
import type { ApprovalStage } from "@/domain/review-types";
import { contentTypeFamily, type ChannelFamily } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { db } from "@/server/db/client";
import {
  approvalStages,
  approvals,
  contentTypes,
} from "@/server/db/schema/ucomp";

// The review configuration and decisions on this app's own database: a content type's approval chain, its
// family and message rules, and the decisions recorded on versions. The review commands and reads load their
// facts with these (inside a transaction, through its `tx`); the domain decides with them.

type Reader = Pick<Db, "select">;

/** The content type's stages in order (configuration, not code). Never empty. */
export async function loadChain(
  reader: Reader,
  contentTypeId: string,
): Promise<ApprovalStage[]> {
  const rows = await reader
    .select({
      id: approvalStages.id,
      position: approvalStages.position,
      name: approvalStages.name,
      rule: approvalStages.approverRule,
    })
    .from(approvalStages)
    .where(eq(approvalStages.contentTypeId, contentTypeId))
    .orderBy(asc(approvalStages.position));
  return rows.length > 0 ? rows : DEFAULT_CHAIN.map((stage) => ({ ...stage }));
}

/**
 * The template's family, from its content type (`contentTypeFamily`): a document or an alert. Never read
 * from a version's channels, which are the author's to change.
 */
export async function loadFamily(
  reader: Reader,
  contentTypeId: string,
): Promise<ChannelFamily> {
  const [row] = await reader
    .select({ allowedChannels: contentTypes.allowedChannels })
    .from(contentTypes)
    .where(eq(contentTypes.id, contentTypeId))
    .limit(1);
  return contentTypeFamily(row?.allowedChannels ?? []);
}

/** The content type's SMS footer and part budget, which submit measures a message with. */
export async function loadMessageRules(
  reader: Reader,
  contentTypeId: string,
): Promise<MessageTypeRules> {
  const [row] = await reader
    .select({
      smsFooter: contentTypes.smsFooter,
      smsMaxParts: contentTypes.smsMaxParts,
    })
    .from(contentTypes)
    .where(eq(contentTypes.id, contentTypeId))
    .limit(1);
  return row ?? { smsFooter: null, smsMaxParts: DEFAULT_SMS_MAX_PARTS };
}

/** Every content type's chain at once (the queue spans templates of several types). */
export const getChains = cache(
  async (): Promise<ReadonlyMap<string, ApprovalStage[]>> => {
    const rows = await db
      .select({
        contentTypeId: approvalStages.contentTypeId,
        id: approvalStages.id,
        position: approvalStages.position,
        name: approvalStages.name,
        rule: approvalStages.approverRule,
      })
      .from(approvalStages)
      .orderBy(asc(approvalStages.position));
    const chains = new Map<string, ApprovalStage[]>();
    for (const { contentTypeId, ...stage } of rows) {
      const chain = chains.get(contentTypeId);
      if (chain) chain.push(stage);
      else chains.set(contentTypeId, [stage]);
    }
    return chains;
  },
);

/** Each version's decisions, by stage id (the "two stages need two people" guard reads them). */
export async function loadDecisions(
  reader: Reader,
  versionIds: readonly string[],
): Promise<Map<string, RecordedDecision[]>> {
  const byVersion = new Map<string, RecordedDecision[]>();
  if (versionIds.length === 0) return byVersion;
  const rows = await reader
    .select({
      versionId: approvals.versionId,
      stageId: approvals.stageId,
      actorId: approvals.actorId,
      decision: approvals.decision,
    })
    .from(approvals)
    .where(inArray(approvals.versionId, [...versionIds]));
  for (const { versionId, ...decision } of rows)
    byVersion.set(versionId, [...(byVersion.get(versionId) ?? []), decision]);
  return byVersion;
}
