// sw.js - Boreas's Service Worker.
// 
// Keeps the sync queue alive in the Service Worker to resend saves once the network returns.

// In single-origin topology (frontend and backend on the same tunnel),
// backend-config.js normally doesn't exist/isn't needed, and the fallback
// to self.location.origin covers that case. In split topology (frontend on
// GitHub Pages, backend on a different domain), self.location.origin here
// inside the worker is GitHub Pages's origin, which is wrong for API
// calls. importScripts loads the same file the frontend uses (defines
// globalThis.BOREAS_BACKEND_URL, compatible with the worker's global scope).
try { importScripts("backend-config.js"); } catch { /* file doesn't exist: same-origin mode */ }

const SYNC_QUEUE_DB = "boreas_sync_queue_db";
const SYNC_QUEUE_DB_VERSION = 2;
const SYNC_META_STORE = "meta";
const ACTIVE_SCOPE_KEY = "activeAccountScope";
const BOREAS_BACKEND_URL = globalThis.BOREAS_BACKEND_URL || self.location.origin;
const BOREAS_BACKEND_ORIGIN = new URL(BOREAS_BACKEND_URL).origin;

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYNC_QUEUE_DB, SYNC_QUEUE_DB_VERSION);
    // Same version/schema as the client; if the client hasn't created the
    // database yet (never queued anything), creates the empty object store
    // here too, to avoid an "object store not found" error.
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue");
      if (!db.objectStoreNames.contains(SYNC_META_STORE)) db.createObjectStore(SYNC_META_STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function setActiveScope(scope) {
  return openQueueDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_META_STORE, "readwrite");
    tx.objectStore(SYNC_META_STORE).put(scope || null, ACTIVE_SCOPE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  }));
}

async function getServerAccountScope(db) {
  try {
    const response = await fetch(new URL("/session", BOREAS_BACKEND_URL), {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = await response.json();
    const scope = String(data?.sessionScope ?? "").trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(scope)) return null;
    await setActiveScope(scope);
    return scope;
  } catch {
    return null;
  }
}

function getAllQueued(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readonly");
    const store = tx.objectStore("queue");
    const items = [];
    const req = store.openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) { resolve(items); return; }
      items.push({ key: cursor.key, ...cursor.value });
      cursor.continue();
    };
    req.onerror = e => reject(e.target.error);
  });
}

function deleteQueued(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readwrite");
    tx.objectStore("queue").delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

async function flushQueueInSW() {
  let db;
  try { db = await openQueueDb(); } catch { return; }
  let items;
  try { items = await getAllQueued(db); } catch { return; }
  const activeScope = await getServerAccountScope(db);
  // With no identity confirmed by the backend, never resend: using the
  // current cookie without checking the account would be unsafe after a
  // user switch.
  if (!activeScope) return;
  for (const item of items) {
    try {
      if (item.accountScope !== activeScope) {
        await deleteQueued(db, item.key);
        continue;
      }
      // The session already travels via the HttpOnly cookie, so the
      // Service Worker doesn't need to read localStorage.
      // Items pointing at an old Quick Tunnel hostname shouldn't be sent
      // to a different origin or left stuck in the queue.
      const rawTarget = item.path || item.url || "/";
      const target = new URL(rawTarget, BOREAS_BACKEND_URL);
      if (target.origin !== BOREAS_BACKEND_ORIGIN) {
        await deleteQueued(db, item.key);
        continue;
      }
      const targetUrl = target.href;
      const res = await fetch(targetUrl, {
        method: item.method,
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        mode: "cors",
        body: item.body !== undefined ? JSON.stringify(item.body) : undefined,
      });
      // res.ok deletes normally. 4xx (except 429, which is rate limiting
      // and should be retried) also deletes: it's a permanent error in the
      // request itself (expired session, invalid payload, etc.), so
      // resending forever won't fix it. Only a network failure (exception
      // below) or 5xx keeps the item queued for the next sync.
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        await deleteQueued(db, item.key);
      }
    } catch {
      // Still offline, or failed again: leave it queued, try on the next
      // sync (the browser reschedules automatically with backoff).
    }
  }
}

self.addEventListener("sync", event => {
  if (event.tag === "boreas-flush-queue") {
    event.waitUntil(flushQueueInSW());
  }
});

self.addEventListener("message", event => {
  if (event.data?.type !== "boreas-auth-scope") return;
  event.waitUntil(setActiveScope(event.data.accountScope));
});

// No app-shell caching: this SW exists only for Background Sync.
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
