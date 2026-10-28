import { useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Notice, StatusBadge } from "../components/ui";
import { db, getMeta, type OutboxItem } from "../lib/db";
import { useLive } from "../lib/hooks";
import { dismissRejected } from "../lib/outbox";

export function Sync() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const lastSync = useLive(() => getMeta<string>("lastSyncAt"), [], undefined);
  const items = useLive(() => db.outbox.orderBy("createdAt").reverse().limit(200).toArray(), [], [] as OutboxItem[]);
  const mine = items.filter((i) => i.userId === app.session.user.id);
  const r = app.lastReport;

  return (
    <div className="flex flex-col gap-4">
      <Card title="Sync">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Waiting", app.queue.waiting],
            ["Not accepted", app.queue.rejected],
            ["Need a manager", app.queue.conflict],
            ["Last sync", lastSync ? new Date(lastSync).toLocaleString() : "Never"],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-xl bg-bg p-3">
              <dt className="text-sm text-muted">{k}</dt>
              <dd className="text-xl font-bold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            disabled={busy || !app.online}
            onClick={async () => {
              setBusy(true);
              await app.sync().finally(() => setBusy(false));
            }}
          >
            {busy ? "Syncing…" : "Sync now"}
          </Button>
          {!app.online && <span className="text-muted">No signal. Entries stay safe on this phone.</span>}
          {r?.error === "signed-out" && <Notice tone="warn">Sign in again to upload. Nothing is lost.</Notice>}
        </div>
        {app.queue.otherUsersWaiting > 0 && <Notice tone="warn">{app.queue.otherUsersWaiting} entries from another user are waiting on this phone. They upload when that user signs in.</Notice>}
        <p className="mt-3 text-sm text-muted">This phone uploads when the app opens, when signal returns, and every minute while it is open. Keep the app open for a moment after you get signal.</p>
      </Card>
      <Card title="Entries on this phone">
        <ul className="divide-y divide-line">
          {mine.map((i) => (
            <li key={i.mutationId} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="font-semibold">{i.label}</p>
                <p className="text-sm text-muted">{new Date(i.createdAt).toLocaleString()}</p>
                {i.result?.message && i.status !== "accepted" && <p className="text-sm text-bad">{i.result.message}</p>}
                {i.status === "waiting" && i.attempts > 0 && <p className="text-sm text-muted">Tried {i.attempts} time(s); will try again.</p>}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={i.status} />
                {i.status === "rejected" && (
                  <Button size="sm" variant="ghost" onClick={() => dismissRejected(i.mutationId)}>
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
          {mine.length === 0 && <li className="py-2 text-muted">Nothing recorded on this phone yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
