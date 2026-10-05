"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, MessageSquare, MessageSquarePlus } from "lucide-react";
import { VariableChipView, type JSONContent } from "@/editor";
import type { RedlineBlock, RedlineStatus, ThreadView } from "@/domain/review-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VARIABLES, cleanNode, sectionOf } from "./fixtures";

/*
 * The version under review as a read-only document. One renderer for the clean view and the redline.
 *
 * Each block sits in a row with a gutter at its left (the 4.25rem the workspace's editor uses for its
 * block handle): the comment marker or, on hover, the add-comment button, and in the redline a 2px
 * change bar. Click a block, or select text inside one, to start a comment. The editor's own document
 * styles do the typography (each block sits in a `.ucomp-doc` of its own: the editor's stylesheet is
 * unlayered, so its margin resets would beat Tailwind margins on the rows if they sat inside it).
 */

export const GUTTER = "4.25rem";

export interface CommentRequest {
  blockId: string;
  quote?: string;
}

interface Quote {
  threadId: string;
  text: string;
  selected: boolean;
}

type Op = "insert" | "delete" | null;

interface Ctx {
  /** Every inline node counts as this op (an added or removed block). */
  forced: Op;
  quotes: Quote[];
  used: Set<string>;
  onThread: (id: string) => void;
}

const INS = "bg-positive-soft underline decoration-positive decoration-[1.5px] underline-offset-[0.22em]";
const DEL = "bg-danger-soft text-danger-text line-through decoration-danger-text/80 decoration-[1.5px]";

function opOf(node: JSONContent, ctx: Ctx): Op {
  if (ctx.forced) return ctx.forced;
  const mark = (node.marks ?? []).find((m) => m.type === "redline");
  return mark ? (mark.attrs?.op as Op) : null;
}

function withQuotes(text: string, ctx: Ctx): ReactNode {
  for (const q of ctx.quotes) {
    if (ctx.used.has(q.threadId)) continue;
    const at = text.indexOf(q.text);
    if (at < 0) continue;
    ctx.used.add(q.threadId);
    return (
      <>
        {text.slice(0, at)}
        <mark
          data-thread={q.threadId}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onThread(q.threadId);
          }}
          className={cn(
            "cursor-pointer rounded-[3px] px-px text-inherit transition-colors",
            q.selected ? "bg-warning-border" : "bg-warning-soft hover:bg-warning-border",
          )}
        >
          {text.slice(at, at + q.text.length)}
        </mark>
        {text.slice(at + q.text.length)}
      </>
    );
  }
  return text;
}

function Inline({ nodes, ctx }: { nodes: JSONContent[] | undefined; ctx: Ctx }) {
  return (
    <>
      {(nodes ?? []).map((node, i) => {
        const op = opOf(node, ctx);
        if (node.type === "variable") {
          const key = String(node.attrs?.key ?? "");
          return (
            <VariableChipView
              key={i}
              variableKey={key}
              variable={VARIABLES.find((v) => v.key === key)}
              className={cn(
                op === "insert" && "underline decoration-positive decoration-[1.5px] underline-offset-[0.22em] ring-1 ring-positive/40",
                op === "delete" && "line-through decoration-danger-text/80 decoration-[1.5px] opacity-60 ring-1 ring-danger/30",
              )}
            />
          );
        }
        let out: ReactNode = withQuotes(node.text ?? "", ctx);
        for (const mark of node.marks ?? []) {
          if (mark.type === "bold") out = <strong>{out}</strong>;
          else if (mark.type === "italic") out = <em>{out}</em>;
          else if (mark.type === "underline") out = <u>{out}</u>;
          else if (mark.type === "link") out = <a>{out}</a>;
        }
        if (op === "insert") out = <ins className={cn("no-underline", INS)}>{out}</ins>;
        if (op === "delete") out = <del className={cn("no-underline", DEL)}>{out}</del>;
        return <span key={i}>{out}</span>;
      })}
    </>
  );
}

function Node({ node, ctx }: { node: JSONContent; ctx: Ctx }) {
  const kids = node.content;
  switch (node.type) {
    case "paragraph":
      return (
        <p>
          <Inline nodes={kids} ctx={ctx} />
        </p>
      );
    case "heading": {
      const level = Number(node.attrs?.level ?? 2);
      const Tag = level === 1 ? "h1" : level === 3 ? "h3" : "h2";
      return (
        <Tag>
          <Inline nodes={kids} ctx={ctx} />
        </Tag>
      );
    }
    case "bulletList":
    case "orderedList": {
      const List = node.type === "bulletList" ? "ul" : "ol";
      return (
        <List>
          {(kids ?? []).map((item, i) => (
            <li key={i}>
              {(item.content ?? []).map((child, j) => (
                <Node key={j} node={child} ctx={ctx} />
              ))}
            </li>
          ))}
        </List>
      );
    }
    case "table":
      return (
        <div className="tableWrapper">
          <table>
            <tbody>
              {(kids ?? []).map((tr, i) => (
                <tr key={i}>
                  {(tr.content ?? []).map((cell, j) => {
                    const Cell = cell.type === "tableHeader" ? "th" : "td";
                    return (
                      <Cell key={j}>
                        {(cell.content ?? []).map((child, k) => (
                          <Node key={k} node={child} ctx={ctx} />
                        ))}
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout":
      return (
        <div data-callout="">
          {(kids ?? []).map((child, i) => (
            <Node key={i} node={child} ctx={ctx} />
          ))}
        </div>
      );
    case "horizontalRule":
      return <hr />;
    default:
      return null;
  }
}

// ── Gutter ───────────────────────────────────────────────────────

const BAR: Partial<Record<RedlineStatus, string>> = {
  added: "bg-positive",
  removed: "bg-danger",
  changed: "bg-text-subtle",
  moved: "bg-text-subtle",
};

function Marker({
  open,
  resolved,
  selected,
  onClick,
}: {
  open: number;
  resolved: number;
  selected: boolean;
  onClick: () => void;
}) {
  const live = open > 0;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={live ? `${open} open ${open === 1 ? "comment" : "comments"}` : "Resolved comment"}
      className={cn(
        "flex h-6 items-center gap-1 rounded-full border px-2 text-[12px] font-medium transition-colors",
        live
          ? "border-warning-border bg-warning-soft text-warning-text hover:bg-warning-border"
          : "border-hairline bg-surface text-text-subtle hover:bg-hover",
        selected && live && "bg-warning-border",
      )}
    >
      {live ? <MessageSquare aria-hidden strokeWidth={1.75} className="size-3.5" /> : <Check aria-hidden strokeWidth={2} className="size-3.5" />}
      {live ? open : resolved}
    </button>
  );
}

// ── Which blocks show, and the space between them ────────────────

interface Row {
  block: RedlineBlock;
  status: RedlineStatus;
  node: JSONContent;
  /** The margin above the row (the editor's rhythm). */
  top: string;
  /** Changes only drops the headings, so each stretch of changes says which section it is in. */
  caption: string | null;
}

function planRows(blocks: RedlineBlock[], redline: boolean, changesOnly: boolean): Row[] {
  // What shows: the clean v3, the redline, or only the blocks that changed.
  const shown = redline
    ? changesOnly
      ? blocks.filter((b) => b.status !== "unchanged")
      : blocks
    : blocks.filter((b) => b.status !== "removed");

  const rows: Row[] = [];
  let lastSection: string | null = null;
  let prev: JSONContent | null = null;
  for (const block of shown) {
    const status: RedlineStatus = redline ? block.status : "unchanged";
    const node = redline ? block.node : (cleanNode(block.node) ?? block.node);

    // Margin rhythm of the editor: 0.875rem between blocks, 2.25rem above a section head, 0.5rem under one.
    let top = "mt-3.5";
    const level = node.type === "heading" ? Number(node.attrs?.level ?? 2) : 0;
    if (prev === null) top = "mt-0";
    else if (prev.type === "heading") top = "mt-2";
    else if (level === 3) top = "mt-6";
    else if (level > 0) top = "mt-9";

    let caption: string | null = null;
    if (redline && changesOnly) {
      const section = sectionOf(blocks, blocks.indexOf(block));
      if (section !== lastSection) caption = section;
      lastSection = section;
    }
    rows.push({ block, status, node, top: caption ? "mt-0" : top, caption });
    prev = node;
  }
  return rows;
}

// ── The document ─────────────────────────────────────────────────

export function DocView({
  blocks,
  redline,
  changesOnly,
  threads,
  selectedId,
  composerBlock,
  flashBlock,
  onSelectThread,
  onComment,
}: {
  blocks: RedlineBlock[];
  redline: boolean;
  changesOnly: boolean;
  threads: ThreadView[];
  selectedId: string | null;
  /** The block a comment is being written on. */
  composerBlock: string | null;
  /** The block that was just scrolled to from the rail. */
  flashBlock: string | null;
  onSelectThread: (id: string) => void;
  onComment: (request: CommentRequest) => void;
}) {
  const [bubble, setBubble] = useState<{ x: number; y: number; blockId: string; quote: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hide = () => setBubble(null);
    const onSelection = () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed) setBubble(null);
    };
    document.addEventListener("selectionchange", onSelection);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  function onMouseUp() {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const start = range.startContainer.parentElement?.closest<HTMLElement>("[data-block-id]");
    const end = range.endContainer.parentElement?.closest<HTMLElement>("[data-block-id]");
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (!start || start !== end || !quote) {
      setBubble(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setBubble({
      x: rect.left + rect.width / 2,
      y: rect.top,
      blockId: start.dataset.blockId ?? "",
      quote: quote.length > 120 ? `${quote.slice(0, 118)}…` : quote,
    });
  }

  const rows = planRows(blocks, redline, changesOnly);

  return (
    <div ref={root} data-doc-view="" onMouseUp={onMouseUp} className="pb-6">
      {rows.map(({ block, status, node, top, caption }, index) => {
        const forced: Op = status === "added" ? "insert" : status === "removed" ? "delete" : null;

        const mine = threads.filter((t) => t.blockId === block.id);
        const open = mine.filter((t) => t.status === "open");
        const resolved = mine.filter((t) => t.status === "resolved");
        const quotes: Quote[] = mine
          .filter((t) => t.quote && (t.status === "open" || t.id === selectedId))
          .map((t) => ({ threadId: t.id, text: t.quote as string, selected: t.id === selectedId }));
        const ctx: Ctx = { forced, quotes, used: new Set(), onThread: onSelectThread };

        const composing = composerBlock === block.id;
        const selectedHere = mine.some((t) => t.id === selectedId);
        const flash = flashBlock === block.id;

        return (
          <div key={block.id}>
            {caption ? <div className={cn("caps-label mb-2", index === 0 ? "mt-0" : "mt-9")}>{caption}</div> : null}
            <div
              data-block-id={block.id}
              data-status={status}
              className={cn("group/block relative -ml-17 pl-17", top)}
            >
              {/* Gutter: the change bar, then the marker, or the add button on hover. */}
              {redline && BAR[status] ? (
                <span
                  aria-hidden
                  className={cn("absolute inset-y-1 left-[calc(4.25rem-0.875rem)] w-0.5 rounded-full", BAR[status])}
                />
              ) : null}
              <div className="absolute top-[2px] left-3">
                {mine.length > 0 ? (
                  <Marker
                    open={open.length}
                    resolved={resolved.length}
                    selected={selectedHere}
                    onClick={() => onSelectThread((open[0] ?? resolved[0]).id)}
                  />
                ) : (
                  <button
                    type="button"
                    aria-label="Comment on this block"
                    onClick={() => onComment({ blockId: block.id })}
                    className={cn(
                      "grid size-6 place-items-center rounded-full border border-hairline bg-surface text-text-muted transition-opacity hover:bg-hover hover:text-text",
                      "opacity-0 group-hover/block:opacity-100 focus-visible:opacity-100",
                      composing && "opacity-100",
                    )}
                  >
                    <MessageSquarePlus aria-hidden strokeWidth={1.75} className="size-3.5" />
                  </button>
                )}
              </div>
              {/* The tint behind the block, wider than the text. */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -inset-y-1 right-[-0.75rem] left-[calc(4.25rem-0.75rem)] rounded-lg transition-colors duration-500",
                  "group-hover/block:bg-hover/50",
                  (composing || selectedHere) && "bg-hover/60",
                  flash && "bg-warning-soft",
                )}
              />
              <div
                className="relative"
                onClick={() => {
                  if (document.getSelection()?.isCollapsed === false) return;
                  onComment({ blockId: block.id });
                }}
              >
                <div className="ucomp-doc" style={{ margin: 0, padding: 0, maxWidth: "none", cursor: "default" }}>
                  <Node node={node} ctx={ctx} />
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {bubble ? (
        <Button
          variant="outline"
          size="default"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onComment({ blockId: bubble.blockId, quote: bubble.quote });
            document.getSelection()?.removeAllRanges();
            setBubble(null);
          }}
          style={{ position: "fixed", left: bubble.x, top: bubble.y - 8, transform: "translate(-50%, -100%)" }}
          className="z-50 gap-1.5 bg-surface px-3 text-[13px] shadow-pop"
        >
          <MessageSquarePlus data-icon="inline-start" strokeWidth={1.75} />
          Comment
        </Button>
      ) : null}
    </div>
  );
}

