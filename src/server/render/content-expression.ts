// ProseMirror content expressions ("paragraph block*", "(tableCell | tableHeader)*") read into pieces: the
// one shape JSON Schema can state for a node's `content` array. A piece is a choice of node names or
// groups that appears between `min` and `max` times, in order. The JSON Schema generator
// (document-json-schema.ts) turns the pieces into `prefixItems`, `items`, `minItems` and `maxItems`.
//
// Only the expressions the editor's schema uses are read: a sequence of pieces, where a piece is a name
// or a parenthesized choice of names, with an optional `*`, `+`, `?` or `{n,m}`. An expression that
// nests a sequence in a choice ("a b | c") or repeats a sequence ("(a b)+") has no JSON Schema form and
// throws, so a new editor extension that needs one stops the generator instead of loosening the schema.

/** A choice of node names or groups, `min` to `max` times. */
export interface Piece {
  names: string[];
  min: number;
  /** `Infinity` for `*`, `+` and `{n,}`. */
  max: number;
}

type Node =
  | { kind: "name"; name: string }
  | { kind: "sequence"; items: Node[] }
  | { kind: "choice"; options: Node[] }
  | { kind: "repeat"; node: Node; min: number; max: number };

/** The pieces of a content expression, in order. The expression of a leaf node (none, or "") has none. */
export function contentPieces(expression: string): Piece[] {
  const tokens = expression.match(/\w+|[|()*+?{},]|\S/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const take = (token?: string) => {
    const next = tokens[at++];
    if (next === undefined || (token !== undefined && next !== token))
      throw unreadable(expression, `expected "${token ?? "a name"}"`);
    return next;
  };

  function parseChoice(): Node {
    const options = [parseSequence()];
    while (peek() === "|") {
      take("|");
      options.push(parseSequence());
    }
    return options.length === 1 ? options[0]! : { kind: "choice", options };
  }

  function parseSequence(): Node {
    const items: Node[] = [];
    while (peek() !== undefined && peek() !== "|" && peek() !== ")")
      items.push(parseRepeat());
    if (items.length === 0) throw unreadable(expression, "an empty choice");
    return items.length === 1 ? items[0]! : { kind: "sequence", items };
  }

  function parseRepeat(): Node {
    let node = parseAtom();
    for (;;) {
      const token = peek();
      if (token === "*") {
        take();
        node = repeat(node, 0, Infinity);
      } else if (token === "+") {
        take();
        node = repeat(node, 1, Infinity);
      } else if (token === "?") {
        take();
        node = repeat(node, 0, 1);
      } else if (token === "{") {
        node = parseBraces(node);
      } else {
        return node;
      }
    }
  }

  function parseBraces(node: Node): Node {
    take("{");
    const min = Number(take());
    let max = min;
    if (peek() === ",") {
      take(",");
      max = peek() === "}" ? Infinity : Number(take());
    }
    take("}");
    if (!Number.isInteger(min) || Number.isNaN(max) || max < min)
      throw unreadable(expression, "a bad {n,m} count");
    return repeat(node, min, max);
  }

  function parseAtom(): Node {
    if (peek() === "(") {
      take("(");
      const inner = parseChoice();
      take(")");
      return inner;
    }
    const name = take();
    if (!/^\w+$/.test(name)) throw unreadable(expression, `"${name}"`);
    return { kind: "name", name };
  }

  const repeat = (node: Node, min: number, max: number): Node => ({
    kind: "repeat",
    node,
    min,
    max,
  });

  if (tokens.length === 0) return [];
  const parsed = parseChoice();
  if (at < tokens.length) throw unreadable(expression, `"${peek()}"`);
  return (parsed.kind === "sequence" ? parsed.items : [parsed]).map((item) =>
    toPiece(item, expression),
  );
}

/** A name or a choice of names, once or repeated. */
function toPiece(node: Node, expression: string): Piece {
  if (node.kind === "repeat") {
    if (node.node.kind === "repeat")
      throw unreadable(expression, "a repeat of a repeat");
    const { names } = toPiece(node.node, expression);
    return { names, min: node.min, max: node.max };
  }
  if (node.kind === "name") return { names: [node.name], min: 1, max: 1 };
  if (node.kind === "choice") {
    const names = node.options.map((option) => {
      if (option.kind !== "name")
        throw unreadable(expression, "a choice of more than names");
      return option.name;
    });
    return { names, min: 1, max: 1 };
  }
  throw unreadable(expression, "a sequence inside a choice or a repeat");
}

function unreadable(expression: string, why: string): Error {
  return new Error(
    `The content expression "${expression}" can't be stated in JSON Schema (${why}). ` +
      `Extend src/server/render/content-expression.ts, or change the node's content.`,
  );
}
