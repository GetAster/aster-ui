/**
 * How the OData source reaches a service. `fetch` to a real server, or an
 * in-process call into the mock OData service; the source can't tell which.
 */
export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ODataRequest {
  readonly method: Method;
  /**
   * Relative to the service root, without a leading slash:
   * `Projects?$filter=state%20eq%20'active'`, `Projects(3)`, `$metadata`.
   * Query values are percent-encoded.
   */
  readonly url: string;
  /** Header names in any case. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Cancels this request, including any wait for authentication. */
  readonly signal?: AbortSignal;
}

export interface ODataResponse {
  readonly status: number;
  /** Header names lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type Transport = (request: ODataRequest) => Promise<ODataResponse>;

/** A transport over `fetch` to `serviceRoot` (no trailing slash). */
export function fetchTransport(serviceRoot: string, init?: RequestInit): Transport {
  return async (request) => {
    const init2: RequestInit = { ...init, method: request.method };
    const merged = new Headers(init?.headers);
    for (const [name, value] of Object.entries(request.headers ?? {})) merged.set(name, value);
    init2.headers = merged;
    if (request.signal) init2.signal = init?.signal ? AbortSignal.any([init.signal, request.signal]) : request.signal;
    if (request.body !== undefined) init2.body = request.body;
    const res = await fetch(`${serviceRoot}/${request.url}`, init2);
    const headers: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    return { status: res.status, headers, body: await res.text() };
  };
}
