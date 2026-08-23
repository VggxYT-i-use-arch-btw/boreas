// sw.js - Service Worker do Boreas.
// 
// Mantém a fila de sincronização viva no Service Worker para reenviar saves quando a rede voltar.

const SYNC_QUEUE_DB = "boreas_sync_queue_db";
const SYNC_QUEUE_DB_VERSION = 2;
const SYNC_META_STORE = "meta";
const ACTIVE_SCOPE_KEY = "activeAccountScope";
const BOREAS_BACKEND_URL = self.location.origin;

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYNC_QUEUE_DB, SYNC_QUEUE_DB_VERSION);
    // Mesma versão/schema do client - se o client ainda não criou o banco
    // (nunca enfileirou nada), cria a object store vazia aqui também, pra
    // não dar erro de "object store not found".
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
    const response = await fetch(new URL("/session", self.location.origin), {
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
  // Sem identidade confirmada pelo backend, nunca reenviar: usar o cookie
  // atual sem verificar a conta seria inseguro após uma troca de usuário.
  if (!activeScope) return;
  for (const item of items) {
    try {
      if (item.accountScope !== activeScope) {
        await deleteQueued(db, item.key);
        continue;
      }
      // O cookie HttpOnly já leva a sessão, então o Service Worker não precisa ler localStorage.
      // Itens apontando para um hostname antigo do Quick Tunnel não devem ser
      // enviados para uma origem diferente nem ficar presos na fila.
      const rawTarget = item.path || item.url || "/";
      const target = new URL(rawTarget, BOREAS_BACKEND_URL);
      if (target.origin !== self.location.origin) {
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
      // res.ok apaga normalmente. 4xx (exceto 429, que é rate limit e deve
      // ser retentado) também apaga - é um erro permanente do próprio
      // request (sessão expirada, payload inválido etc.), reenviar pra
      // sempre não vai consertar. Só falha de rede (exceção abaixo) ou 5xx
      // mantém o item na fila pra próxima sync.
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        await deleteQueued(db, item.key);
      }
    } catch {
      // Sem rede ainda / falhou de novo - deixa na fila, tenta na próxima
      // sync (o navegador reagenda automaticamente com backoff).
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

// Sem cache de app-shell: este SW existe apenas para Background Sync.
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
