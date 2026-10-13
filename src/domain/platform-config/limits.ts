// The limits platform settings hold to, and the facts about a team or a message content type that the
// other platform rules read.

export const TEAM_NAME_MAX = 60;
export const TEAM_DESCRIPTION_MAX = 200;
export const SECTION_TITLE_MAX = 60;
export const STAGE_NAME_MAX = 40;

/**
 * The parts an SMS may take with the "long" sample values before submit refuses it, unless the content
 * type sets its own (`content_types.sms_max_parts`). Render's own limit is far higher (SMS_MAX_PARTS).
 */
export const DEFAULT_SMS_MAX_PARTS = 3;

/** What a message content type adds to every SMS and allows of one (`content_types`). */
export interface MessageTypeRules {
  /** Printed after the message on its own line, exactly as written: the brand and the opt-out. Null: none. */
  smsFooter: string | null;
  /** Submit refuses an SMS over this many parts with the long sample values. */
  smsMaxParts: number;
}

/**
 * Who a team's messages come from, as the phone previews show it (`teams`): the app name over a push,
 * and the sender of an SMS (a US short code, since a US SMS can't show a brand name there). Null when
 * not set (a team made in settings): the push preview then shows the team's name, and the SMS preview
 * a neutral "No sender" (`phoneSenders` in components/preview/preview-sender.ts).
 */
export interface TeamSenders {
  appName: string | null;
  smsSender: string | null;
}

/** Lucide keys the team icon picker offers (the seed's teams use the first three). */
export const TEAM_ICONS = [
  "credit-card",
  "piggy-bank",
  "receipt-text",
  "landmark",
  "wallet",
  "home",
  "car",
  "briefcase",
  "shield-check",
  "scale",
  "megaphone",
  "building-2",
] as const;

/**
 * Slugs the app's own routes use: a team can't take them. Every top-level segment under src/app
 * (route groups looked through) must be here; teams.test.ts checks the folder.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "all",
  "api",
  "request-access",
  "sign-in",
  "editor-lab",
  "pdf-lab",
  "sim",
  "settings",
  "audit",
  "new",
  "_next",
]);
