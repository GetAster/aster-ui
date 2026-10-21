export type DashboardValue = null | boolean | number | string | readonly DashboardValue[] | { readonly [key: string]: DashboardValue };
export type DashboardConfig = Readonly<Record<string, DashboardValue>>;
export type DashboardSize = 1 | 2 | 3;

export interface DashboardWidget {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly width: DashboardSize;
  readonly height: DashboardSize;
  readonly config?: DashboardConfig;
}

export interface DashboardSnapshot {
  readonly version: 1;
  readonly widgets: readonly DashboardWidget[];
}

/** Validate and copy before a layout operation acquires or releases content. */
export function copyLayout(widgets: readonly DashboardWidget[]): readonly DashboardWidget[] {
  if (!Array.isArray(widgets)) throw new TypeError("Dashboard widgets must be an array");
  const ids = new Set<string>();
  return Object.freeze(Array.from(widgets, widget => {
    if (!widget || typeof widget.id !== "string" || !widget.id.trim() || ids.has(widget.id)) throw new TypeError("Dashboard widget IDs must be unique and non-empty");
    ids.add(widget.id);
    if (typeof widget.type !== "string" || !widget.type.trim() || typeof widget.title !== "string" || !widget.title.trim()) throw new TypeError("Widgets require a type and title");
    if (![1, 2, 3].includes(widget.width) || ![1, 2, 3].includes(widget.height)) throw new TypeError("Widget sizes must be 1, 2 or 3");
    const config = widget.config === undefined ? {} : widget.config;
    if (!config || Array.isArray(config) || typeof config !== "object") throw new TypeError("Widget configuration must be a JSON object");
    return Object.freeze({ id: widget.id, type: widget.type, title: widget.title, width: widget.width, height: widget.height, config: copyValue(config, new Set(), 0) as DashboardConfig });
  }));
}

function copyValue(value: DashboardValue, seen: Set<object>, depth: number): DashboardValue {
  if (depth > 32) throw new TypeError("Widget configuration is too deeply nested");
  switch (typeof value) {
    case "string":
    case "boolean": return value;
    case "number":
      if (Number.isFinite(value)) return value;
      break;
    case "object": {
      if (value === null) return null;
      if (Object.getOwnPropertySymbols(value).length) throw new TypeError("Widget configuration cannot contain symbol keys");
      if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new TypeError("Widget arrays cannot have holes or extra properties");
      if (seen.has(value)) throw new TypeError("Widget configuration cannot contain cycles");
      if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) break;
      seen.add(value);
      const copied = Array.isArray(value) ? Array.from(value, item => copyValue(item, seen, depth + 1)) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item, seen, depth + 1)]));
      seen.delete(value);
      return Object.freeze(copied);
    }
  }
  throw new TypeError("Widget configuration must contain only finite JSON values");
}
