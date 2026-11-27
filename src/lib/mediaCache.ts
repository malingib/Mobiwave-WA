const DATABASE_NAME = "mobiwave-wa-media";
const DATABASE_VERSION = 1;
const STORE_NAME = "media";
const MAX_CACHE_BYTES = 200 * 1024 * 1024;

type CacheKey = { tenantId: string; userId: string; mediaId: string };
type CachedMedia = CacheKey & { key: string; blob: Blob; size: number; lastAccessed: number };

function cacheKey({ tenantId, userId, mediaId }: CacheKey) {
  return [tenantId, userId, mediaId].join(":");
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("userId", "userId", { unique: false });
        store.createIndex("lastAccessed", "lastAccessed", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted?.())) {
      await navigator.storage.persist();
    }
  } catch {
    // Persistence is best-effort; IndexedDB remains an evictable cache.
  }
}

export async function getCachedMedia(key: CacheKey): Promise<Blob | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const record = await requestResult(store.get(cacheKey(key))) as CachedMedia | undefined;
    if (!record?.blob) return null;
    record.lastAccessed = Date.now();
    store.put(record);
    return record.blob;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function cacheMedia({ tenantId, userId, mediaId, blob }: CacheKey & { blob: Blob }): Promise<void> {
  if (!blob.size || blob.size > MAX_CACHE_BYTES) return;
  const db = await openDatabase();
  if (!db) return;
  try {
    await requestPersistentStorage();
    const record: CachedMedia = {
      key: cacheKey({ tenantId, userId, mediaId }),
      tenantId, userId, mediaId, blob, size: blob.size, lastAccessed: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    const records = await new Promise<CachedMedia[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as CachedMedia[]);
      request.onerror = () => reject(request.error);
    });
    let total = records.reduce((sum, item) => sum + (Number(item.size) || item.blob?.size || 0), 0);
    if (total > MAX_CACHE_BYTES) {
      records.sort((a, b) => a.lastAccessed - b.lastAccessed);
      const victims: string[] = [];
      for (const item of records) {
        if (total <= MAX_CACHE_BYTES) break;
        victims.push(item.key);
        total -= Number(item.size) || item.blob?.size || 0;
      }
      if (victims.length) await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        victims.forEach((key) => store.delete(key));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }
  } catch {
    // A cache quota or browser storage failure must never block media viewing.
  } finally {
    db.close();
  }
}

export async function clearUserMediaCache(userId: string): Promise<void> {
  if (!userId) return;
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("userId");
      const request = index.openKeyCursor(IDBKeyRange.only(userId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // Logout must complete even if the browser refuses local cache deletion.
  } finally {
    db.close();
  }
}
