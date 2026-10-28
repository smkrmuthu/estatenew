import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApp } from "../app-context";
import { Button, Card, Chip, Drawer, Field, FilterBar, FilterSearch, FilterSelect, Input, Notice, Select } from "../components/ui";
import { ApiError, api } from "../lib/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Could not reach the server.");
const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", ESTATE_MANAGER: "Estate manager", FIELD_SUPERVISOR: "Supervisor", AUDITOR: "Auditor (read only)" };

function tempPassword() {
  const words = ["coffee", "pepper", "estate", "harvest", "garden", "monsoon", "valley", "berry", "shade", "pulper"];
  const rand = (n: number) => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % n;
  const pick = () => words[rand(words.length)];
  return `${pick()}-${pick()}-${String(rand(10000)).padStart(4, "0")}`;
}

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  status: string;
  mfaEnabled: boolean;
  lockedUntil: string | null;
  lastSignInAt: string | null;
  grants: { role: string; estateId: string | null }[];
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "Never");

function AddUser({ onDone, onNote }: { onDone: () => void; onNote: (n: { tone: "ok" | "bad"; text: string }) => void }) {
  const app = useApp();
  const estates = app.ref?.estates ?? [];
  const [form, setForm] = useState({ username: "", displayName: "", password: tempPassword(), role: "FIELD_SUPERVISOR", allEstates: app.can("users.manage", null), estateIds: [] as string[] });
  const [error, setError] = useState("");
  const owner = form.role === "OWNER";

  async function add() {
    setError("");
    const grants = owner || form.allEstates ? [{ role: form.role, estateId: null }] : form.estateIds.map((estateId) => ({ role: form.role, estateId }));
    if (grants.length === 0) return setError("Choose at least one estate.");
    try {
      await api("/admin/users", { body: { username: form.username, displayName: form.displayName, password: form.password, grants } });
      onNote({
        tone: "ok",
        text: `Added ${form.username}. Temporary password: ${form.password} (they choose their own at first sign-in${owner ? "; in production they also set up an authenticator app" : ""}).`,
      });
      onDone();
    } catch (e) {
      setError(msg(e));
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="User name" htmlFor="u-name" hint="Lower case, for example manager">
          <Input id="u-name" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim().toLowerCase() })} />
        </Field>
        <Field label="Full name" htmlFor="u-display">
          <Input id="u-display" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label="Temporary password" htmlFor="u-pass" hint="They choose their own at first sign-in">
          <div className="flex gap-2">
            <Input id="u-pass" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <Button variant="secondary" onClick={() => setForm({ ...form, password: tempPassword() })}>
              New
            </Button>
          </div>
        </Field>
        <Field label="Role" htmlFor="u-role" hint={owner ? "In production the owner also uses an authenticator app" : undefined}>
          <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="FIELD_SUPERVISOR">Field supervisor: attendance, weigh-in, daily log</option>
            <option value="ESTATE_MANAGER">Estate manager: also approvals, corrections, lists</option>
            {app.isOwner && <option value="OWNER">Owner: everything, including users and settings</option>}
            <option value="AUDITOR">Auditor: read only</option>
          </Select>
        </Field>
      </div>
      {!owner && (
        <fieldset>
          <legend className="text-[0.8rem] font-medium text-muted">Estates</legend>
          <label className="mt-1 flex min-h-10 items-center gap-2">
            <input type="checkbox" checked={form.allEstates} disabled={!app.can("users.manage", null)} onChange={(e) => setForm({ ...form, allEstates: e.target.checked })} /> All estates
          </label>
          {!form.allEstates &&
            estates.map((e) => (
              <label key={e.id} className="flex min-h-10 items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.estateIds.includes(e.id)}
                  onChange={(ev) => setForm({ ...form, estateIds: ev.target.checked ? [...form.estateIds, e.id] : form.estateIds.filter((x) => x !== e.id) })}
                />{" "}
                {e.name}
              </label>
            ))}
        </fieldset>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!app.online || form.password.length < 12 || !/^[a-z0-9._-]{2,60}$/.test(form.username) || !form.displayName.trim()}>
          Add user
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EditUser({ user, onDone, onNote }: { user: UserRow; onDone: () => void; onNote: (n: { tone: "ok" | "bad"; text: string }) => void }) {
  const app = useApp();
  const estates = app.ref?.estates ?? [];
  const roles = [...new Set(user.grants.map((g) => g.role))];
  const ids = user.grants.flatMap((g) => (g.estateId ? [g.estateId] : []));
  const [form, setForm] = useState({
    displayName: user.displayName,
    role: roles[0] ?? "FIELD_SUPERVISOR",
    allEstates: user.grants.some((g) => g.estateId === null) || ids.length === 0,
    estateIds: ids,
  });
  const [error, setError] = useState("");
  const owner = form.role === "OWNER";

  async function save() {
    setError("");
    const grants = owner || form.allEstates ? [{ role: form.role, estateId: null }] : form.estateIds.map((estateId) => ({ role: form.role, estateId }));
    if (grants.length === 0) return setError("Choose at least one estate.");
    if (!form.displayName.trim()) return setError("Enter the person's name.");
    try {
      await api(`/admin/users/${user.id}`, { method: "PUT", body: { displayName: form.displayName.trim(), grants } });
      onNote({ tone: "ok", text: `Saved ${user.username}. They are signed out and see the new access when they sign in again.` });
      onDone();
    } catch (e) {
      setError(msg(e));
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {roles.length > 1 && <Notice tone="warn">This person has more than one role. Saving gives them the single role chosen here.</Notice>}
      <Field label="Full name" htmlFor="eu-display">
        <Input id="eu-display" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      </Field>
      <Field label="Role" htmlFor="eu-role" hint={owner ? "In production the owner also uses an authenticator app" : undefined}>
        <Select id="eu-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="FIELD_SUPERVISOR">Field supervisor: attendance, weigh-in, daily log</option>
          <option value="ESTATE_MANAGER">Estate manager: also approvals, corrections, lists</option>
          {app.isOwner && <option value="OWNER">Owner: everything, including users and settings</option>}
          <option value="AUDITOR">Auditor: read only</option>
        </Select>
      </Field>
      {!owner && (
        <fieldset>
          <legend className="text-[0.8rem] font-medium text-muted">Estates</legend>
          <label className="mt-1 flex min-h-10 items-center gap-2">
            <input type="checkbox" checked={form.allEstates} disabled={!app.can("users.manage", null)} onChange={(e) => setForm({ ...form, allEstates: e.target.checked })} /> All estates
          </label>
          {!form.allEstates &&
            estates.map((e) => (
              <label key={e.id} className="flex min-h-10 items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.estateIds.includes(e.id)}
                  onChange={(ev) => setForm({ ...form, estateIds: ev.target.checked ? [...form.estateIds, e.id] : form.estateIds.filter((x) => x !== e.id) })}
                />{" "}
                {e.name}
              </label>
            ))}
        </fieldset>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="flex gap-2">
        <Button type="submit">Save changes</Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function Users() {
  const app = useApp();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<UserRow[]>("/admin/users"), enabled: app.online });
  const estates = app.ref?.estates ?? [];
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [q, setQ] = useState("");
  const [fRole, setFRole] = useState("");
  const [fEstate, setFEstate] = useState("");
  const [fStatus, setFStatus] = useState("");
  const estateName = (id: string | null) => (id ? (estates.find((e) => e.id === id)?.name ?? "an estate") : "All estates");
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
  const estatesOf = (u: UserRow) => [...new Set(u.grants.map((g) => estateName(g.estateId)))].join(", ");
  const rolesOf = (u: UserRow) => [...new Set(u.grants.map((g) => g.role))];

  const locked = (u: UserRow) => !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
  const all = users.data ?? [];
  const list = all.filter(
    (u) =>
      (!q || `${u.displayName} ${u.username}`.toLowerCase().includes(q.toLowerCase())) &&
      (!fRole || rolesOf(u).includes(fRole)) &&
      (!fEstate || u.grants.some((g) => g.estateId === null || g.estateId === fEstate)) &&
      (!fStatus || (fStatus === "ACTIVE" ? u.status === "ACTIVE" && !locked(u) : fStatus === "LOCKED" ? locked(u) : u.status !== "ACTIVE")),
  );
  const filtersOn = !!(q || fRole || fEstate || fStatus);

  if (!app.online) return <Notice tone="warn">Users need signal.</Notice>;

  async function resetPassword(u: UserRow) {
    const password = tempPassword();
    if (!window.confirm(`Give ${u.displayName} a new temporary password? They will be signed out everywhere and must choose their own at next sign-in.`)) return;
    try {
      await api(`/admin/users/${u.id}/password`, { body: { password } });
      setNote({ tone: "ok", text: `New temporary password for ${u.username}: ${password}` });
      void refresh();
    } catch (e) {
      setNote({ tone: "bad", text: msg(e) });
    }
  }

  async function enable(u: UserRow) {
    try {
      await api(`/admin/users/${u.id}/enable`, { body: {} });
      setNote({ tone: "ok", text: `${u.username} can sign in again with their current password.` });
      void refresh();
    } catch (e) {
      setNote({ tone: "bad", text: msg(e) });
    }
  }

  async function disable(u: UserRow) {
    const reason = window.prompt(`Why disable ${u.displayName}?`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await api(`/admin/users/${u.id}/disable`, { body: { reason: reason.trim() } });
      setNote({ tone: "ok", text: `${u.username} is disabled and signed out.` });
      void refresh();
    } catch (e) {
      setNote({ tone: "bad", text: msg(e) });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Users and roles</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">Each person signs in with their own username. Their role decides which screens they see.</p>
        </div>
        <Button onClick={() => setAdding(true)}>Add user</Button>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Card title="People with access">
        {users.isLoading && <p>Loading…</p>}
        <div className="mb-3">
          <FilterBar
            shown={list.length}
            total={all.length}
            noun="people"
            active={filtersOn}
            onClear={() => {
              setQ("");
              setFRole("");
              setFEstate("");
              setFStatus("");
            }}
          >
            <FilterSearch label="Find a person" value={q} onChange={setQ} placeholder="Name or username" />
            <FilterSelect label="Role" value={fRole} onChange={setFRole} options={[{ value: "", label: "All roles" }, ...Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))]} />
            <FilterSelect label="Estate" value={fEstate} onChange={setFEstate} options={[{ value: "", label: "All estates" }, ...estates.map((e) => ({ value: e.id, label: e.name }))]} />
            <FilterSelect
              label="Status"
              value={fStatus}
              onChange={setFStatus}
              options={[
                { value: "", label: "All" },
                { value: "ACTIVE", label: "Active" },
                { value: "LOCKED", label: "Locked" },
                { value: "INACTIVE", label: "Inactive" },
              ]}
            />
          </FilterBar>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-sm">
            <thead className="border-b border-line">
              <tr>
                {["Name", "Role", "Estates", "Last sign-in", "Status", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[0.8rem] font-medium text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold">{u.displayName}</p>
                    <p className="font-mono text-xs text-muted">{u.username}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {rolesOf(u).map((r) => (
                        <Chip key={r} tone={r === "OWNER" ? "bad" : "info"}>
                          {ROLE_LABEL[r] ?? r}
                        </Chip>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{estatesOf(u)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{when(u.lastSignInAt)}</td>
                  <td className="px-3 py-2.5">
                    {u.status !== "ACTIVE" ? <Chip>Inactive</Chip> : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <Chip tone="warn">Locked</Chip> : <Chip tone="ok">Active</Chip>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {u.id !== app.session.user.id && (app.isOwner || !rolesOf(u).includes("OWNER")) && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                          Edit
                        </Button>
                        {u.status === "ACTIVE" ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => resetPassword(u)}>
                              New password
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => disable(u)}>
                              Disable
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => enable(u)}>
                            Enable
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {editing && (
        <Drawer title={editing.displayName} subtitle="Edit user" onClose={() => setEditing(null)}>
          <EditUser
            user={editing}
            onNote={setNote}
            onDone={() => {
              setEditing(null);
              void refresh();
            }}
          />
        </Drawer>
      )}
      {adding && (
        <Drawer title="Add a user" subtitle="New user" onClose={() => setAdding(false)}>
          <AddUser
            onNote={setNote}
            onDone={() => {
              setAdding(false);
              void refresh();
            }}
          />
        </Drawer>
      )}
    </div>
  );
}
