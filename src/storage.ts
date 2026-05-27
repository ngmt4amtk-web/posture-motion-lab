import type { AppSettings, TaskCapture, TaskId } from './types';

const DB_NAME = 'posture-motion-lab';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const CURRENT_SESSION_KEY = 'current';

export interface StoredSession {
  settings: AppSettings;
  captures: Partial<Record<TaskId, TaskCapture>>;
  savedAt: string;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<StoredSession>;
  return Boolean(session.settings && session.captures && typeof session.savedAt === 'string');
}

export async function loadStoredSession() {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const result = await requestToPromise<unknown>(store.get(CURRENT_SESSION_KEY));
    return isStoredSession(result) ? result : null;
  } finally {
    db.close();
  }
}

export async function saveStoredSession(session: StoredSession) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(session, CURRENT_SESSION_KEY);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}
