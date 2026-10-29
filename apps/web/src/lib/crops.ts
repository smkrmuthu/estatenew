import { useQuery } from "@tanstack/react-query";
import { useApp } from "../app-context";
import { api } from "./api";

const KEY = "cemms.crops.enabled";

function remembered(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(list) && list.every((c) => typeof c === "string")) return list as string[];
  } catch {
    // Storage can be blocked; Coffee only is the safe answer.
  }
  return ["COFFEE"];
}

/**
 * Which crops this estate uses. Coffee is always on; Pepper shows only when switched on in Manage.
 * The last answer is kept on the device so the phone still hides Pepper without signal.
 */
export function useCrops(): { enabled: string[]; pepper: boolean } {
  const app = useApp();
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ key: string; value: unknown }[]>("/admin/settings"),
    enabled: app.online,
  });
  const fromServer = q.data?.find((x) => x.key === "crops.enabled")?.value;
  let enabled: string[];
  if (Array.isArray(fromServer)) {
    enabled = fromServer as string[];
    try {
      window.localStorage.setItem(KEY, JSON.stringify(enabled));
    } catch {
      // Not remembering is fine.
    }
  } else enabled = remembered();
  return { enabled, pepper: enabled.includes("PEPPER") };
}
