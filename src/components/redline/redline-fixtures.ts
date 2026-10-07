// A small redline for tests and for building UI before the diff is wired. It covers every block
// status, inline marks on text and on a chip, and a run of unchanged blocks to collapse.

import type { JSONContent, Variable } from "@/editor/model/types";
import type { RedlineDoc } from "@/domain/review-types";

export const REDLINE_VARIABLES: Variable[] = [
  { key: "intro_apr", label: "Intro APR", type: "percent", required: true, sample: "0" },
  { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" },
];

const ins = { type: "redline", attrs: { op: "insert" } } as const;
const del = { type: "redline", attrs: { op: "delete" } } as const;

const p = (id: string, ...content: JSONContent[]): JSONContent => ({ type: "paragraph", attrs: { id }, content });
const t = (text: string, mark?: typeof ins | typeof del): JSONContent => ({
  type: "text",
  text,
  ...(mark ? { marks: [mark] } : {}),
});

export const REDLINE_DOC: RedlineDoc = {
  counts: { added: 1, removed: 1, changed: 1, moved: 1 },
  blocks: [
    { id: "h-1", status: "unchanged", node: { type: "heading", attrs: { id: "h-1", level: 2, requiredKey: "offer_details" }, content: [t("Offer details")] } },
    { id: "p-1", status: "unchanged", node: p("p-1", t("Enjoy a special offer on balance transfers.")) },
    { id: "p-2", status: "unchanged", node: p("p-2", t("Transfers post within 14 days.")) },
    {
      id: "p-3",
      status: "changed",
      node: p(
        "p-3",
        t("The intro rate is "),
        { type: "variable", attrs: { key: "intro_apr" }, marks: [ins] },
        t(" for 6 months", del),
        t(" for 12 months", ins),
        t(" on transfers made in the first 60 days."),
      ),
    },
    { id: "p-4", status: "added", node: p("p-4", t("A balance transfer fee of 3% applies.")) },
    { id: "p-5", status: "removed", node: p("p-5", t("There is no annual fee for the first year, "), { type: "variable", attrs: { key: "annual_fee" } }, t(" after.")) },
    { id: "h-2", status: "moved", movedFrom: 6, node: { type: "heading", attrs: { id: "h-2", level: 2, requiredKey: "legal_notices" }, content: [t("Legal notices")] } },
    { id: "p-6", status: "unchanged", node: p("p-6", t("Subject to credit approval.")) },
  ],
};
