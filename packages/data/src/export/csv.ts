import type { DataContext } from "../context.ts";
import type { Query } from "../criteria/ast.ts";
import { relatedOf, resolveRelative } from "../criteria/relative.ts";
import type { Value } from "../schema/model.ts";
import { keyFromText, type KeyText } from "../store/keys.ts";
import type { StoredRecord } from "../store/store.ts";

/** A plain metadata field and its CSV header, in output order. */
export interface ExportColumn {
  /** Direct metadata property to export. */
  readonly field: string;
  /** Header text; defaults to the metadata title or field name. */
  readonly title?: string;
}

export interface CsvOptions {
  /** Omit for all query results; provided keys export in this exact order. */
  readonly keys?: readonly KeyText[];
  readonly pageSize?: number;
  /** Exceeding the limit rejects the entire export. Default 100,000. */
  readonly maxRows?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (rows: number) => void;
}

/**
 * CSV from fresh server records, without altering the store or paging window.
 * The query, keys and columns are captured before the first request. The server
 * must provide snapshot consistency if records can move during a paged export.
 */
export async function exportCsv(ctx: DataContext, query: Query, columns: readonly ExportColumn[], options: CsvOptions = {}): Promise<string> {
  const snapshot = structuredClone(query);
  const q = snapshot.filter ? { ...snapshot, filter: resolveRelative(snapshot.filter, ctx.schema.set(snapshot.set).type, ctx.now(), relatedOf(ctx.schema, ctx.schema.set(snapshot.set).type)) } : snapshot;
  const type = ctx.schema.set(q.set).type;
  const fields = columns.map((c) => {
    const field = type.field(c.field);
    if (!field) throw new Error(`${q.set} has no export field ${c.field}`);
    return { field: c.field, title: c.title ?? field.title ?? c.field, type: field.type };
  });
  if (!fields.length) throw new Error("Choose at least one export column");
  const pageSize = options.pageSize ?? 500;
  const maxRows = options.maxRows ?? 100_000;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error("pageSize must be a positive safe integer");
  if (!Number.isSafeInteger(maxRows) || maxRows < 0 || maxRows >= Number.MAX_SAFE_INTEGER) throw new Error("maxRows must be a nonnegative safe integer below MAX_SAFE_INTEGER");
  const keys = options.keys ? [...new Set(options.keys)] : undefined;
  const check = () => options.signal?.throwIfAborted();
  check();
  if (keys && keys.length > maxRows) throw new Error(`Export exceeds ${maxRows} rows`);
  const lines = [fields.map((f) => csvCell(f.title, true)).join(",")];
  let count = 0;
  const append = (record: StoredRecord) => {
    if (++count > maxRows) throw new Error(`Export exceeds ${maxRows} rows`);
    lines.push(fields.map((f) => {
      if (record.hidden?.has(f.field) || (q.select && !q.select.includes(f.field)) || (record.known && !record.known.has(f.field))) return '""';
      return csvCell(record.entity[f.field] ?? null, f.type !== "Edm.Decimal" && f.type !== "Edm.Int64");
    }).join(","));
  };
  if (keys) {
    for (const key of keys) {
      check();
      const record = await ctx.source.get(q.set, keyFromText(key));
      check();
      append(record);
      options.onProgress?.(count);
    }
  } else {
    // An extra row detects overflow even when the count is absent or estimated.
    for (let skip = 0;;) {
      check();
      const top = Math.min(pageSize, maxRows - count + 1);
      const page = await ctx.source.query(q, { skip, top });
      check();
      for (const record of page.records) append(record);
      options.onProgress?.(count);
      if (page.records.length < top) break;
      skip += page.records.length;
    }
  }
  check();
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** Quote every cell; text that spreadsheets treat as a formula stays text. */
function csvCell(value: Value, text: boolean): string {
  let content = value === null ? "" : String(value);
  if (text && typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/u.test(content)) content = "\u0027" + content;
  return '"' + content.replaceAll('"', '""') + '"';
}
