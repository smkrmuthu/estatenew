import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export const controlDb = (env: Env) => drizzle(env.CONTROL_DB, { schema });
export type ControlDb = ReturnType<typeof controlDb>;
