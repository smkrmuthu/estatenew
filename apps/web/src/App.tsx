import { useRegisterSW } from "virtual:pwa-register/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { AppProvider, useApp } from "./app-context";
import { Button, Notice, Select } from "./components/ui";
import { signOut as apiSignOut, refreshAccess } from "./lib/api";
import { getMeta, setMeta } from "./lib/db";
import { deviceId as getDeviceId, loadSession, type StoredSession, saveSession, sessionUsable } from "./lib/session";
import { Attendance } from "./screens/Attendance";
import { ChangePassword } from "./screens/ChangePassword";
import { DailyLog } from "./screens/DailyLog";
import { Manage } from "./screens/Manage";
import { SignIn } from "./screens/SignIn";
import { Summary } from "./screens/Summary";
import { Sync } from "./screens/Sync";
import { WeighIn } from "./screens/WeighIn";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, networkMode: "online" } } });

type Tab = "attendance" | "weighin" | "dailylog" | "summary" | "sync" | "manage" | "password";

function Shell() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "attendance");
  useEffect(() => {
    if (location.hash.slice(1) !== tab) location.hash = tab;
  }, [tab]);
  useEffect(() => {
    const onHash = () => setTab((location.hash.slice(1) as Tab) || "attendance");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const showManage = app.can("masters.import", null) || app.can("users.manage", null) || app.can("conflicts.resolve") || app.can("settings.manage", null);
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "attendance", label: "Attendance", show: app.can("attendance.read") },
    { id: "weighin", label: "Weigh-in", show: app.can("muster.read") },
    { id: "dailylog", label: "Daily log", show: app.can("dailylog.read") },
    { id: "summary", label: "Summary", show: app.can("reports.read") },
    { id: "sync", label: app.queue.waiting ? `Sync (${app.queue.waiting})` : "Sync", show: true },
    { id: "manage", label: "Manage", show: showManage },
  ];
  const estates = app.ref?.estates ?? [];
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col pb-20 sm:pb-6">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <img src="/icon.svg" alt="" className="h-8 w-8" />
            <div>
              <p className="font-bold leading-tight">{app.session.user.tenantName}</p>
              <p className="text-xs text-muted">{app.session.user.displayName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span role="status" className={`rounded-full px-2 py-1 text-xs font-semibold ${app.online ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>
              {app.online ? "Online" : "No signal"}
            </span>
            {app.queue.waiting > 0 && <span className="rounded-full bg-waiting/15 px-2 py-1 text-xs font-semibold text-waiting">{app.queue.waiting} waiting</span>}
            {app.queue.rejected > 0 && <span className="rounded-full bg-bad/15 px-2 py-1 text-xs font-semibold text-bad">{app.queue.rejected} not accepted</span>}
            <Button size="sm" variant="ghost" onClick={() => setTab("password")}>
              Password
            </Button>
            <Button size="sm" variant="ghost" onClick={() => app.signOut()}>
              Sign out
            </Button>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-md">
          <Select aria-label="Estate" value={app.estateId} onChange={(e) => app.setEstateId(e.target.value)}>
            {estates.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <input aria-label="Date" type="date" className="min-h-12 rounded-xl border border-line bg-surface px-3" value={app.date} onChange={(e) => e.target.value && app.setDate(e.target.value)} />
        </div>
        <nav aria-label="Main" className="mt-3 hidden gap-2 sm:flex">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <Button key={t.id} size="sm" variant={tab === t.id ? "primary" : "secondary"} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
                {t.label}
              </Button>
            ))}
        </nav>
      </header>
      <main className="flex-1 p-4">
        {estates.length === 0 && app.ref && <Notice tone="warn">No estates yet. The owner imports the estate list under Manage → Import.</Notice>}
        {tab === "attendance" && <Attendance />}
        {tab === "weighin" && <WeighIn />}
        {tab === "dailylog" && <DailyLog />}
        {tab === "summary" && <Summary />}
        {tab === "sync" && <Sync />}
        {tab === "manage" && <Manage />}
        {tab === "password" && (
          <ChangePassword
            required={false}
            onDone={() => {
              window.alert("Password changed. Your other devices are signed out.");
              setTab("attendance");
            }}
            onCancel={() => setTab("attendance")}
          />
        )}
      </main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-surface sm:hidden">
        {tabs
          .filter((t) => t.show && t.id !== "manage")
          .slice(0, 5)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
              className={`min-h-14 px-1 text-xs font-semibold ${tab === t.id ? "text-caramel" : "text-muted"}`}
            >
              {t.label}
            </button>
          ))}
      </nav>
      {showManage && (
        <div className="px-4 sm:hidden">
          <Button variant="secondary" className="w-full" onClick={() => setTab("manage")}>
            Manage
          </Button>
        </div>
      )}
    </div>
  );
}

function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-4 bottom-24 z-20 sm:bottom-6">
      <Notice>
        A new version is ready.{" "}
        <Button size="sm" onClick={() => updateServiceWorker(true)}>
          Update
        </Button>
      </Notice>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<StoredSession | null | undefined>(undefined);
  const [deviceId, setDeviceId] = useState<string>("");
  const [lastTenant, setLastTenant] = useState<string | undefined>();

  useEffect(() => {
    void (async () => {
      setDeviceId(await getDeviceId());
      setLastTenant(await getMeta<string>("lastTenant"));
      const stored = await loadSession();
      if (!sessionUsable(stored)) return setSession(null);
      // Online: get an access token from the refresh cookie. Offline: keep working on the phone.
      if (navigator.onLine) {
        const fresh = await refreshAccess().catch(() => undefined);
        if (fresh === null) {
          await saveSession(null);
          return setSession(null);
        }
      }
      setSession(stored);
    })();
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    await saveSession(null);
    setSession(null);
  }, []);

  if (session === undefined || !deviceId) return <p className="p-6">Loading…</p>;
  if (!session)
    return (
      <SignIn
        lastTenant={lastTenant}
        onSignedIn={async (tenantCode, res) => {
          if (!("accessToken" in res)) return;
          const s: StoredSession = { tenantCode, user: res.user, sessionExpiresAt: res.sessionExpiresAt };
          await saveSession(s);
          await setMeta("lastTenant", tenantCode);
          setSession(s);
        }}
      />
    );
  if (session.user.mustChangePassword && navigator.onLine)
    return (
      <ChangePassword
        required
        onDone={async () => {
          const s: StoredSession = { ...session, user: { ...session.user, mustChangePassword: false } };
          await saveSession(s);
          setSession(s);
        }}
        onCancel={signOut}
      />
    );
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider session={session} deviceId={deviceId} onSignOut={signOut}>
        <Shell />
        <UpdateBanner />
      </AppProvider>
    </QueryClientProvider>
  );
}
