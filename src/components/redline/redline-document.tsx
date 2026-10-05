// A redline: the diff of two versions, painted like the document itself.
//
// Server-safe (no hooks, no client APIs), so the review screen and the Versions tab can render it
// wherever they like. It renders RedlineDoc JSON (domain/redline.ts) with the same static renderer,
// schema, wrapper classes and chip component as <StaticDocument>, so the typography is the editor's.
//
//   inline        <ins> (green underline on a soft tint) and <del> (red strike on a soft tint), from
//                 the `redline` marks the diff puts on text and chips
//   added         a slim positive bar in the gutter (the block sits in an <ins>)
//   removed       the whole block struck, with a danger bar
//   changed       a neutral bar
//   moved         a small "Moved" label in the gutter
//   changesOnly   an unchanged heading becomes a caps caption over the changes under it (OFFER DETAILS),
//                 and each run of unchanged blocks collapses into one quiet "4 unchanged blocks" line
//   data-block-id every top-level block's frame carries its id (the review screen scrolls to a block
//                 and places comment markers beside it from these); `activeBlockId` tints one of them
//
// Every block that isn't unchanged is a labelled group ("Added block", "Moved block"...), so the
// gutter's meaning is spoken, not only colored. The gutter hangs left of the text, in the document's
// own gutter: size it with `--ucomp-doc-gutter` on the element or any ancestor (3.5rem by default;
// the "Moved" label needs about that much).

import { Children, type ReactElement, type ReactNode } from "react";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { baseExtensions, VariableChipView, type DocumentAlign, type JSONContent, type Variable } from "@/editor";
import "@/editor/styles.css";
import type { RedlineBlock, RedlineDoc, RedlineStatus } from "@/domain/review-types";
import { cn } from "@/lib/utils";
import { BLOCK_LABEL, blockKind, gapLabel, groupBlocks, markAllDeleted, type RedlineItem } from "./blocks";
import { RedlineMark } from "./redline-mark";
import "./redline.css";

export interface RedlineDocumentProps {
  doc: RedlineDoc;
  /** Labels the chips: pass the variables of the version(s) the diff is between. */
  variables: readonly Variable[];
  /** Show only what changed: unchanged headings become captions, runs of unchanged blocks one "N unchanged blocks" line. */
  changesOnly?: boolean;
  /** A block to mark as the one in focus (a tint behind it): the block of the comment thread being read. */
  activeBlockId?: string | null;
  /** Match the live editor's `align` (the gutter hangs into the left margin with "start"). Default "center". */
  align?: DocumentAlign;
  className?: string;
}

const BAR: Record<Exclude<RedlineStatus, "unchanged" | "moved">, string> = {
  added: "bg-positive",
  removed: "bg-danger",
  changed: "bg-text-subtle/60",
};

function Gutter({ status }: { status: Exclude<RedlineStatus, "unchanged"> }) {
  return (
    <>
      {status === "moved" ? (
        <span
          aria-hidden
          data-slot="redline-label"
          className="pointer-events-none absolute top-[0.3rem] right-full mr-[1.375rem] text-[11px] leading-none font-medium whitespace-nowrap text-text-muted"
        >
          Moved
        </span>
      ) : (
        <span
          aria-hidden
          data-slot="redline-bar"
          className={cn("pointer-events-none absolute inset-y-[0.15rem] -left-3.5 w-[3px] rounded-full", BAR[status])}
        />
      )}
    </>
  );
}

function Frame({ block, active, children }: { block: RedlineBlock; active: boolean; children: ReactNode }) {
  const { status } = block;
  // `data-id` is what the document's hover comment button looks for on a top-level block (a removed
  // block isn't in the version, so it can't be commented on).
  const identity = {
    "data-block-id": block.id,
    "data-id": status === "removed" ? undefined : block.id,
    "data-active": active ? "" : undefined,
  };
  if (status === "unchanged") {
    return (
      <div className="rl-item relative" data-kind={blockKind(block.node)} data-redline="unchanged" {...identity}>
        {children}
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-label={BLOCK_LABEL[status]}
      className="rl-item relative"
      data-kind={blockKind(block.node)}
      data-redline={status}
      {...identity}
    >
      <Gutter status={status} />
      {status === "added" ? <ins className="block no-underline">{children}</ins> : children}
    </div>
  );
}

/** The section an unchanged heading names, over the changes below it (Changes only). */
function Caption({ text }: { text: string }) {
  return (
    <div className="rl-item caps-label" data-kind="caption" data-redline-caption="">
      {text}
    </div>
  );
}

/** A run of unchanged blocks: a quiet count, where they were. */
function Gap({ count }: { count: number }) {
  return (
    <div className="rl-item text-[12px] leading-5 text-text-subtle" data-kind="gap" data-redline-gap="">
      {gapLabel(count)}
    </div>
  );
}

/** The node as painted: a removed block is struck whole. */
function paintedNode(block: RedlineBlock): JSONContent {
  return block.status === "removed" ? markAllDeleted(block.node) : block.node;
}

export function RedlineDocument({ doc, variables, changesOnly = false, activeBlockId = null, align = "center", className }: RedlineDocumentProps) {
  const byKey = new Map(variables.map((v) => [v.key, v]));
  const items: RedlineItem[] = groupBlocks(doc, changesOnly, new Map(variables.map((v) => [v.key, v.label])));
  const blocks = items.flatMap((item) => (item.type === "block" ? [item.block] : []));

  /** Everything but a block: the captions and the counts. */
  const aside = (item: RedlineItem, i: number): ReactNode =>
    item.type === "caption" ? <Caption key={`caption-${i}`} text={item.text} /> : item.type === "gap" ? <Gap key={`gap-${i}`} count={item.count} /> : null;

  // One render of all the blocks the document shows; the doc mapping puts each in its frame.
  const body: ReactNode =
    blocks.length === 0
      ? items.map(aside)
      : renderToReactElement({
          content: { type: "doc", content: blocks.map(paintedNode) },
          extensions: [...baseExtensions({ variables }), RedlineMark],
          options: {
            nodeMapping: {
              variable: ({ node }: { node: PMNode }) => {
                const key = (node.attrs.key as string | null) ?? null;
                return <VariableChipView variableKey={key} variable={key ? byKey.get(key) : undefined} />;
              },
              doc: ({ children }: { children?: ReactNode }) => {
                const rendered = Children.toArray(children) as ReactElement[];
                let at = 0;
                return (
                  <>
                    {items.map((item, i) =>
                      item.type === "block" ? (
                        <Frame key={`${i}-${item.block.id}`} block={item.block} active={item.block.id === activeBlockId}>
                          {rendered[at++]}
                        </Frame>
                      ) : (
                        aside(item, i)
                      ),
                    )}
                  </>
                );
              },
            },
          },
        });

  return (
    <div
      className={cn("ucomp-surface ucomp-redline relative", className)}
      data-redline-document=""
      data-static-document=""
      data-align={align === "start" ? "start" : undefined}
    >
      <div className="ucomp-doc">{body}</div>
    </div>
  );
}
