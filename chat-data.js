// Boreas: estado e CRUD local/remoto de conversas.

const TIERS = {
  altra:  { label: "Boreas Altra I" },
  ultra:  { label: "Boreas 5.8 Ultra" },
  pro:    { label: "Boreas 5.8 Pro" },
  normal: { label: "Boreas 5.8" },
  coding: { label: "Boreas Nova 5.9" },
  codingpro: { label: "Boreas Nova 5.9 Pro" },
};

const TIER_SPEEDS = { altra: "cheapest", ultra: "cheapest", pro: "cheapest", normal: "fastest", coding: "fastest", codingpro: "fastest" };
let ACCOUNT_SCOPE = "";
let LAST_TIER_KEY = "";

// Pro, Altra, and Nova (coding, text-only) keep vision disabled in the UI.
const NO_VISION_TIERS = ["pro", "altra", "coding", "codingpro"];
const NO_VISION_LABEL = { pro: "Pro", altra: "Altra I", coding: "Nova 5.9", codingpro: "Nova 5.9 Pro" };

// Mirrors server.js EFFORT_TIERS.
const EFFORT_TIERS = ["altra", "pro", "ultra", "coding", "codingpro"];
const VALID_EFFORTS = ["default", "low", "medium", "high"];
const EFFORT_LABELS = { default: "Padrão", low: "Baixo", medium: "Médio", high: "Alto" };

let currentTier = "ultra";
let currentSpeed = TIER_SPEEDS[currentTier];

// Stores the last effort used per tier.

function lastEffortFor(tier) {
  const v = localStorage.getItem((ACCOUNT_SCOPE ? "boreas_last_effort_" + ACCOUNT_SCOPE + "_" : "boreas_last_effort_unauthed_") + tier);
  return VALID_EFFORTS.includes(v) ? v : "default";
}
let currentEffort = "default";

// Syncs the effort row with the active tier.

function syncEffortUI() {
  const section = document.getElementById("effort-section");
  if (!section) return;
  const supports = EFFORT_TIERS.includes(currentTier);
  section.classList.toggle("show", supports);
  if (!supports) section.classList.remove("open");
  const valueEl = document.getElementById("effort-pill-btn-value");
  if (valueEl) valueEl.textContent = EFFORT_LABELS[currentEffort] ?? "Padrão";
  document.querySelectorAll(".effort-option").forEach(o =>
    o.classList.toggle("active", supports && o.dataset.effort === currentEffort)
  );
}
let messages     = [];
let loading      = false;
let pendingImages = [];
let pendingFile  = null;
let chatLoadGeneration = 0;

let memoryEnabledGlobal = localStorage.getItem("boreas_memory_global") !== "false";
let chatMemoryEnabled   = true;
let chatHasMessages     = false;

let ACTIVE_KEY = "";

function refreshAccountScopedState() {
  const storedScope = String(localStorage.getItem("boreas_session_scope") || "");
  ACCOUNT_SCOPE = /^[a-f0-9]{32}$/i.test(storedScope) ? storedScope.toLowerCase() : "";
  LAST_TIER_KEY = ACCOUNT_SCOPE ? "boreas_last_tier_" + ACCOUNT_SCOPE : "boreas_last_tier_unauthed";
  ACTIVE_KEY = "boreas_active_chat_v2_" + (ACCOUNT_SCOPE || "unauthed");
  const savedTier = localStorage.getItem(LAST_TIER_KEY);
  currentTier = Object.hasOwn(TIER_SPEEDS, savedTier) ? savedTier : "ultra";
  currentSpeed = TIER_SPEEDS[currentTier];
  currentEffort = EFFORT_TIERS.includes(currentTier) ? lastEffortFor(currentTier) : "default";
  syncEffortUI();
}

globalThis.BoreasRefreshAccountScopedState = refreshAccountScopedState;
refreshAccountScopedState();
globalThis.BoreasSessionContextStale = false;

// localStorage and the HttpOnly cookie are shared by every tab of this
// origin. If another tab logs in or out, this tab must not keep rendering or
// submitting its old in-memory conversation under the new cookie.
window.addEventListener("storage", event => {
  if (!["boreas_session_scope", "boreas_authenticated", "boreas_onboarded"].includes(event.key)) return;
  const nextScope = String(localStorage.getItem("boreas_session_scope") || "").trim().toLowerCase();
  const authenticated = localStorage.getItem("boreas_authenticated") === "true";
  if (nextScope === ACCOUNT_SCOPE && (authenticated || !nextScope)) return;
  globalThis.BoreasSessionContextStale = true;
  try { currentAbortController?.abort(); } catch {}
  try { localStorage.removeItem("boreas_pending_gen"); } catch {}
  location.reload();
});

function imageStorageScope() {
  const scope = String(localStorage.getItem("boreas_session_scope") || "");
  return /^[a-f0-9]{32}$/i.test(scope) ? scope.toLowerCase() : "unauthed";
}
function imageStoragePrefix(chatId) {
  return `${imageStorageScope()}:${chatId}:`;
}

const CHAT_ID_RE = /^(?!__proto__$|prototype$|constructor$)[A-Za-z0-9_-]{1,80}$/i;
function isSafeChatId(id) { return typeof id === "string" && CHAT_ID_RE.test(id); }

let _chatsMeta = Object.create(null);
let chatsNextOffset = 0;
let chatsHasMore = false;
let chatsPageLoading = null;

function loadAllChats() {
  return _chatsMeta;
}

async function syncChatsFromServer({ reset = true } = {}) {
  if (!BoreasSync.isAuthed()) return;
  if (reset) {
    _chatsMeta = Object.create(null);
    chatsNextOffset = 0;
    chatsHasMore = true;
  }
  const page = await BoreasSync.chats.listPage(chatsNextOffset, 50);
  if (!page || !Array.isArray(page.chats)) return;
  for (const sc of page.chats) {
    if (isSafeChatId(sc?.id)) _chatsMeta[sc.id] = { ...sc, hasMessages: true };
  }
  chatsNextOffset = Number.isInteger(page.nextOffset) ? page.nextOffset : chatsNextOffset + page.chats.length;
  chatsHasMore = page.hasMore === true;
}

async function loadMoreChats() {
  if (chatsPageLoading || !chatsHasMore || !BoreasSync.isAuthed()) return;
  chatsPageLoading = syncChatsFromServer({ reset: false })
    .catch(error => console.warn("[syncChats] Falha ao carregar página:", error))
    .finally(() => { chatsPageLoading = null; renderSidebar(); });
  await chatsPageLoading;
}

globalThis.BoreasLoadMoreChats = loadMoreChats;
globalThis.BoreasChatsHasMore = () => chatsHasMore;

async function pushChatToServer(id, title, msgs, tier, speed, effort, { keepalive = false } = {}) {
  if (!BoreasSync.isAuthed()) return false;

  const safeMsgs = (msgs ?? []).map(m => {
    if (!Array.isArray(m.content)) return m;
    return { ...m, content: m.content.map(p => {
      if (p.type !== "image_url") return p;
      const url = p.image_url?.url ?? "";
      // "data:" cobre o caso defensivo (chamada com imagem crua); "__idb:"
      // é o formato real que chega aqui, já que stripImagesForStorage roda
      // antes e troca a imagem por essa referência local ao IndexedDB - sem
      // esse segundo caso, o servidor guardava a referência inútil em vez
      // do placeholder de texto.
      return (url.startsWith("data:") || url.startsWith("__idb:"))
        ? { type: "text", text: "[imagem]" }
        : p;
    })};
  });

  const res = await BoreasSync.chats.save({ id, title, messages: safeMsgs, tier, speed, effort }, { keepalive });
  if (!res.ok) {
    console.warn("[pushChatToServer] falhou (" + res.error + ") - chat enfileirado para reenvio automático:", id);
    return false;
  }

  if (_chatsMeta[id]) {
    _chatsMeta[id].title = title;
    _chatsMeta[id].tier  = tier;
    _chatsMeta[id].effort = effort;
    _chatsMeta[id].updatedAt = new Date().toISOString();
    if (safeMsgs.length > 0) _chatsMeta[id].hasMessages = true;
  } else {
    _chatsMeta[id] = { id, title, tier, effort, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), hasMessages: safeMsgs.length > 0 };
  }
  return true;
}

function genChatId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return "c" + uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure random generator unavailable.");
  globalThis.crypto.getRandomValues(bytes);
  return "c" + [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function stripImagesForStorage(msgs, chatId) {
  const result = [];
  const expectedPrefix = imageStoragePrefix(chatId);
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!Array.isArray(m.content)) { result.push(m); continue; }
    const newContent = [];
    let imgIdx = 0;
    for (const p of m.content) {
      if (p.type === "image_url") {
        const url = p.image_url?.url ?? "";
        const key = `${imageStoragePrefix(chatId)}${i}:${imgIdx++}`;
        if (url.startsWith("data:")) {
          try { await idbSetImage(key, url); } catch {}
        }

        const storedReference = url.startsWith("__idb:") && url.slice(6).startsWith(expectedPrefix)
          ? url
          : `__idb:${key}`;
        newContent.push({ type: "image_url", image_url: { url: storedReference } });
      } else {
        newContent.push(p);
      }
    }
    result.push({ ...m, content: newContent });
  }
  return result;
}

async function restoreImages(msgs, chatId) {
  const result = [];
  const expectedPrefix = imageStoragePrefix(chatId);
  const imageKeys = [];
  for (const m of msgs) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content) {
      const url = p?.type === "image_url" ? p.image_url?.url ?? "" : "";
      if (url.startsWith("__idb:") && url.slice(6).startsWith(expectedPrefix)) imageKeys.push(url.slice(6));
    }
  }
  const storedImages = imageKeys.length && typeof idbGetImages === "function"
    ? await idbGetImages(imageKeys)
    : new Map();
  for (const m of msgs) {
    if (!Array.isArray(m.content)) { result.push(m); continue; }
    const newContent = [];
    for (const p of m.content) {
      if (p.type === "image_url") {
        const url = p.image_url?.url ?? "";
        if (url.startsWith("__idb:") && url.slice(6).startsWith(expectedPrefix)) {
          const b64 = storedImages.get(url.slice(6)) ?? null;
          newContent.push(b64
            ? { type: "image_url", image_url: { url: b64 } }
            : { type: "text", text: "[imagem não disponível]" }
          );
        } else {
          newContent.push(p);
        }
      } else {
        newContent.push(p);
      }
    }
    result.push({ ...m, content: newContent });
  }
  return result;
}

async function createChat(tier, speed) {
  const id  = genChatId();
  const now = new Date().toISOString();
  const resolvedTier = tier ?? currentTier;
  // New chats start with the saved effort for that tier.

  const resolvedEffort = EFFORT_TIERS.includes(resolvedTier) ? lastEffortFor(resolvedTier) : "default";
  currentEffort = resolvedEffort;
  syncEffortUI();
  const meta = {
    id, title: "Nova conversa",
    tier: resolvedTier,
    speed: speed ?? currentSpeed,
    effort: resolvedEffort,
    createdAt: now, updatedAt: now,
    hasMessages: false,
  };
  _chatsMeta[id] = meta;
  localStorage.setItem(ACTIVE_KEY, id);

  return id;
}

async function saveCurrentMessages({ keepalive = false } = {}) {
  if (globalThis.BoreasSessionContextStale) return;
  const id = localStorage.getItem(ACTIVE_KEY);
  if (!id) return;
  const meta = _chatsMeta[id];
  if (!meta) return;

  const snapshot = messages;
  const storedMsgs = await stripImagesForStorage(snapshot, id);
  // Image persistence is asynchronous. If the user changed chats while it
  // was running, never save the old snapshot under the new active chat.
  if (localStorage.getItem(ACTIVE_KEY) !== id || messages !== snapshot || _chatsMeta[id] !== meta) return;

  await pushChatToServer(id, meta.title, storedMsgs, meta.tier ?? currentTier, meta.speed ?? currentSpeed, meta.effort ?? currentEffort, { keepalive });

  if (!keepalive && localStorage.getItem(ACTIVE_KEY) === id && messages === snapshot) renderSidebar();
}

function setChatTitle(id, title) {
  const meta = _chatsMeta[id];
  if (!meta) return;
  const newTitle = title.trim().slice(0, 80) || "Nova conversa";
  meta.title = newTitle;
  renderSidebar();

  // Atualiza só o título no servidor para não sobrescrever mensagens com um snapshot antigo.
  if (BoreasSync.isAuthed()) BoreasSync.chats.renameTitle(id, newTitle);
}

async function deleteChat(id) {

  if (BoreasSync.isAuthed()) {
    await BoreasSync.chats.remove(id); // queues for retry automatically if it fails
  }

  delete _chatsMeta[id];
  try { await idbDeleteByPrefix(imageStoragePrefix(id)); } catch {}
  const activeId = localStorage.getItem(ACTIVE_KEY);
  if (activeId === id) {
    const sorted = Object.values(_chatsMeta).sort((a, b) => (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? 1 : -1);
    if (sorted.length) {
      loadChat(sorted[0].id);
    } else {
      const newId = await createChat();
      loadChat(newId, { skipRemote: true });
    }
  } else {
    renderSidebar();
  }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadChat(id, { skipRemote = false, cachedChat = null } = {}) {
  if (!isSafeChatId(id)) return;

  const loadGeneration = ++chatLoadGeneration;

  if (currentAbortController) { try { currentAbortController.abort(); } catch {} }
  loading = false;
  hideStopBtn();
  currentAbortController = null;
  removeTyping();

  const cachedSnapshot = !cachedChat && !skipRemote && BoreasSync.isAuthed()
    ? BoreasSync.chats.peek(id)
    : null;
  const immediateChat = cachedChat || cachedSnapshot;
  let chat = immediateChat || ((!skipRemote && BoreasSync.isAuthed()) ? await BoreasSync.chats.get(id) : null);

  if (!chat && _chatsMeta[id]) chat = { ..._chatsMeta[id], messages: [] };
  if (!chat) return;

  localStorage.setItem(ACTIVE_KEY, id);
  messages = await restoreImages(chat.messages ?? [], id);
  if (loadGeneration !== chatLoadGeneration) return;

  chatMemoryEnabled = chat.memoryEnabled !== false;
  chatHasMessages   = messages.length > 0;
  updateMemoryBtns();

  if (chat.tier && Object.hasOwn(TIERS, chat.tier) && Object.hasOwn(TIER_SPEEDS, chat.tier)) {
    currentTier = chat.tier;
    currentSpeed = TIER_SPEEDS[currentTier];
    modelLabel.textContent = TIERS[currentTier].label;
    document.querySelectorAll(".model-option").forEach(o =>
      o.classList.toggle("active", o.dataset.tier === currentTier)
    );
  }
  currentEffort = EFFORT_TIERS.includes(currentTier)
    ? (VALID_EFFORTS.includes(chat.effort) ? chat.effort : "default")
    : "default";
  syncEffortUI();
  updateImageAttach();

  warnShownThisSession = false;
  document.getElementById("warn-overlay")?.classList.remove("show");
  document.getElementById("lock-bar")?.classList.remove("show");
  const ir = document.querySelector(".input-row");
  if (ir) ir.style.display = "";
  sendBtn.disabled = false;

  messagesEl.innerHTML = "";
  autoScroll = true;
  updateScrollBtn();
  pendingImages = [];
  pendingFile = null;
  document.getElementById("image-preview-wrap")?.classList.remove("show");

  const msgInputEl = document.getElementById("msg-input");
  if (msgInputEl) msgInputEl.placeholder = "Explore infinitas possibilidades...";

  if (!messages.length) {
    messagesEl.innerHTML = `<div class="empty-state" id="empty">
      <img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" class="empty-logo-img" alt="Boreas" draggable="false">
      <span class="empty-text"></span>
    </div>`;
    setGreeting();
  } else {

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "user") {
        let text = "", imgs = [];
        if (typeof m.content === "string") {
          text = m.content;
        } else if (Array.isArray(m.content)) {
          const tp = m.content.find(p => p.type === "text");
          imgs = m.content.filter(p => p.type === "image_url").map(p => p.image_url?.url).filter(Boolean);
          text = tp?.text ?? "";
        }
        appendMessage("user", text, imgs, i);
      } else if (m.role === "assistant") {

        const raw = typeof m.content === "string" ? m.content : "";
        const display = raw.replace(/^\[Ferramentas usadas nesta resposta:[\s\S]*?\]\n\n/, "");
        appendMessage("bot", display, null, i, m.attachments, m.thinking, m.steps, m.activity);
      }
    }
    if (typeof updateRegenerateAvailability === "function") updateRegenerateAvailability();
    scrollToBottom();
    if (msgInputEl) msgInputEl.placeholder = "Continue explorando o infinito...";

    // Mostra o aviso de mensagem sem resposta quando um chat aberto ainda tem uma mensagem pendente.
    const pendingHere = getPendingGen();
    const hasPendingHere = pendingHere?.genId && pendingHere.chatId === id;
    if (!hasPendingHere && messages.length > 0 && messages[messages.length - 1].role === "user") {
      const banner = document.createElement("div");
      banner.id = "resume-banner";
      banner.className = "resume-banner-el";
      banner.innerHTML = `<span>⚠️ Esta mensagem ficou sem resposta.</span><button id="resume-btn">Retomar ↺</button>`;
      messagesEl.appendChild(banner);
      document.getElementById("resume-btn").addEventListener("click", resumePending);
    }
  }

  renderSidebar();

  // O cache atende a primeira pintura; a rede atualiza silenciosamente em
  // paralelo. Não re-renderiza enquanto outra geração ou anexo estiver ativo.
  if (cachedSnapshot && !cachedChat && !skipRemote && BoreasSync.isAuthed()) {
    // O cache é apenas a primeira pintura. Esta chamada sempre vai à rede,
    // mesmo quando o cache existe, e só remonta a conversa se houver mudança.
    BoreasSync.chats.revalidate(id, cachedSnapshot).then(result => {
      const active = localStorage.getItem(ACTIVE_KEY) === id;
      const safeToRefresh = active && loadGeneration === chatLoadGeneration
        && !loading && !pendingImages.length && !pendingFile;
      if (result?.chat && result.changed && safeToRefresh) {
        loadChat(id, { skipRemote: true, cachedChat: result.chat });
      }
    }).catch(() => {});
  }
}
