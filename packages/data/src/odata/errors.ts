/** One problem in a failed request. `message` is the server's and is what's shown; `code` and `params` are stable, for localising it. */
export interface ErrorDetail {
  readonly code: string;
  readonly message: string;
  /** A property path, when the detail is about one field. */
  readonly target?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** A failed OData request, with the service's error object when it sent one. */
export class ODataError extends Error {
  readonly status: number;
  readonly code: string;
  readonly target: string | undefined;
  readonly details: readonly ErrorDetail[];
  /** The current ETag the server sent with a 412. */
  readonly etag: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details: readonly ErrorDetail[] = [],
    target?: string,
    etag?: string,
  ) {
    super(message);
    this.name = "ODataError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.target = target;
    this.etag = etag;
  }

  /** Someone changed the record since it was read (412). */
  get isConflict(): boolean {
    return this.status === 412;
  }

  /** The key is already taken (409). */
  get isDuplicate(): boolean {
    return this.status === 409;
  }

  /** Detail messages by property path. Details without a target are left out. */
  fieldErrors(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const d of this.details) {
      if (d.target) (out[d.target] ??= []).push(d.message);
    }
    return out;
  }
}

export function errorFromResponse(status: number, body: string, etag?: string): ODataError {
  try {
    const parsed = JSON.parse(body) as { error?: Record<string, unknown> };
    const e = parsed.error;
    if (e && typeof e === "object") {
      const details = Array.isArray(e.details)
        ? (e.details as Record<string, unknown>[]).map((d) => ({
            code: String(d.code ?? ""),
            message: String(d.message ?? ""),
            ...(typeof d.target === "string" ? { target: d.target } : {}),
            ...(typeof d.params === "object" && d.params !== null && !Array.isArray(d.params) ? { params: d.params as Record<string, unknown> } : {}),
          }))
        : [];
      return new ODataError(
        status,
        String(e.code ?? status),
        String(e.message ?? `Request failed with status ${status}`),
        details,
        typeof e.target === "string" ? e.target : undefined,
        etag,
      );
    }
  } catch {
    // Not JSON: fall through to a generic error.
  }
  return new ODataError(status, String(status), `Request failed with status ${status}`, [], undefined, etag);
}
