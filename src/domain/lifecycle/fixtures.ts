import { requestChanges } from "./request-changes";
import { startRevoke } from "./revoke";
import type { ReviewVersion } from "./types";
import type { MessageTypeRules } from "../platform-config/limits";
import type { ApprovalStage, VersionStage } from "../review-types";
import type { ContractChange, JSONContent, RevokeRecord, SampleSet, Variable } from "../types";

export const NOW = new Date("2026-10-04T12:00:00.000Z");
export const TEMPLATE = { id: "UC-4F7K2Q", name: "Spring Travel Rewards — Terms" };
export const CHAIN_1: ApprovalStage[] = [{ id: "st_team", position: 0, name: "Team approver", rule: { kind: "team_role", role: "approver" } }];
/** A document's content type: no SMS footer, the default part budget (never read for a document). */
export const NO_MESSAGE_RULES: MessageTypeRules = { smsFooter: null, smsMaxParts: 3 };

export const heading = (id: string, requiredKey: string, text: string): JSONContent => ({
  type: "heading",
  attrs: { id, level: 2, requiredKey },
  content: [{ type: "text", text }],
});

export const BODY: JSONContent = {
  type: "doc",
  content: [
    heading("b_one", "offer_details", "Offer details"),
    {
      type: "paragraph",
      attrs: { id: "b_two" },
      content: [{ type: "text", text: "Hi " }, { type: "variable", attrs: { key: "first_name" } }],
    },
    heading("b_three", "rates_and_fees", "Rates and fees"),
    heading("b_four", "legal_notices", "Legal notices"),
  ],
};

export const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "purchase_apr", label: "Purchase APR", type: "percent", required: true, sample: "21.99" },
];

export const SAMPLE_SETS: SampleSet[] = [
  { id: "typical", name: "Typical customer", values: { first_name: "Maya", purchase_apr: "21.99" } },
  { id: "long", name: "Long name and maximum values", values: { first_name: "Alexandria-Marguerite", purchase_apr: "29.99" } },
  { id: "minimum", name: "Minimum values", values: { first_name: "Al", purchase_apr: "9.99" } },
];

export const CHAIN_2: ApprovalStage[] = [
  ...CHAIN_1,
  { id: "st_legal", position: 1, name: "Legal reviewer", rule: { kind: "user", userId: "dana" } },
];
/** What a version submitted under each chain recorded. */
const STAGES_1: VersionStage[] = [{ id: "st_team", name: "Team approver" }];
export const STAGES_2: VersionStage[] = [...STAGES_1, { id: "st_legal", name: "Legal reviewer" }];
// A sunset date is a calendar day that ends at 00:00 in the business time zone (decision 0017): the
// days as the picker sends them, and the instants they end at in New York.
export const ZONE = "America/New_York";
export const TOMORROW_DAY = "2026-10-05";
export const TOMORROW = new Date("2026-10-05T04:00:00.000Z"); // 00:00 EDT
export const MARCH_1_DAY = "2027-03-01";
export const MARCH_1 = new Date("2027-03-01T05:00:00.000Z"); // 00:00 EST
/** 23:30 Eastern on October 4, when it is already October 5 in UTC. */
export const LATE_EVENING = new Date("2026-10-05T03:30:00.000Z");
export const REASON = "The APR in Rates and fees doesn't match the offer sheet.";
export const REVOKE_REASON = "Wrong APR in legal notices";
export const EMAIL_SUBJECT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Your offer" }] }],
};
export const ANNUAL_FEE_ADDED: ContractChange = {
  kind: "added",
  key: "annual_fee",
  breaking: true,
  type: "currency",
  required: true,
};
export const PENDING: RevokeRecord = { reason: REVOKE_REASON, startedBy: "jordan", startedAt: "2026-10-03T09:00:00.000Z" };
export const CONFIRMED: RevokeRecord = { ...PENDING, confirmedBy: "alex", confirmedAt: "2026-10-03T10:00:00.000Z" };

export function reviewVersion(over: Partial<ReviewVersion> = {}): ReviewVersion {
  return {
    id: "v_1",
    templateId: TEMPLATE.id,
    number: 1,
    round: 1,
    state: "in_review",
    name: TEMPLATE.name,
    body: BODY,
    channelFields: { email: { subject: EMAIL_SUBJECT } },
    channels: ["pdf", "web", "email"],
    variables: VARIABLES,
    sampleSets: SAMPLE_SETS,
    submittedBy: "maya",
    writers: ["maya"],
    stages: null,
    currentStage: 0,
    contractChanges: null,
    sunsetAt: null,
    revoke: null,
    ...over,
  };
}

export const tryRequestChanges = (version: ReviewVersion) =>
  requestChanges({
    version,
    chain: CHAIN_1,
    actorId: "jordan",
    actorName: "Jordan Ellis",
    reason: REASON,
    now: NOW,
    templateName: TEMPLATE.name,
  });

export const tryStartRevoke = (version: ReviewVersion) =>
  startRevoke({
    version,
    actorId: "jordan",
    actorName: "Jordan Ellis",
    reason: REVOKE_REASON,
    now: NOW,
    templateName: TEMPLATE.name,
  });
