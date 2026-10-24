/**
 * Automatic browser saving with IndexedDB. Data stays in this browser profile
 * on this computer. Browser storage is NOT a backup: it can be cleared by the
 * user, by privacy settings, or evicted by the browser when disk space is low.
 */
import type { ProjectState, SourceFileRecord } from '../types';

const DB_NAME = 'mach1-analyzer';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? req.error);
      t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export interface StoredSession {
  savedAt: string;
  state: ProjectState;
  sources: SourceFileRecord[];
  hasFiles: boolean;
}

export async function saveSessionState(session: StoredSession): Promise<void> {
  await tx('readwrite', (s) => s.put(session, 'session'));
}

export async function saveSessionFiles(files: { path: string; bytes: Uint8Array }[]): Promise<void> {
  await tx('readwrite', (s) => s.put(files, 'files'));
}

export async function loadSession(): Promise<{ session: StoredSession | null; files: { path: string; bytes: Uint8Array }[] }> {
  const session = ((await tx('readonly', (s) => s.get('session'))) as StoredSession | undefined) ?? null;
  const files = ((await tx('readonly', (s) => s.get('files'))) as { path: string; bytes: Uint8Array }[] | undefined) ?? [];
  return { session, files };
}

export async function clearSession(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
