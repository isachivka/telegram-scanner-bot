import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface ScanSession {
  id: string;
  owner: string;
  dir: string;
}

/**
 * Per-owner scratch directories for in-progress scans. Owner is a Telegram
 * user id or an MCP request id; a new session for the same owner discards the
 * previous one.
 */
export class SessionStore {
  private readonly active = new Map<string, ScanSession>();

  constructor(private readonly root: string) {}

  get size(): number {
    return this.active.size;
  }

  async create(owner: string): Promise<ScanSession> {
    const existing = this.active.get(owner);
    if (existing) await rm(existing.dir, { recursive: true, force: true });
    const id = randomUUID();
    const dir = path.join(this.root, owner, id);
    await mkdir(dir, { recursive: true });
    const session = { id, owner, dir };
    this.active.set(owner, session);
    return session;
  }

  get(owner: string): ScanSession | undefined {
    return this.active.get(owner);
  }

  async discard(session: ScanSession): Promise<void> {
    if (this.active.get(session.owner)?.id === session.id) {
      this.active.delete(session.owner);
    }
    await rm(session.dir, { recursive: true, force: true });
  }

  /** Drop everything, including leftovers from a previous process. */
  async sweep(): Promise<void> {
    this.active.clear();
    await rm(this.root, { recursive: true, force: true });
    await mkdir(this.root, { recursive: true });
  }

  pagePath(session: ScanSession, pageNumber: number, extension: string): string {
    return path.join(
      session.dir,
      `page_${String(pageNumber).padStart(3, "0")}.${extension}`,
    );
  }
}
