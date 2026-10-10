import type { ChannelFields } from "@/domain/channel-fields";
import { DEFAULT_CHANNELS, submit, type SubmitResult } from "@/domain/lifecycle";
import type { MessageTypeRules } from "@/domain/platform-config";
import type { Channel, JSONContent, SampleSet, Variable } from "@/domain/types";

// For tests of content the app ships (starters, the seed): would the domain's submit take this content
// as a new draft, with these message rules? Every submit rule runs: variables, required fields, and for
// an alert the SMS characters and parts, public shorteners and push size.

export interface SubmittableContent {
  body: JSONContent;
  variables: readonly Variable[];
  sampleSets: readonly SampleSet[];
  /** A starter without any is a document's: PDF and Web. */
  channels?: readonly Channel[];
  channelFields?: ChannelFields;
}

export function trySubmit(content: SubmittableContent, rules: MessageTypeRules, now: Date): SubmitResult {
  return submit({
    draft: {
      state: "draft",
      body: content.body,
      variables: content.variables,
      sampleSets: content.sampleSets,
      channels: content.channels ?? DEFAULT_CHANNELS.document,
      channelFields: content.channelFields ?? {},
      writers: ["maya"],
      rev: 0,
    },
    seenRev: 0,
    highestNumber: 0,
    baseline: null,
    now,
    submittedBy: "maya",
    submitterName: "Maya Chen",
    templateId: "UC-TEST01",
    templateName: "Test",
    chain: [{ id: "st_team", position: 0, name: "Team approver", rule: { kind: "team_role", role: "approver" } }],
    messageRules: rules,
  });
}
