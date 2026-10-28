import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadToDrive } from "../src/core/gdrive";
import { api, setupTenant } from "./helpers";

const cfg = { clientId: "client-id", clientSecret: "client-secret", refreshToken: "refresh-token" };

/** A tiny pretend Google: sign-in, a folder list and create, multipart upload, and download. */
function fakeGoogle(opts: { signIn?: number; corruptReadBack?: boolean; existingFolder?: boolean } = {}) {
  const calls: { url: string; method: string; body: string }[] = [];
  const files = new Map<string, string>();
  let n = 0;
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? "");
    calls.push({ url, method: init?.method ?? "GET", body });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return opts.signIn ? new Response("invalid_grant", { status: opts.signIn }) : Response.json({ access_token: "tok-1" });
    if (url.includes("/drive/v3/files?q=") || (url.includes("/drive/v3/files?") && (init?.method ?? "GET") === "GET" && url.includes("q=")))
      return Response.json({ files: opts.existingFolder ? [{ id: "folder-1" }] : [] });
    if (url.includes("/upload/drive/v3/files")) {
      const id = `file-${++n}`;
      files.set(id, body.split("\r\n\r\n")[2]?.split("\r\n--")[0] ?? "");
      return Response.json({ id });
    }
    if (url.includes("alt=media")) return new Response(opts.corruptReadBack ? "damaged" : (files.get(url.split("/files/")[1]?.split("?")[0] ?? "") ?? ""));
    if (url.includes("/drive/v3/files") && init?.method === "POST") return Response.json({ id: "folder-1" });
    return new Response("unexpected", { status: 500 });
  });
  return { f: f as unknown as typeof fetch, calls, files };
}

afterEach(() => {
  vi.unstubAllGlobals();
  const e = env as unknown as Record<string, string | undefined>;
  e.GDRIVE_CLIENT_ID = undefined;
  e.GDRIVE_CLIENT_SECRET = undefined;
  e.GDRIVE_REFRESH_TOKEN = undefined;
});

describe("google drive copy", () => {
  it("signs in with the refresh token, makes the app's folder once, uploads and reads each file back", async () => {
    const g = fakeGoogle();
    const out = await uploadToDrive(cfg, "CEMMS backups - test", [{ name: "a.json.enc", mime: "text/plain", body: "secret-bytes" }], g.f);
    expect(out.folderId).toBe("folder-1");
    expect(out.files).toEqual([{ name: "a.json.enc", id: "file-1" }]);
    expect(g.calls[0]?.body).toContain("grant_type=refresh_token");
    expect(g.calls[0]?.body).toContain("refresh_token=refresh-token");
    const upload = g.calls.find((c) => c.url.includes("/upload/"));
    expect(upload?.body).toContain('"parents":["folder-1"]');
    expect(upload?.body).toContain("secret-bytes");
    expect(g.calls.some((c) => c.method === "DELETE")).toBe(false);

    const again = fakeGoogle({ existingFolder: true });
    await uploadToDrive(cfg, "CEMMS backups - test", [{ name: "b.json.enc", mime: "text/plain", body: "x" }], again.f);
    expect(again.calls.some((c) => c.method === "POST" && c.url.includes("/drive/v3/files?fields=id"))).toBe(false);
  });

  it("fails clearly when Google refuses the sign-in or the file does not read back the same", async () => {
    await expect(uploadToDrive(cfg, "x", [{ name: "a", mime: "text/plain", body: "1" }], fakeGoogle({ signIn: 400 }).f)).rejects.toThrow(/sign-in failed \(400\)/);
    await expect(uploadToDrive(cfg, "x", [{ name: "a", mime: "text/plain", body: "1" }], fakeGoogle({ corruptReadBack: true }).f)).rejects.toThrow(/did not read back/);
  });

  it("adds the Drive copy to each backup, and keeps the Cloudflare copy when Drive fails", async () => {
    const s = await setupTenant();
    const e = env as unknown as Record<string, string | undefined>;
    e.GDRIVE_CLIENT_ID = "client-id";
    e.GDRIVE_CLIENT_SECRET = "client-secret";
    e.GDRIVE_REFRESH_TOKEN = "refresh-token";
    const status = (await api("/admin/backups", { token: s.owner.token })).body;
    expect(status.googleDrive).toBe(true);

    const good = fakeGoogle();
    vi.stubGlobal("fetch", good.f);
    const ok = await api("/admin/backups/run", { method: "POST", token: s.owner.token });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ verified: true, offsite: { provider: "google-drive", ok: true } });
    // The file in Drive is the encrypted one, not readable worker data.
    expect([...good.files.values()].join("")).not.toContain("Worker A");

    vi.stubGlobal("fetch", fakeGoogle({ signIn: 401 }).f);
    const bad = await api("/admin/backups/run", { method: "POST", token: s.owner.token });
    expect(bad.status).toBe(201);
    expect(bad.body).toMatchObject({ verified: true, offsite: { ok: false } });
    expect(bad.body.offsite.error).toMatch(/sign-in failed/);
  });
});
