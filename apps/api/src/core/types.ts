import type { Grant } from "@cemms/domain";
import type { sessions, tenants, users } from "../control/schema";

export interface AuthState {
  user: typeof users.$inferSelect;
  tenant: typeof tenants.$inferSelect;
  session: typeof sessions.$inferSelect;
  grants: Grant[];
}

export interface AppEnv {
  Bindings: Env;
  Variables: { requestId: string; auth?: AuthState };
}
