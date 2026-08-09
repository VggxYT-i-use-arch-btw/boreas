// sw.js - Service Worker do Boreas.
// 
// Mantém a fila de sincronização viva no Service Worker para reenviar saves quando a rede voltar.

const SYNC_QUEUE_DB = "boreas_sync_queue_db";
// URL pública fixa do backend para itens antigos que ainda armazenam apenas o path.
const BOREAS_BACKEND_URL = "https://participated-changelog-specially-species.trycloudflare.com";

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SYNC_QUEUE_DB, 1);
    // Mesma versão/schema do client - se o client ainda não criou o banco
    // (nunca enfileirou nada), cria a object store vazia aqui também, pra
    // não dar erro de "object store not found".
    req.onupgradeneeded = e => e.target.result.createObjectStore("queue");
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
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
  for (const item of items) {
    try {
      // O cookie HttpOnly já leva a sessão, então o Service Worker não precisa ler localStorage.
      const targetUrl = item.url || (
        /^https?:\/\//i.test(item.path || "")
          ? item.path
          : new URL(item.path || "/", BOREAS_BACKEND_URL).href
      );
      const res = await fetch(targetUrl, {
        method: item.method,
        headers: { "Content-Type": "application/json", ...(item.headers || {}) },
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

// Sem cache de app-shell: este SW existe apenas para Background Sync.
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
