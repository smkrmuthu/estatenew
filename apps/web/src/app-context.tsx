import { canAnyEstate, can as canDo, type Permission } from "@cemms/domain";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  /** Dashboard and Reports can show every estate together; capture screens always work on one. */
  allEstates: boolean;
  setAllEstates: (on: boolean) => void;
  date: string;
  setDate: (d: string) => void;
  online: boolean;
  can: (p: Permission, estateId?: string | null) => boolean;
  /** The permission on at least one estate: for lists every estate shares, and for users and setup. */
  canAny: (p: Permission) => boolean;
  isOwner: boolean;
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
  const [allEstates, setAllEstates] = useState(false);
  const timeZone = ref?.estates.find((e) => e.id === estateId)?.timeZone ?? "Asia/Kolkata";
  const [date, setDate] = useState(() => todayIn("Asia/Kolkata"));
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const queue = useLive(() => counts(session.user.id), [session.user.id], { waiting: 0, rejected: 0, conflict: 0, otherUsersWaiting: 0 });

  const qc = useQueryClient();

  /** Fetch the worker, field and job lists. Writes to the phone only when something changed, so screens do not redraw for nothing. */
  const loadReference = useCallback(async () => {
    const data = await api<ReferenceData>("/reference");
    const current = await db.reference.get(session.user.tenantId);
    if (current && JSON.stringify(current.data) === JSON.stringify(data)) return;
    await db.reference.put({ tenantId: session.user.tenantId, data, fetchedAt: new Date().toISOString() });
  }, [session.user.tenantId]);

  /** After something is changed here: reload the lists and make every screen read the server again. */
  const reloadReference = useCallback(async () => {
    await loadReference();
    await qc.invalidateQueries();
  }, [loadReference, qc]);

  // Other people add workers, fields and jobs too: look again on open, on coming back to the app, when signal returns and every minute.
  useEffect(() => {
    if (!online) return;
    const go = () => void loadReference().catch(() => {});
    const onVisible = () => document.visibilityState === "visible" && go();
    go();
    window.addEventListener("focus", go);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(go, 60_000);
    return () => {
      window.removeEventListener("focus", go);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [online, loadReference]);

  // The server has just accepted, refused or flagged something from this phone: every total and list is out of date.
  useEffect(() => {
    if (lastReport && lastReport.sent > 0) void qc.invalidateQueries();
  }, [lastReport, qc]);

  useEffect(() => {
    if (!estateId && ref?.estates[0]) setEstateIdState(ref.estates[0].id);
  }, [ref, estateId]);

  useEffect(() => setDate(todayIn(timeZone)), [timeZone]);

  // Left open past midnight: a screen that was showing today moves on to the new day by itself. A date picked by hand stays.
  const todayRef = useRef(todayIn(timeZone));
  useEffect(() => {
    const rollOver = () => {
      const now = todayIn(timeZone);
      const before = todayRef.current;
      if (now === before) return;
      todayRef.current = now;
      setDate((d) => (d === before ? now : d));
    };
    todayRef.current = todayIn(timeZone);
    const timer = window.setInterval(rollOver, 30_000);
    document.addEventListener("visibilitychange", rollOver);
    window.addEventListener("focus", rollOver);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", rollOver);
      window.removeEventListener("focus", rollOver);
    };
  }, [timeZone]);

  useEffect(() => startAutoSync(session.user.id, deviceId, setLastReport), [session.user.id, deviceId]);

  const value = useMemo<AppState>(
    () => ({
      session,
      deviceId,
      ref,
      refFetchedAt: cached?.fetchedAt ?? null,
      estateId,
      setEstateId: setEstateIdState,
      allEstates,
      setAllEstates,
      date,
      setDate,
      online,
      can: (p, e = estateId) => canDo(session.user.grants, p, e ?? null),
      canAny: (p) => canAnyEstate(session.user.grants, p),
      isOwner: session.user.grants.some((g) => g.role === "OWNER"),
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
    [session, deviceId, ref, cached?.fetchedAt, estateId, allEstates, date, online, reloadReference, lastReport, queue, onSignOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
