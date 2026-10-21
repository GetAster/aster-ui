import type { DataContext } from "@getaster/data";
import type { MockClient } from "@getaster/mock";
import type { Clock } from "./clock.ts";
import type { Model } from "./model.ts";

/** What the app is given at boot. */
export interface AppSetup {
  readonly ctx: DataContext;
  readonly mock: MockClient;
  readonly clock: Clock;
  readonly model: Model;
  readonly debug: boolean;
}
