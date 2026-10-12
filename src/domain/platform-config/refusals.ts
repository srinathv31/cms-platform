// The refusal table of the platform settings: why a change can't be saved, as a code to branch on and
// the sentence shown at the control. The table is whole and in one place, with its codes and sentences, so
// `src/domain/refusals.test.ts` can check that no code is used twice.

import { ROLE_LABEL } from "../access/roles";
import { plural, pluralName, pluralWord } from "../plural";
import { refusal } from "../refusals";
import { CHANNEL_LABELS, joinWithAnd, joinWithOr } from "../render/errors";
import { familyChannels, type ChannelFamily, type TeamRole } from "../types";
import {
  TEAM_NAME_MAX,
  TEAM_DESCRIPTION_MAX,
  SECTION_TITLE_MAX,
  STAGE_NAME_MAX,
} from "./limits";

/** Why a Platform settings change can't be saved: a code to branch on, and the sentence shown at the control. */
export const PLATFORM_REFUSALS = {
  teamName: refusal("team_name_missing", "Give the team a name."),
  teamNameTooLong: refusal(
    "team_name_too_long",
    `Keep the name under ${TEAM_NAME_MAX} characters.`,
  ),
  descriptionTooLong: refusal(
    "team_description_too_long",
    `Keep the description under ${TEAM_DESCRIPTION_MAX} characters.`,
  ),
  icon: refusal("team_icon_missing", "Pick an icon."),
  reservedName: refusal(
    "team_name_reserved",
    (name: string) => `"${name}" can't be used as a team name.`,
  ),
  teamTaken: refusal(
    "team_name_taken",
    (name: string) => `A team called ${name} already exists.`,
  ),
  pickPerson: refusal("pick_person", "Pick a person."),
  /** A new team's first Team Admin: the Auditor is read-only everywhere. */
  auditorCantBeAdmin: refusal(
    "auditor_cant_be_admin",
    (person: string) => `${person} is an Auditor and can't be a Team Admin.`,
  ),
  oneSection: refusal("last_section", "Keep at least one required section."),
  /** A message type's sections: "Alerts are messages, with no document to hold sections." */
  noSections: refusal(
    "sections_on_messages",
    (type: string) =>
      `${pluralName(type)} are messages, with no document to hold sections.`,
  ),
  sectionTitle: refusal("section_title_missing", "Give every section a title."),
  sectionTitleTooLong: refusal(
    "section_title_too_long",
    `Keep section titles under ${SECTION_TITLE_MAX} characters.`,
  ),
  sectionDuplicate: refusal(
    "section_duplicate",
    (title: string) => `There are two sections called ${title}.`,
  ),
  oneChannel: refusal("last_channel", "Keep at least one channel on."),
  /**
   * A channel from the other family (decision 0034): "Disclosures are documents. Push and SMS go on Alert
   * templates." / "Alerts are messages. PDF, Web and Email go on Disclosure templates." `homes` are the
   * content types of the channel's family; with none, the family is named instead.
   */
  otherFamily: refusal(
    "channel_family",
    (type: string, family: ChannelFamily, homes: readonly string[]) => {
      const other: ChannelFamily =
        family === "document" ? "message" : "document";
      const channels = joinWithAnd(
        familyChannels(other).map((c) => CHANNEL_LABELS[c]),
      );
      const where =
        homes.length > 0
          ? `${joinWithOr(homes)} templates`
          : `${other} templates`;
      return `${pluralName(type)} are ${family}s. ${channels} go on ${where}.`;
    },
  ),
  oneStage: refusal("last_stage", "Keep at least one stage."),
  stageName: refusal("stage_name_missing", "Give every stage a name."),
  stageNameTooLong: refusal(
    "stage_name_too_long",
    `Keep stage names under ${STAGE_NAME_MAX} characters.`,
  ),
  stageDuplicate: refusal(
    "stage_duplicate",
    (name: string) => `There are two stages called ${name}.`,
  ),
  stageGone: refusal(
    "stage_changed",
    "A stage changed since you opened this. Try again.",
  ),
  pickRole: refusal("pick_stage_role", "Pick a role."),
  roleCantApprove: refusal(
    "role_cant_approve",
    (role: TeamRole) => `The ${ROLE_LABEL[role]} role can't approve.`,
  ),
  nameYourself: refusal(
    "names_yourself",
    "You can't name yourself as an approver.",
  ),
  auditorCantApprove: refusal(
    "auditor_cant_approve",
    (person: string) => `${person} is an Auditor and can't approve.`,
  ),
  adminWithoutTeamRole: refusal(
    "admin_without_team_role",
    (person: string) =>
      `${person} is a Platform Admin with no team role and can't approve.`,
  ),
  noActiveAccess: refusal(
    "no_active_access",
    (person: string) => `${person} has no active access.`,
  ),
  personTwice: refusal(
    "person_on_two_stages",
    (person: string, stage: number) =>
      `${person} already reviews stage ${stage}.`,
  ),
  stageWaiting: refusal(
    "stage_in_use",
    (count: number, name: string) =>
      `${plural(count, "version")} in review still ${pluralWord(count, "needs", "need")} ${name}.`,
  ),
  pickZone: refusal("pick_zone", "Pick a time zone from the list."),
} as const;
