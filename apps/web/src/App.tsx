import { useRegisterSW } from "virtual:pwa-register/react";
import { addDays } from "@cemms/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { AppProvider, useApp } from "./app-context";
import { Icon, type IconName } from "./components/Icon";
import { Button, Notice, Select } from "./components/ui";
import { signOut as apiSignOut, refreshAccess } from "./lib/api";
import { getMeta, setMeta } from "./lib/db";
import { todayIn } from "./lib/hooks";
import { deviceId as getDeviceId, loadSession, type StoredSession, saveSession, sessionUsable } from "./lib/session";
import { Attendance } from "./screens/Attendance";
import { ChangePassword } from "./screens/ChangePassword";
import { DailyLog } from "./screens/DailyLog";
import { Dashboard } from "./screens/Dashboard";
import { Manage } from "./screens/Manage";
import { Masters } from "./screens/Masters";
import { SignIn } from "./screens/SignIn";
import { Summary } from "./screens/Summary";
import { Sync } from "./screens/Sync";
import { Users } from "./screens/Users";
import { WeighIn } from "./screens/WeighIn";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, networkMode: "online" } } });

type Tab = "dashboard" | "attendance" | "weighin" | "dailylog" | "summary" | "masters" | "users" | "sync" | "manage" | "password";
const TABS: Tab[] = ["dashboard", "attendance", "weighin", "dailylog", "summary", "masters", "users", "sync", "manage", "password"];
const tabFromHash = (): Tab => {
  const h = location.hash.slice(1) as Tab;
  return TABS.includes(h) ? h : "dashboard";
};
/** Pages that work on one estate and one day, so they show the estate and day picker. */
const DAY_PAGES: Tab[] = ["dashboard", "attendance", "weighin", "dailylog", "summary"];
const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  ESTATE_MANAGER: "Estate manager",
  FIELD_SUPERVISOR: "Field supervisor",
  AUDITOR: "Auditor",
  PROCESSING_OPERATOR: "Processing operator",
  QUALITY_OFFICER: "Quality officer",
  PACKING_OPERATOR: "Packing operator",
  PLATFORM_ADMIN: "Platform admin",
};

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const text = `${now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}, ${now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm font-medium tabular-nums md:inline-flex" title="Current time">
      <Icon name="clock" className="h-4 w-4" />
      {text}
    </span>
  );
}

function DayPicker() {
  const app = useApp();
  const estates = app.ref?.estates ?? [];
  const step = (n: number) => app.setDate(addDays(app.date, n));
  const weekday = new Date(`${app.date}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short" });
  const atToday = app.date >= todayIn(estates.find((e) => e.id === app.estateId)?.timeZone ?? "Asia/Kolkata");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
      <label htmlFor="pick-estate" className="flex items-center gap-2 text-[0.8rem] font-medium text-muted">
        Estate
        <Select id="pick-estate" className="!min-h-10 !w-auto" value={app.estateId} onChange={(e) => app.setEstateId(e.target.value)}>
          {estates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <button type="button" aria-label="Previous day" onClick={() => step(-1)} className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-surface text-lg hover:bg-surface-2">
          ‹
        </button>
        <label className="flex items-center gap-2">
          Day
          <input
            aria-label="Date"
            type="date"
            className="min-h-10 rounded-lg border border-line-strong bg-surface px-3 text-base"
            value={app.date}
            onChange={(e) => e.target.value && app.setDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          aria-label="Next day"
          disabled={atToday}
          onClick={() => step(1)}
          className="grid h-10 w-10 place-items-center rounded-lg border border-line-strong bg-surface text-lg hover:bg-surface-2 disabled:opacity-40"
        >
          ›
        </button>
        <span className="text-muted">{weekday}</span>
      </div>
    </div>
  );
}

function Shell() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  useEffect(() => {
    if (location.hash.slice(1) !== tab) location.hash = tab;
  }, [tab]);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const showManage = app.can("masters.import", null) || app.can("users.manage", null) || app.can("conflicts.resolve") || app.can("settings.manage", null);
  const tabs: { id: Tab; label: string; short: string; icon: IconName; count?: number; show: boolean }[] = [
    { id: "dashboard", label: "Dashboard", short: "Home", icon: "grid", show: app.can("reports.read") },
    { id: "attendance", label: "Attendance", short: "Attendance", icon: "users", show: app.can("attendance.read") },
    { id: "weighin", label: "Plucking", short: "Plucking", icon: "leaf", show: app.can("muster.read") },
    { id: "dailylog", label: "Daily log", short: "Daily log", icon: "cloud", show: app.can("dailylog.read") },
    { id: "summary", label: "Reports", short: "Reports", icon: "chart", show: app.can("reports.read") },
    { id: "masters", label: "Masters", short: "Masters", icon: "map", show: app.can("masters.read") },
    { id: "users", label: "Users", short: "Users", icon: "user", show: app.can("users.manage", null) },
    { id: "sync", label: "Sync", short: "Sync", icon: "sync", count: app.queue.waiting + app.queue.rejected + app.queue.conflict, show: true },
    { id: "manage", label: "Manage", short: "Manage", icon: "sliders", show: showManage },
  ];
  const visible = tabs.filter((t) => t.show);
  const current = visible.some((t) => t.id === tab) || tab === "password" ? tab : (visible[0]?.id ?? "sync");
  const estates = app.ref?.estates ?? [];
  const role = ROLE_LABEL[app.session.user.grants[0]?.role ?? ""] ?? "";
  return (
    <div className="min-h-dvh pb-20 lg:pb-0">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur-md backdrop-saturate-150">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="relative h-[17px] w-[14px] flex-none rounded-full bg-cherry after:absolute after:inset-y-[3px] after:left-1/2 after:w-[1.5px] after:-ml-[0.75px] after:rotate-[14deg] after:rounded-sm after:bg-surface"
          />
          <p className="flex items-center gap-2.5 font-semibold tracking-tight">
            CEMMS
            <span className="border-l border-line pl-2.5 text-[0.8rem] font-normal text-muted">{app.session.user.tenantName}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className={`rounded-full px-2 py-1 text-xs font-medium ${app.online ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>
            {app.online ? "Online" : "No signal"}
          </span>
          {app.queue.waiting > 0 && <span className="rounded-full bg-waiting/15 px-2 py-1 text-xs font-semibold text-waiting">{app.queue.waiting} waiting</span>}
          {app.queue.rejected > 0 && <span className="rounded-full bg-bad/15 px-2 py-1 text-xs font-semibold text-bad">{app.queue.rejected} not accepted</span>}
          <Clock />
          <div className="hidden text-right leading-tight sm:block">
            <p className="text-sm font-semibold">{app.session.user.displayName}</p>
            <p className="text-xs text-muted">{role}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setTab("password")}>
            Password
          </Button>
          <Button size="sm" variant="secondary" onClick={() => app.signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <div className="lg:grid lg:grid-cols-[14.5rem_1fr]">
        <nav aria-label="Main" className="sticky top-[3.75rem] hidden h-[calc(100dvh-3.75rem)] flex-col gap-0.5 overflow-y-auto border-r border-line p-3 lg:flex">
          {visible.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={current === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
              className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-left text-[0.9rem] transition-colors ${current === t.id ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
            >
              <Icon name={t.icon} className={`h-5 w-5 ${current === t.id ? "text-caramel" : ""}`} />
              <span className="flex-1">{t.label}</span>
              {!!t.count && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-waiting/15 px-1.5 text-xs font-semibold tabular-nums text-waiting">
                  {t.count}
                  <span className="sr-only"> need attention</span>
                </span>
              )}
            </button>
          ))}
        </nav>
        <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 p-4 lg:p-6">
          {DAY_PAGES.includes(current) && estates.length > 0 && <DayPicker />}
          {estates.length === 0 && app.ref && <Notice tone="warn">No estates yet. The owner imports the estate list under Manage → Import.</Notice>}
          {current === "dashboard" && <Dashboard go={setTab} />}
          {current === "attendance" && <Attendance />}
          {current === "weighin" && <WeighIn />}
          {current === "dailylog" && <DailyLog />}
          {current === "summary" && <Summary />}
          {current === "masters" && <Masters />}
          {current === "users" && <Users />}
          {current === "sync" && <Sync />}
          {current === "manage" && <Manage />}
          {current === "password" && (
            <ChangePassword
              required={false}
              onDone={() => {
                window.alert("Password changed. Your other devices are signed out.");
                setTab("dashboard");
              }}
              onCancel={() => setTab("dashboard")}
            />
          )}
        </main>
      </div>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={current === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
            className={`relative flex min-h-14 min-w-[4.75rem] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[0.7rem] font-semibold ${current === t.id ? "text-caramel" : "text-muted"}`}
          >
            <Icon name={t.icon} className="h-5 w-5" />
            {t.short}
            {!!t.count && <span className="absolute right-3 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-waiting px-1 text-[0.65rem] text-white">{t.count}</span>}
          </button>
        ))}
      </nav>
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
