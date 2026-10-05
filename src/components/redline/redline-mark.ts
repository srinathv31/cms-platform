// The `redline` mark (domain/review-types.ts, RedlineMark): the diff's inline insertions and
// deletions, rendered as <ins> and <del>. Only the redline renderer's schema knows it; it is not an
// editor mark and never reaches a stored document.
//
// Insert: a soft positive tint with a green underline; the text is a darker green than the token
// (`--rl-ins-text`, redline.css) because the token on its own tint is 4.3:1.
// Delete: a soft danger tint with a red strike.
// (Token utilities only; `box-decoration-clone` keeps the tint whole when a run wraps.)

import { Mark } from "@tiptap/core";

export const INSERT_CLASS =
  "box-decoration-clone bg-positive-soft text-(--rl-ins-text) underline decoration-positive decoration-1 underline-offset-[0.2em]";
export const DELETE_CLASS =
  "box-decoration-clone bg-danger-soft text-danger-text line-through decoration-danger-text/70 decoration-1";

export const RedlineMark = Mark.create({
  name: "redline",
  inclusive: false,

  addAttributes() {
    return { op: { default: "insert", rendered: false } };
  },

  renderHTML({ mark }) {
    const deleted = mark.attrs.op === "delete";
    return [deleted ? "del" : "ins", { class: deleted ? DELETE_CLASS : INSERT_CLASS, "data-redline-op": deleted ? "delete" : "insert" }, 0];
  },
});
