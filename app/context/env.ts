import { createContext, type RouterContextProvider } from "react-router";

/** The Worker's bindings, seeded once per request by workers/app.ts. */
export const envContext = createContext<Env | undefined>(undefined);

export function getEnv(context: Readonly<RouterContextProvider>): Env {
  const env = context.get(envContext);
  if (!env) {
    throw new Error("environment context was not seeded by the worker entry");
  }
  return env;
}
