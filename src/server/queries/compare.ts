// What the Compare dialog reads: GET /api/templates/[templateId]/compare answers the versions service's facts as
// they are (`VersionService.compare` in src/server/services/versions.ts): the names, bodies, channel fields, SMS
// footers and variable lists of the two versions being compared, and the template's family. The diff is computed
// in the dialog. Types only, under the names the dialog reads them by.

export type {
  ComparePairFacts as ComparePair,
  CompareVersionFacts as CompareVersion,
} from "@/server/services/versions";
