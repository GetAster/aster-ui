/**
 * Display text with values in it: `"{name} ({count == 1 ? 'one task' : count})"`.
 * A template is parsed once, into a tree, and rendered by walking it; it's
 * never compiled to code, so it's safe from untrusted sources and under a
 * strict CSP. Inside braces: paths (`project.name`), string, number and
 * boolean literals, `null`, comparisons (`== != < <= > >=`), `&&`, `||`, `!`,
 * the conditional `a ? b : c` and parentheses. `{{` and `}}` are literal
 * braces. A null or missing value renders as nothing.
 */
export interface Template {
  readonly source: string;
  /** The paths it reads, for following them. */
  readonly paths: readonly string[];
  render(lookup: (path: string) => unknown): string;
}

type Node =
  | { readonly k: "lit"; readonly v: unknown }
  | { readonly k: "path"; readonly p: string }
  | { readonly k: "not"; readonly a: Node }
  | { readonly k: "bin"; readonly op: string; readonly a: Node; readonly b: Node }
  | { readonly k: "if"; readonly c: Node; readonly a: Node; readonly b: Node };

interface Token {
  readonly t: string;
  readonly kind: "num" | "str" | "id" | "op";
  readonly at: number;
}

export class TemplateError extends Error {
  constructor(message: string, source: string, at: number) {
    super(`${message} at ${at} in ${JSON.stringify(source)}`);
    this.name = "TemplateError";
  }
}

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)|(==|!=|<=|>=|&&|\|\||[<>!?:()]))/y;

export function parseTemplate(source: string): Template {
  const parts: (string | Node)[] = [];
  const paths = new Set<string>();
  let text = "";
  for (let i = 0; i < source.length; ) {
    const ch = source[i]!;
    if ((ch === "{" || ch === "}") && source[i + 1] === ch) {
      text += ch;
      i += 2;
    } else if (ch === "}") {
      throw new TemplateError("a '}' with no '{'", source, i);
    } else if (ch !== "{") {
      text += ch;
      i++;
    } else {
      if (text) parts.push(text);
      text = "";
      const end = source.indexOf("}", i);
      if (end < 0) throw new TemplateError("a '{' with no '}'", source, i);
      parts.push(parseExpr(source, tokenize(source, i + 1, end), end, paths));
      i = end + 1;
    }
  }
  if (text) parts.push(text);
  return {
    source,
    paths: [...paths],
    render: (lookup) => parts.map((p) => (typeof p === "string" ? p : show(evaluate(p, lookup)))).join(""),
  };
}

function tokenize(source: string, start: number, end: number): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = start;
  while (TOKEN.lastIndex < end && !/^\s*$/.test(source.slice(TOKEN.lastIndex, end))) {
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(source);
    if (!m || TOKEN.lastIndex > end) throw new TemplateError("unexpected text", source, at);
    if (m[1]) tokens.push({ t: m[1], kind: "num", at });
    else if (m[2]) tokens.push({ t: m[2], kind: "str", at });
    else if (m[3]) tokens.push({ t: m[3], kind: "id", at });
    else tokens.push({ t: m[4]!, kind: "op", at });
  }
  return tokens;
}

/** Precedence, loosest first: `?:`, `||`, `&&`, comparison, `!`. */
function parseExpr(source: string, tokens: readonly Token[], end: number, paths: Set<string>): Node {
  let n = 0;
  const peek = () => tokens[n]?.t;
  const take = (t?: string): Token => {
    const tok = tokens[n];
    if (!tok || (t !== undefined && tok.t !== t)) throw new TemplateError(t ? `expected '${t}'` : "expected a value", source, tok?.at ?? end);
    n++;
    return tok;
  };
  const conditional = (): Node => {
    const c = or();
    if (peek() !== "?") return c;
    take("?");
    const a = conditional();
    take(":");
    return { k: "if", c, a, b: conditional() };
  };
  const or = (): Node => {
    let a = and();
    while (peek() === "||") {
      take();
      a = { k: "bin", op: "||", a, b: and() };
    }
    return a;
  };
  const and = (): Node => {
    let a = compare();
    while (peek() === "&&") {
      take();
      a = { k: "bin", op: "&&", a, b: compare() };
    }
    return a;
  };
  const compare = (): Node => {
    const a = unary();
    const op = peek();
    if (op === undefined || !["==", "!=", "<", "<=", ">", ">="].includes(op)) return a;
    take();
    return { k: "bin", op, a, b: unary() };
  };
  const unary = (): Node => {
    if (peek() !== "!") return primary();
    take();
    return { k: "not", a: unary() };
  };
  const primary = (): Node => {
    const tok = take();
    switch (tok.kind) {
      case "num":
        return { k: "lit", v: Number(tok.t) };
      case "str":
        return { k: "lit", v: tok.t.slice(1, -1).replace(/\\(.)/g, "$1") };
      case "id":
        switch (tok.t) {
          case "true":
            return { k: "lit", v: true };
          case "false":
            return { k: "lit", v: false };
          case "null":
            return { k: "lit", v: null };
          default:
            paths.add(tok.t);
            return { k: "path", p: tok.t };
        }
      case "op": {
        if (tok.t !== "(") throw new TemplateError(`unexpected '${tok.t}'`, source, tok.at);
        const inner = conditional();
        take(")");
        return inner;
      }
    }
  };
  const node = conditional();
  if (n < tokens.length) throw new TemplateError("unexpected text", source, tokens[n]!.at);
  return node;
}

function evaluate(node: Node, lookup: (path: string) => unknown): unknown {
  switch (node.k) {
    case "lit":
      return node.v;
    case "path":
      return lookup(node.p) ?? null;
    case "not":
      return !truthy(evaluate(node.a, lookup));
    case "if":
      return truthy(evaluate(node.c, lookup)) ? evaluate(node.a, lookup) : evaluate(node.b, lookup);
    case "bin":
      return binary(node.op, node.a, node.b, lookup);
  }
}

function binary(op: string, left: Node, right: Node, lookup: (path: string) => unknown): unknown {
  switch (op) {
    case "&&":
      return truthy(evaluate(left, lookup)) && truthy(evaluate(right, lookup));
    case "||":
      return truthy(evaluate(left, lookup)) || truthy(evaluate(right, lookup));
    case "==":
      return evaluate(left, lookup) === evaluate(right, lookup);
    case "!=":
      return evaluate(left, lookup) !== evaluate(right, lookup);
    default: {
      // Ordering compares numbers with numbers and text with text; anything else is false.
      const a = evaluate(left, lookup);
      const b = evaluate(right, lookup);
      if (typeof a !== typeof b || (typeof a !== "number" && typeof a !== "string")) return false;
      const [x, y] = [a as number | string, b as number | string];
      return op === "<" ? x < y : op === "<=" ? x <= y : op === ">" ? x > y : x >= y;
    }
  }
}

function truthy(v: unknown): boolean {
  return v !== null && v !== undefined && v !== false && v !== "" && v !== 0;
}

function show(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}
