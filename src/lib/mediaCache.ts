const DATABASE_NAME = "mobiwave-wa-media";
const DATABASE_VERSION = 1;
const MEDIA_STORE = "media";
const META_STORE = "media_metadata";
const MAX_CACHE_BYTES = 200 * 1024 * 1024;

type CacheKey = { tenantId: string; userId: string; mediaId: string };
type CachedMedia = CacheKey & { key: string; blob: Blob };
type MediaMetadata = { key: string; userId: string; size: number; lastAccessed: number };

function cacheKey({ tenantId, userId, mediaId }: CacheKey) {
  return [tenantId, userId, mediaId].join(":");
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(META_STORE)) {
        const metadata = db.createObjectStore(META_STORE, { keyPath: "key" });
        metadata.createIndex("userId", "userId", { unique: false });
        metadata.createIndex("lastAccessed", "lastAccessed", { unique: false });
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
    const id = cacheKey(key);
    const transaction = db.transaction([MEDIA_STORE, META_STORE], "readwrite");
    const mediaStore = transaction.objectStore(MEDIA_STORE);
    const metadataStore = transaction.objectStore(META_STORE);
    const record = await requestResult(mediaStore.get(id)) as CachedMedia | undefined;
    if (!record?.blob) return null;
    metadataStore.put({ key: id, userId: key.userId, size: record.blob.size, lastAccessed: Date.now() } satisfies MediaMetadata);
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
    const key = cacheKey({ tenantId, userId, mediaId });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([MEDIA_STORE, META_STORE], "readwrite");
      transaction.objectStore(MEDIA_STORE).put({ key, tenantId, userId, mediaId, blob } satisfies CachedMedia);
      transaction.objectStore(META_STORE).put({ key, userId, size: blob.size, lastAccessed: Date.now() } satisfies MediaMetadata);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    // Read only small metadata rows during LRU eviction, never every cached Blob.
    const records = await new Promise<MediaMetadata[]>((resolve, reject) => {
      const transaction = db.transaction(META_STORE, "readonly");
      const request = transaction.objectStore(META_STORE).getAll();
      request.onsuccess = () => resolve(request.result as MediaMetadata[]);
      request.onerror = () => reject(request.error);
    });
    let total = records.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    if (total > MAX_CACHE_BYTES) {
      records.sort((a, b) => a.lastAccessed - b.lastAccessed);
      const victims: string[] = [];
      for (const item of records) {
        if (total <= MAX_CACHE_BYTES) break;
        victims.push(item.key);
        total -= Number(item.size) || 0;
      }
      if (victims.length) await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([MEDIA_STORE, META_STORE], "readwrite");
        const mediaStore = transaction.objectStore(MEDIA_STORE);
        const metadataStore = transaction.objectStore(META_STORE);
        victims.forEach((victim) => { mediaStore.delete(victim); metadataStore.delete(victim); });
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
      const transaction = db.transaction([MEDIA_STORE, META_STORE], "readwrite");
      const mediaStore = transaction.objectStore(MEDIA_STORE);
      const metadataStore = transaction.objectStore(META_STORE);
      const request = metadataStore.index("userId").openKeyCursor(IDBKeyRange.only(userId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          mediaStore.delete(cursor.primaryKey);
          metadataStore.delete(cursor.primaryKey);
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
