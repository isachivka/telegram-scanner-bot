import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Api } from "grammy";

/**
 * Download a Telegram file into `dir`. Bots can fetch files up to 20 MB via
 * the public Bot API; larger files need a local Bot API server.
 */
export interface DownloadOptions {
  apiRoot?: string;
  fetchImpl?: typeof fetch;
}

export async function downloadTelegramFile(
  api: Api,
  botToken: string,
  fileId: string,
  dir: string,
  extension: string,
  opts: DownloadOptions = {},
): Promise<string> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram did not return file_path");
  const apiRoot = opts.apiRoot ?? "https://api.telegram.org";
  const url = `${apiRoot}/file/bot${botToken}/${file.file_path}`;
  const res = await (opts.fetchImpl ?? fetch)(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${randomUUID()}.${extension}`);
  await writeFile(target, Buffer.from(await res.arrayBuffer()));
  return target;
}
