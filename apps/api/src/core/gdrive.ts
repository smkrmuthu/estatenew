/**
 * A second copy of each backup in the owner's Google Drive, so the data is not only in Cloudflare.
 *
 * It signs in as the owner's Google account with a refresh token that was created once (a service account cannot be
 * used: it has no Drive storage of its own for a personal Drive). The scope is `drive.file`, so the app can only see
 * files it made itself; it makes its own folder in My Drive and puts the encrypted copies in it. Nothing is ever deleted.
 * The files are the same encrypted files as in R2, so the Drive holds no readable worker data.
 */

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function driveConfig(env: Pick<Env, "GDRIVE_CLIENT_ID" | "GDRIVE_CLIENT_SECRET" | "GDRIVE_REFRESH_TOKEN">): DriveConfig | null {
  const { GDRIVE_CLIENT_ID: clientId, GDRIVE_CLIENT_SECRET: clientSecret, GDRIVE_REFRESH_TOKEN: refreshToken } = env;
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

type Fetch = typeof fetch;
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

async function failIfNot(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  // Google's error text can name the problem (expired consent, wrong client); it holds no secret.
  throw new Error(`Google Drive ${what} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

async function accessToken(cfg: DriveConfig, f: Fetch): Promise<string> {
  const res = await failIfNot(
    await f("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken, grant_type: "refresh_token" }),
    }),
    "sign-in",
  );
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Google Drive sign-in returned no access token");
  return body.access_token;
}

/** The app's own folder in My Drive, made on first use. */
async function folderId(token: string, name: string, f: Fetch): Promise<string> {
  const auth = { authorization: `Bearer ${token}` };
  const q = `name = '${name.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found = (await (await failIfNot(await f(`${API}/files?${new URLSearchParams({ q, fields: "files(id)", spaces: "drive" })}`, { headers: auth }), "folder lookup")).json()) as {
    files?: { id: string }[];
  };
  if (found.files?.[0]) return found.files[0].id;
  const made = (await (
    await failIfNot(
      await f(`${API}/files?fields=id`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }) }),
      "folder creation",
    )
  ).json()) as { id: string };
  return made.id;
}

export interface DriveFile {
  name: string;
  mime: string;
  body: string;
}

/** Upload files into the folder and read each one back to be sure it arrived whole. Returns the Drive file id of each. */
export async function uploadToDrive(cfg: DriveConfig, folderName: string, files: DriveFile[], f: Fetch = fetch): Promise<{ folderId: string; files: { name: string; id: string }[] }> {
  const token = await accessToken(cfg, f);
  const parent = await folderId(token, folderName, f);
  const out: { name: string; id: string }[] = [];
  for (const file of files) {
    const boundary = `cemms-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name: file.name, parents: [parent] });
    const body = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\ncontent-type: ${file.mime}\r\n\r\n${file.body}\r\n--${boundary}--`;
    const res = await failIfNot(
      await f(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` }, body }),
      "upload",
    );
    const { id } = (await res.json()) as { id: string };
    const back = await failIfNot(await f(`${API}/files/${id}?alt=media`, { headers: { authorization: `Bearer ${token}` } }), "read-back");
    if ((await back.text()) !== file.body) throw new Error(`Google Drive file ${file.name} did not read back the same`);
    out.push({ name: file.name, id });
  }
  return { folderId: parent, files: out };
}
