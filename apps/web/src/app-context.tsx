import { can as canDo, type Permission } from "@cemms/domain";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";
import { db, type ReferenceData } from "./lib/db";
import { todayIn, useLive, useOnline } from "./lib/hooks";
import { counts } from "./lib/outbox";
import type { StoredSession } from "./lib/session";
import { type SyncReport, startAutoSync, syncNow } from "./lib/sync";

interface AppState {
  session: StoredSession;
  deviceId: string;
  ref: ReferenceData | null;
  refFetchedAt: string | null;
  estateId: string;
  setEstateId: (id: string) => void;
  date: string;
  setDate: (d: string) => void;
  online: boolean;
  can: (p: Permission, estateId?: string | null) => boolean;
  reloadReference: () => Promise<void>;
  sync: () => Promise<SyncReport>;
  lastReport: SyncReport | null;
  queue: { waiting: number; rejected: number; conflict: number; otherUsersWaiting: number };
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

export function AppProvider({ session, deviceId, onSignOut, children }: { session: StoredSession; deviceId: string; onSignOut: () => Promise<void>; children: React.ReactNode }) {
  const online = useOnline();
  const cached = useLive(() => db.reference.get(session.user.tenantId), [session.user.tenantId], undefined);
  const ref = cached?.data ?? null;
  const [estateId, setEstateIdState] = useState<string>("");
  const timeZone = ref?.estates.find((e) => e.id === estateId)?.timeZone ?? "Asia/Kolkata";
  const [date, setDate] = useState(() => todayIn("Asia/Kolkata"));
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const queue = useLive(() => counts(session.user.id), [session.user.id], { waiting: 0, rejected: 0, conflict: 0, otherUsersWaiting: 0 });

  const reloadReference = useCallback(async () => {
    const data = await api<ReferenceData>("/reference");
    await db.reference.put({ tenantId: session.user.tenantId, data, fetchedAt: new Date().toISOString() });
  }, [session.user.tenantId]);

  useEffect(() => {
    if (online) void reloadReference().catch(() => {});
  }, [online, reloadReference]);

  useEffect(() => {
    if (!estateId && ref?.estates[0]) setEstateIdState(ref.estates[0].id);
  }, [ref, estateId]);

  useEffect(() => setDate(todayIn(timeZone)), [timeZone]);

  useEffect(() => startAutoSync(session.user.id, deviceId, setLastReport), [session.user.id, deviceId]);

  const value = useMemo<AppState>(
    () => ({
      session,
      deviceId,
      ref,
      refFetchedAt: cached?.fetchedAt ?? null,
      estateId,
      setEstateId: setEstateIdState,
      date,
      setDate,
      online,
      can: (p, e = estateId) => canDo(session.user.grants, p, e ?? null),
      reloadReference,
      sync: async () => {
        const r = await syncNow(session.user.id, deviceId, true);
        setLastReport(r);
        return r;
      },
      lastReport,
      queue,
      signOut: onSignOut,
    }),
    [session, deviceId, ref, cached?.fetchedAt, estateId, date, online, reloadReference, lastReport, queue, onSignOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
