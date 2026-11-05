import { readFile } from "node:fs/promises";

export interface AssetMetadata {
  /** ISO date-time. */
  dateTimeOriginal?: string;
  latitude?: number;
  longitude?: number;
  description?: string;
}

export class ImmichError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImmichError";
  }
}

/** The handful of Immich API calls the photo scanner needs. */
export class ImmichClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    form?: FormData,
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/api${path}`, {
      method,
      headers: {
        "x-api-key": this.apiKey,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (parsed.message) detail = String(parsed.message);
      } catch {
        // not JSON; keep the raw text
      }
      throw new ImmichError(
        `Immich ${method} ${path} failed: HTTP ${res.status} ${detail}`,
      );
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Upload a file; returns the asset id (also for a duplicate of an existing asset). */
  async upload(file: string, filename: string, takenAt: string): Promise<string> {
    const form = new FormData();
    form.set(
      "assetData",
      new Blob([await readFile(file)], { type: "image/jpeg" }),
      filename,
    );
    form.set("filename", filename);
    form.set("fileCreatedAt", takenAt);
    form.set("fileModifiedAt", takenAt);
    const res = await this.call<{ id: string; status: string }>(
      "POST",
      "/assets",
      undefined,
      form,
    );
    return res.id;
  }

  /** Set date, location and description; Immich locks these against later EXIF re-reads. */
  async update(id: string, meta: AssetMetadata): Promise<void> {
    const body = Object.fromEntries(
      Object.entries(meta).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(body).length === 0) return;
    await this.call("PUT", `/assets/${id}`, body);
  }

  /** Id of the caller's album with this exact name, created (and shared) when missing. */
  async ensureAlbum(name: string, shareWith: string[]): Promise<string> {
    const found = await this.call<Array<{ id: string; albumName: string }>>(
      "GET",
      `/albums?isOwned=true&name=${encodeURIComponent(name)}`,
    );
    const existing = found.find((a) => a.albumName === name);
    if (existing) return existing.id;
    const created = await this.call<{ id: string }>("POST", "/albums", {
      albumName: name,
      description: "Paper photos scanned by telegram-scanner-bot",
      albumUsers: shareWith.map((userId) => ({ userId, role: "editor" })),
    });
    return created.id;
  }

  async addToAlbum(albumId: string, assetIds: string[]): Promise<void> {
    await this.call("PUT", `/albums/${albumId}/assets`, { ids: assetIds });
  }
}
