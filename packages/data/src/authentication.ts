import { signal, type ReadonlySignal } from "@preact/signals-core";
import type { ODataRequest, ODataResponse, Transport } from "./transport.ts";

export type AuthenticationFailure = "cancelled" | "timeout" | "failed" | "identity-changed" | "retry-limit" | "replay-blocked" | "disposed";

/** Recovery failed without settling the original operation successfully. */
export class AuthenticationError extends Error {
  readonly reason: AuthenticationFailure;
  constructor(reason: AuthenticationFailure, options?: ErrorOptions) {
    super(`Authentication recovery: ${reason}`, options);
    this.name = "AuthenticationError";
    this.reason = reason;
  }
}

export interface AuthenticationChallenge {
  readonly request: ODataRequest;
  readonly response: ODataResponse;
}

export interface AuthenticationRecovery extends AuthenticationChallenge {
  /** Abort UI/SDK work when recovery times out, loses all waiters or is disposed. */
  readonly signal: AbortSignal;
  /** Stable account and tenant identity before the challenged operation. */
  readonly identity: string | undefined;
}

export interface AuthenticationOptions {
  /** Stable account/tenant key; undefined is allowed before initial login. */
  readonly identity: () => string | undefined;
  /** Resolves only after credentials are ready. Throw on cancellation or failure. */
  readonly recover: (context: AuthenticationRecovery) => Promise<void>;
  /** Defaults to HTTP 401. Restrict custom detection to trusted API responses. */
  readonly challenge?: (context: AuthenticationChallenge) => boolean;
  /** GET only by default. Opt in writes only with a server non-application guarantee or idempotency. */
  readonly replay?: (context: AuthenticationChallenge) => boolean;
  /** Rebuild credential headers on every send, including retries. */
  readonly credentials?: () => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;
  /** Total recovery deadline, including interaction. Defaults to five minutes. */
  readonly timeoutMs?: number;
}

interface Recovery {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
  waiters: number;
}

/** One authentication context shared by explicitly wrapped service transports. */
export class Authentication {
  readonly #options: AuthenticationOptions;
  readonly #timeout: number;
  readonly #lifetime = new AbortController();
  readonly #recovering = signal(false);
  readonly recovering: ReadonlySignal<boolean> = this.#recovering;
  #recovery: Recovery | undefined;
  #generation = 0;

  constructor(options: AuthenticationOptions) {
    const timeout = options.timeoutMs ?? 300_000;
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647) throw new RangeError("Authentication timeoutMs must be a positive timer integer");
    this.#options = Object.freeze({ ...options });
    this.#timeout = timeout;
  }

  /** Wrap only transports that belong to this identity/credential context. */
  wrap(transport: Transport): Transport {
    return async original => {
      const signal = original.signal ? AbortSignal.any([original.signal, this.#lifetime.signal]) : this.#lifetime.signal;
      const request = Object.freeze({ ...original, ...(original.headers ? { headers: Object.freeze({ ...original.headers }) } : {}), signal });
      const identity = this.#options.identity();
      let retried = false;
      for (;;) {
        signal.throwIfAborted();
        if (this.#recovery) await this.#join(this.#recovery, signal);
        this.#checkIdentity(identity);
        const generation = this.#generation;
        const credentials = this.#options.credentials ? await interrupted(Promise.resolve().then(() => { signal.throwIfAborted(); return this.#options.credentials!(); }), signal) : {};
        signal.throwIfAborted();
        this.#checkIdentity(identity);
        // Credential lookup can yield while another request starts recovery.
        if (this.#recovery || generation !== this.#generation) continue;
        const headers = new Headers(request.headers);
        for (const [key, value] of Object.entries(credentials)) headers.set(key, value);
        const response = await interrupted(Promise.resolve().then(() => { signal.throwIfAborted(); return transport({ ...request, headers: Object.fromEntries(headers) }); }), signal);
        const challenge = { request, response };
        if (!(this.#options.challenge?.(challenge) ?? response.status === 401)) return response;
        this.#checkIdentity(identity);
        if (retried) throw new AuthenticationError("retry-limit");
        if (!(this.#options.replay?.(challenge) ?? request.method === "GET")) throw new AuthenticationError("replay-blocked");
        retried = true;
        // A late response using old credentials shares the already completed recovery.
        if (generation === this.#generation) await this.#join(this.#recovery ?? this.#start(challenge, identity), signal);
      }
    };
  }

  #checkIdentity(expected: string | undefined): void {
    if (expected !== undefined && this.#options.identity() !== expected) throw new AuthenticationError("identity-changed");
  }

  #start(challenge: AuthenticationChallenge, identity: string | undefined): Recovery {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new AuthenticationError("timeout")), this.#timeout);
    const recovery: Recovery = {
      controller, waiters: 0,
      promise: Promise.resolve().then(async () => {
        controller.signal.throwIfAborted();
        await interrupted(Promise.resolve().then(() => this.#options.recover({ ...challenge, signal: controller.signal, identity })), controller.signal);
        this.#checkIdentity(identity);
        this.#generation++;
      }).catch(error => {
        throw error instanceof AuthenticationError ? error : new AuthenticationError("failed", { cause: error });
      }).finally(() => {
        clearTimeout(timer);
        if (this.#recovery === recovery) { this.#recovery = undefined; this.#recovering.value = false; }
      }),
    };
    this.#recovery = recovery;
    this.#recovering.value = true;
    return recovery;
  }

  async #join(recovery: Recovery, signal: AbortSignal): Promise<void> {
    recovery.waiters++;
    try { await interrupted(recovery.promise, signal); }
    finally {
      if (--recovery.waiters === 0 && this.#recovery === recovery) {
        this.#recovery = undefined;
        recovery.controller.abort(new AuthenticationError("cancelled"));
        this.#recovering.value = false;
      }
    }
  }

  /** Cancels waiting and in-flight wrapped requests; late recovery cannot resume them. */
  dispose(): void {
    this.#lifetime.abort(new AuthenticationError("disposed"));
    this.#recovery?.controller.abort(new AuthenticationError("disposed"));
  }
}

function interrupted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
