import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const ROOT = "/tmp/scans";

export interface ScanSessionState {
  id: string;
  userId: number;
  dir: string;
}

const active = new Map<number, ScanSessionState>();

export async function create(userId: number): Promise<ScanSessionState> {
  const existing = active.get(userId);
  if (existing) {
    await discardSilently(existing);
  }
  const id = randomUUID();
  const dir = path.join(ROOT, String(userId), id);
  await mkdir(dir, { recursive: true });
  const session: ScanSessionState = { id, userId, dir };
  active.set(userId, session);
  return session;
}

export function get(userId: number): ScanSessionState | undefined {
  return active.get(userId);
}

export async function discard(session: ScanSessionState): Promise<void> {
  active.delete(session.userId);
  await discardSilently(session);
}

async function discardSilently(session: ScanSessionState): Promise<void> {
  await rm(session.dir, { recursive: true, force: true });
}

export async function sweepAll(): Promise<void> {
  active.clear();
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(ROOT, { recursive: true });
}

export function pagePath(session: ScanSessionState, pageNumber: number): string {
  return path.join(
    session.dir,
    `page_${String(pageNumber).padStart(3, "0")}.jpg`,
  );
}
