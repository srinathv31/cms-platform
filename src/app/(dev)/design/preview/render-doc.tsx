import type { JSONContent, Variable } from "@/editor/model/types";
import { formatValue } from "@/editor/model/variables";
import { cn } from "@/lib/utils";

/*
 * A small stand-in for the render function, for this mock only: it walks the TipTap JSON, resolves
 * each variable chip to its formatted value, and prints blocks with a channel's class names. The real
 * renderer (src/server/render) produces the same shape of output.
 */

export interface Ctx {
  variables: Map<string, Variable>;
  values: Record<string, string>;
}

export function makeCtx(variables: Variable[], values: Record<string, string>): Ctx {
  return { variables: new Map(variables.map((v) => [v.key, v])), values };
}

/** The formatted value for a key ("21.99" → "21.99%", "NJ" → "New Jersey"); the label when there is none. */
function valueOf(key: string, ctx: Ctx): string {
  const variable = ctx.variables.get(key);
  if (!variable) return key;
  const raw = ctx.values[key];
  if (raw === undefined || raw === "") return variable.label;
  return formatValue(variable.type, raw);
}

/** Inline content as one plain string (subject lines, preheaders). */
export function inlineText(nodes: JSONContent[] | undefined, ctx: Ctx): string {
  return (nodes ?? [])
    .map((n) => (n.type === "variable" ? valueOf(String(n.attrs?.key ?? ""), ctx) : (n.text ?? "")))
    .join("");
}

export interface Theme {
  p: string;
  h2: string;
  h3: string;
  ul: string;
  ol: string;
  li: string;
  table: string;
  th: string;
  td: string;
  callout: string;
  hr: string;
  link: string;
}

function Inline({ nodes, ctx, theme }: { nodes: JSONContent[] | undefined; ctx: Ctx; theme: Theme }) {
  return (
    <>
      {(nodes ?? []).map((node, i) => {
        if (node.type === "variable") {
          return (
            <span key={i} className="[overflow-wrap:anywhere]">
              {valueOf(String(node.attrs?.key ?? ""), ctx)}
            </span>
          );
        }
        let out: React.ReactNode = node.text ?? "";
        for (const mark of node.marks ?? []) {
          if (mark.type === "bold") out = <strong className="font-semibold">{out}</strong>;
          else if (mark.type === "italic") out = <em>{out}</em>;
          else if (mark.type === "underline") out = <span className="underline">{out}</span>;
          else if (mark.type === "link") out = <span className={theme.link}>{out}</span>;
        }
        return <span key={i}>{out}</span>;
      })}
    </>
  );
}

function Block({ node, ctx, theme, inCell = false, first = false }: { node: JSONContent; ctx: Ctx; theme: Theme; inCell?: boolean; first?: boolean }) {
  const kids = node.content;
  switch (node.type) {
    case "paragraph":
      return (
        <p className={inCell ? "m-0" : theme.p}>
          <Inline nodes={kids} ctx={ctx} theme={theme} />
        </p>
      );
    case "heading": {
      const level = Number(node.attrs?.level ?? 2);
      const Tag = level === 3 ? "h3" : "h2";
      return (
        <Tag className={cn(level === 3 ? theme.h3 : theme.h2, first && "mt-0")}>
          <Inline nodes={kids} ctx={ctx} theme={theme} />
        </Tag>
      );
    }
    case "bulletList":
    case "orderedList": {
      const List = node.type === "bulletList" ? "ul" : "ol";
      return (
        <List className={node.type === "bulletList" ? theme.ul : theme.ol}>
          {(kids ?? []).map((item, i) => (
            <li key={i} className={theme.li}>
              {(item.content ?? []).map((child, j) => (
                <Block key={j} node={child} ctx={ctx} theme={theme} inCell />
              ))}
            </li>
          ))}
        </List>
      );
    }
    case "table":
      return (
        <table className={theme.table}>
          <tbody>
            {(kids ?? []).map((tr, i) => (
              <tr key={i}>
                {(tr.content ?? []).map((cell, j) => {
                  const Cell = cell.type === "tableHeader" ? "th" : "td";
                  return (
                    <Cell key={j} className={Cell === "th" ? theme.th : theme.td}>
                      {(cell.content ?? []).map((child, k) => (
                        <Block key={k} node={child} ctx={ctx} theme={theme} inCell />
                      ))}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "callout":
      return (
        <div className={theme.callout}>
          {(kids ?? []).map((child, i) => (
            <Block key={i} node={child} ctx={ctx} theme={theme} inCell />
          ))}
        </div>
      );
    case "horizontalRule":
      return <hr className={theme.hr} />;
    default:
      return null;
  }
}

export function Blocks({ blocks, ctx, theme }: { blocks: JSONContent[]; ctx: Ctx; theme: Theme }) {
  return (
    <>
      {blocks.map((node, i) => (
        <Block key={i} node={node} ctx={ctx} theme={theme} first={i === 0} />
      ))}
    </>
  );
}
