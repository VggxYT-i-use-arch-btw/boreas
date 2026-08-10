// Boreas — camada de rede, cache e fila de sincronização.

// URL pública fixa do backend exposto pelo túnel Cloudflared.
// Atualize este valor quando o Quick Tunnel mudar de endereço.
const BACKEND_URL = "https://regardless-computer-petition-behalf.trycloudflare.com";

// Guarda a fila de escrita pendente em IndexedDB para que a aba e o Service Worker possam reenviar quando a conexão voltar.
const SYNC_QUEUE_DB = "boreas_sync_queue_db";
let _syncQueueDb = null;
function openSyncQueueDb() {
  if (_syncQueueDb) return Promise.resolve(_syncQueueDb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(SYNC_QUEUE_DB, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore("queue");
    req.onsuccess = e => { _syncQueueDb = e.target.result; res(_syncQueueDb); };
    req.onerror   = e => rej(e.target.error);
  });
}
async function qdbPut(key, val) {
  const db = await openSyncQueueDb();
  return new Promise((res, rej) => {
    const tx = db.transaction("queue", "readwrite");
    tx.objectStore("queue").put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  });
}
async function qdbDelete(key) {
  const db = await openSyncQueueDb();
  return new Promise((res, rej) => {
    const tx = db.transaction("queue", "readwrite");
    tx.objectStore("queue").delete(key);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  });
}
async function qdbGetAll() {
  const db = await openSyncQueueDb();
  return new Promise((res, rej) => {
    const tx = db.transaction("queue", "readonly");
    const store = tx.objectStore("queue");
    const items = [];
    const req = store.openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) { res(items); return; }
      items.push({ key: cursor.key, ...cursor.value });
      cursor.continue();
    };
    req.onerror = e => rej(e.target.error);
  });
}

// Pede pro navegador acordar o Service Worker (evento "sync") assim que a
// conectividade voltar, mesmo que o app esteja fechado. Sem suporte (iOS
// Safari não tem Background Sync), cai de volta no flushQueue() normal via
// online/visibilitychange/interval - a fila em IndexedDB continua valendo
// de qualquer forma, só não roda em background nesse caso.
async function registerBackgroundSync() {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    if (reg.sync) await reg.sync.register("boreas-flush-queue");
  } catch (e) { /* Background Sync indisponível — sem problema, tem os fallbacks */ }
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(e => console.warn("[SW] registro falhou:", e.message));
}

// BoreasSync centralizes authenticated chats, memory, and usage calls.

// Local cache for read fallback.

const BoreasSync = (() => {
  const SESSION_KEY = "boreas_session_id";

  function sessionId() { return localStorage.getItem(SESSION_KEY) || ""; }
  function isAuthed()  { return !!sessionId(); }
  function sleep(ms)   { return new Promise(r => setTimeout(r, ms)); }

  // Local cache for read fallback.
  function cacheSet(key, val) {
    try { localStorage.setItem("boreas_cache_" + key, JSON.stringify({ v: val, t: Date.now() })); } catch {}
  }
  function cacheGet(key) {
    try { const raw = localStorage.getItem("boreas_cache_" + key); return raw ? JSON.parse(raw).v : undefined; }
    catch { return undefined; }
  }
  function cacheDel(key) {
    try { localStorage.removeItem("boreas_cache_" + key); } catch {}
  }

  // Retry queue for failed writes - agora em IndexedDB (ver qdb* acima),
  // pra sobreviver o suficiente pro Service Worker conseguir ler.
  const MAX_QUEUE = 200;
  const MAX_QUEUE_BYTES = 50 * 1024 * 1024; // cap por tamanho total além da contagem - um item com imagem em base64 pesa MBs
  async function queueWrite(path, method, body) {
    // key só por "method + path" colidia sempre que o mesmo endpoint era
    // chamado mais de uma vez offline (ex.: 3 chats novos = 3x "POST
    // /chats", mesma key) - o qdbPut seguinte sobrescrevia o anterior e só
    // o último sobrevivia pra sincronizar. Sufixo com timestamp+random
    // garante uma key por chamada.
    const key = method + " " + path + " " + Date.now() + "_" + Math.random().toString(36).slice(2);
    try {
      await qdbPut(key, {
        path,
        url: new URL(path, BACKEND_URL).href,
        method,
        body,
        headers: { "x-session-id": sessionId() },
        ts: Date.now(),
      });
      // Limita o tamanho da fila de escrita no IndexedDB para evitar crescimento excessivo do armazenamento local.
      const all = await qdbGetAll();
      let over = all.length > MAX_QUEUE;
      if (!over) {
        const totalBytes = all.reduce((s, item) => s + (item.body ? JSON.stringify(item.body).length : 0), 0);
        over = totalBytes > MAX_QUEUE_BYTES;
      }
      if (over) {
        const sorted = all.sort((a, b) => a.ts - b.ts);
        const toDrop = sorted.slice(0, sorted.length - MAX_QUEUE);
        for (const item of toDrop) await qdbDelete(item.key);
      }
    } catch (e) { console.error("[queueWrite]", e); }
    registerBackgroundSync();
  }
  async function flushQueue() {
    if (!isAuthed()) return;
    let q;
    try { q = await qdbGetAll(); } catch { return; }
    if (!q.length) return;
    for (const item of q) {
      const res = await request(item.url ?? item.path, { method: item.method, body: item.body, retries: 0, silent: true });
      if (res.ok) { try { await qdbDelete(item.key); } catch {} }
    }
  }
  window.addEventListener("online", flushQueue);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) flushQueue(); });
  setInterval(flushQueue, 60_000);

  // Shared request helper for authenticated calls.
  async function request(path, { method = "GET", body, retries = 2, silent = false, keepalive = false, timeoutMs = 8000 } = {}) {
    if (!isAuthed()) return { ok: false, error: "no-session" };
    const headers = { "x-session-id": sessionId() };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const useKeepalive = keepalive && (!bodyStr || bodyStr.length < 60_000); // keepalive has a body-size ceiling
    let lastErr = "network";
    for (let attempt = 0; attempt <= retries; attempt++) {

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const targetUrl = /^https?:\/\//i.test(path) ? path : BACKEND_URL + path;
        const r = await fetch(targetUrl, {
          method,
          headers,
          body: bodyStr,
          signal: controller.signal,
          ...(useKeepalive ? { keepalive: true } : {}),
        });
        clearTimeout(timer);
        if (r.status === 401) {
          if (!silent) document.dispatchEvent(new CustomEvent("boreas:session-expired"));
          return { ok: false, error: "unauthorized", status: 401 };
        }
        if (!r.ok) {
          lastErr = `http-${r.status}`;
          if (r.status >= 500 && attempt < retries) { await sleep(400 * (attempt + 1)); continue; }
          return { ok: false, error: lastErr, status: r.status };
        }
        const data = await r.json().catch(() => ({}));
        return { ok: true, data };
      } catch (e) {
        clearTimeout(timer);
        lastErr = e.name === "AbortError" ? "timeout" : "network";
        if (attempt < retries) { await sleep(400 * (attempt + 1)); continue; }
      }
    }
    return { ok: false, error: lastErr };
  }

  const chats = {
    // Returns metadata index, falling back to cache on failure.
    async list() {
      const res = await request("/chats", { retries: 1, timeoutMs: 4000 });
      if (res.ok) { cacheSet("chats_index", res.data.chats ?? []); return res.data.chats ?? []; }
      return cacheGet("chats_index") ?? [];
    },
    async get(id) {
      const res = await request("/chats/" + id, { retries: 1, timeoutMs: 4000 });
      if (res.ok) { cacheSet("chat_" + id, res.data.chat); return res.data.chat; }
      return cacheGet("chat_" + id) ?? null;
    },
    // Retries upserts and queues them on failure.

    async save(chat, { keepalive = false } = {}) {
      const res = await request("/chats", { method: "POST", body: chat, keepalive, ...(keepalive ? { retries: 0 } : {}) });
      if (!res.ok && res.error !== "unauthorized") queueWrite("/chats", "POST", chat);
      if (res.ok || res.error !== "unauthorized") cacheSet("chat_" + chat.id, { ...cacheGet("chat_" + chat.id), ...chat });
      return res;
    },
    async remove(id) {
      const res = await request("/chats/" + id, { method: "DELETE" });
      if (!res.ok && res.error !== "unauthorized") queueWrite("/chats/" + id, "DELETE");
      cacheDel("chat_" + id);
      return res;
    },
    // Atualiza só o título do chat no servidor, sem tocar no histórico salvo.
    async renameTitle(id, title) {
      const res = await request("/chats/" + id + "/title", { method: "PATCH", body: { title } });
      if (!res.ok && res.error !== "unauthorized") queueWrite("/chats/" + id + "/title", "PATCH", { title });
      const cached = cacheGet("chat_" + id);
      if (cached) cacheSet("chat_" + id, { ...cached, title });
      return res;
    },
    // Nunca é enfileirada pra retry - se falhar, o usuário decide se tenta
    // de novo (é uma ação explícita, não um autosave silencioso).
    async resume(id) {
      return request("/chats/" + id + "/resume", { method: "POST", retries: 0, silent: true, timeoutMs: 45000 });
    },
  };

  const memory = {
    async get() {
      const res = await request("/memory");
      if (res.ok) { cacheSet("memory", res.data); return res.data; }
      return cacheGet("memory") ?? { memory: "", lastUpdate: 0, enabled: true };
    },
    async set(memoryText, enabled) {
      const body = {};
      if (memoryText !== undefined) body.memory = memoryText;
      if (enabled   !== undefined) body.enabled = enabled;
      const res = await request("/memory", { method: "PUT", body });
      if (!res.ok && res.error !== "unauthorized") queueWrite("/memory", "PUT", body);
      return res;
    },
    // Background update is never queued.

    async update(newMessages, lastActivity) {
      return request("/memory/update", { method: "POST", body: { messages: newMessages, lastActivity }, retries: 1, silent: true });
    },
  };

  const usage = {
    async get() {
      const res = await request("/usage");
      if (res.ok) { cacheSet("usage", res.data); return res.data; }
      return cacheGet("usage") ?? null;
    },
  };

  document.addEventListener("boreas:session-expired", () => {
    console.warn("[BoreasSync] Sessão inválida/expirada — dados locais preservados, mas leituras/escritas vão falhar até novo login.");
  });

  return { request, chats, memory, usage, isAuthed, flushQueue };
})();
