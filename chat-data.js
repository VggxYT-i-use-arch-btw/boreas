// Boreas: local/remote conversation state and CRUD.

const TIERS = {
  altra1:  { label: "Boreas Altra I" },
  solstice1:  { label: "Boreas Solstice I" },
  sunset2:    { label: "Boreas Sunset II" },
  horizon2: { label: "Boreas Horizon II" },
  nebula1: { label: "Boreas Nebula I" },
  starlight2: { label: "Boreas Starlight II" },
};

const TIER_SPEEDS = { altra1: "cheapest", solstice1: "cheapest", sunset2: "cheapest", horizon2: "fastest", nebula1: "fastest", starlight2: "fastest" };
let ACCOUNT_SCOPE = "";
let LAST_TIER_KEY = "";

// Altra and Starlight (coding, text-only) keep vision disabled in the UI.
// Nebula switched to DeepSeek-V4-Flash-Vision-Exp (native vision), so it's
// no longer in this list. Keep in sync with NO_VISION_TIERS in
// back-end/sub_boreas/config/runtime.js.
const NO_VISION_TIERS = ["altra1", "starlight2"];
const NO_VISION_LABEL = { altra1: "Altra I", starlight2: "Starlight II" };

// Effort levels each tier actually accepts, ordered weakest -> strongest,
// plus the level used when nothing valid is stored yet. Mirrors
// TIER_EFFORTS in back-end/sub_boreas/config/runtime.js - keep both in sync.
const TIER_EFFORTS = {
  altra1:     { levels: ["low", "high", "max"],             default: "high" },
  solstice1:  { levels: ["low", "high", "max"],             default: "high" },
  sunset2:    { levels: ["low", "medium", "xhigh"],         default: "xhigh" },
  horizon2:   { levels: ["low", "medium", "high", "xhigh"], default: "high" },
  nebula1:    { levels: ["low", "high", "max"],             default: "high" },
  starlight2: { levels: ["low", "high", "max"],             default: "high" },
};
// All six tiers now expose the effort control.
const EFFORT_TIERS = Object.keys(TIER_EFFORTS);
// Label/description shown per level, not per tier - a given level name
// (e.g. "high") reads the same regardless of which tier's ceiling it is.
const EFFORT_LABELS = { low: "Baixo", medium: "Médio", high: "Alto", xhigh: "Máximo", max: "Máximo" };
const EFFORT_DESCRIPTIONS = {
  low: "Para tarefas simples e rápidas",
  medium: "Para tarefas que exigem um pouco mais de pensamento",
  high: "Para trabalhos complexos e difíceis",
  xhigh: "Para os problemas mais difíceis, sem economizar raciocínio",
  max: "Para os problemas mais difíceis, sem economizar raciocínio",
};

let currentTier = "solstice1";
let currentSpeed = TIER_SPEEDS[currentTier];

// Stores the last effort used per tier.

function lastEffortFor(tier) {
  const cfg = TIER_EFFORTS[tier];
  if (!cfg) return "default";
  const v = localStorage.getItem((ACCOUNT_SCOPE ? "boreas_last_effort_" + ACCOUNT_SCOPE + "_" : "boreas_last_effort_unauthed_") + tier);
  return cfg.levels.includes(v) ? v : cfg.default;
}
let currentEffort = "default";

// Renders the effort options for the active tier (they differ per tier -
// see TIER_EFFORTS) and syncs the pill/section to the current selection.

function syncEffortUI() {
  const section = document.getElementById("effort-section");
  if (!section) return;
  const cfg = TIER_EFFORTS[currentTier];
  const supports = !!cfg;
  section.classList.toggle("show", supports);
  if (!supports) section.classList.remove("open");
  const valueEl = document.getElementById("effort-pill-btn-value");
  if (valueEl) valueEl.textContent = EFFORT_LABELS[currentEffort] ?? "Padrão";
  const inner = document.getElementById("effort-list-inner");
  if (!inner) return;
  if (!supports) { inner.innerHTML = ""; return; }
  inner.innerHTML = cfg.levels.map(level => `
    <div class="effort-option${level === currentEffort ? " active" : ""}" data-effort="${level}">
      <svg class="effort-option-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      <div class="effort-option-info">
        <div class="effort-option-name">${EFFORT_LABELS[level] ?? level}</div>
        <div class="effort-option-desc">${EFFORT_DESCRIPTIONS[level] ?? ""}</div>
      </div>
    </div>
  `).join("");
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
  currentTier = Object.hasOwn(TIER_SPEEDS, savedTier) ? savedTier : "solstice1";
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

async function pushChatToServer(id, msgs, tier, speed, effort, { keepalive = false } = {}) {
  if (!BoreasSync.isAuthed()) return false;

  const safeMsgs = (msgs ?? []).map(m => {
    if (!Array.isArray(m.content)) return m;
    return { ...m, content: m.content.map(p => {
      if (p.type !== "image_url") return p;
      const url = p.image_url?.url ?? "";
      // "data:" covers a raw image passed directly; "__idb:" is the normal
      // case, since stripImagesForStorage already replaced it with a local
      // IndexedDB reference before this runs. Both become a text placeholder
      // for the server, which never stores image bytes.
      return (url.startsWith("data:") || url.startsWith("__idb:"))
        ? { type: "text", text: "[imagem]" }
        : p;
    })};
  });

  // The title never travels through here: generateTitle()/setChatTitle()
  // run in parallel with the first save and use the dedicated rename
  // endpoint. Sending the still-captured "New conversation" title in this
  // save would risk resolving after the rename and wiping out the real
  // title, both on the server and locally (both write to _chatsMeta[id].title).
  const res = await BoreasSync.chats.save({ id, messages: safeMsgs, tier, speed, effort }, { keepalive, localMessages: msgs });
  if (!res.ok) {
    console.warn("[pushChatToServer] falhou (" + res.error + ") - chat enfileirado para reenvio automático:", id);
    return false;
  }

  if (_chatsMeta[id]) {
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

  await pushChatToServer(id, storedMsgs, meta.tier ?? currentTier, meta.speed ?? currentSpeed, meta.effort ?? currentEffort, { keepalive });

  if (!keepalive && localStorage.getItem(ACTIVE_KEY) === id && messages === snapshot) renderSidebar();
}

function setChatTitle(id, title) {
  const meta = _chatsMeta[id];
  if (!meta) return;
  const newTitle = title.trim().slice(0, 80) || "Nova conversa";
  meta.title = newTitle;
  renderSidebar();

  // Updates only the title on the server, to avoid overwriting messages with a stale snapshot.
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
    ? (TIER_EFFORTS[currentTier].levels.includes(chat.effort) ? chat.effort : TIER_EFFORTS[currentTier].default)
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
        let text = "", imgs = [], fileAttachment = null;
        if (typeof m.content === "string") {
          // The backend persists user images as "[imagem:ID.ext]" inside a
          // string (attachment-service.js/persistUserImage), later served
          // via GET /chat-image/:id; this turns that marker back into an image.
          const imageMarker = /\[imagem:([A-Za-z0-9_-]+\.[A-Za-z0-9]+)\]\s*/g;
          imgs = [...m.content.matchAll(imageMarker)].map(match => `${BACKEND_URL}/chat-image/${match[1]}`);
          text = m.content.replace(imageMarker, "").trim();
        } else if (Array.isArray(m.content)) {
          const tp = m.content.find(p => p.type === "text");
          imgs = m.content.filter(p => p.type === "image_url").map(p => p.image_url?.url).filter(Boolean);
          // #15: histórico novo guarda o arquivo como part próprio, não mais
          // embutido no texto. Conversas antigas (formato "[Arquivo: ...]"
          // dentro do texto) continuam sendo pegas pelo FILE_RE legado em
          // appendMessage - não migradas, só não geradas mais assim.
          const fp = m.content.find(p => p.type === "text_file");
          fileAttachment = fp?.text_file ? { name: fp.text_file.name, content: fp.text_file.content } : null;
          text = tp?.text ?? "";
        }
        appendMessage("user", text, imgs, i, null, null, null, null, fileAttachment);
      } else if (m.role === "assistant") {

        const raw = typeof m.content === "string" ? m.content : "";
        const display = raw.replace(/^\[Ferramentas usadas nesta resposta:[\s\S]*?\]\n\n/, "");
        appendMessage("bot", display, null, i, m.attachments, m.thinking, m.steps, m.activity);
      }
    }
    if (typeof updateRegenerateAvailability === "function") updateRegenerateAvailability();
    scrollToBottom();
    if (msgInputEl) msgInputEl.placeholder = "Continue explorando o infinito...";

    // Shows the "unanswered message" banner when an open chat still has a pending message.
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

  // The cache only serves the first paint; the network updates silently in
  // parallel. Doesn't re-render while another generation or attachment is active.
  if (cachedSnapshot && !cachedChat && !skipRemote && BoreasSync.isAuthed()) {
    // The cache is only for the first paint. This call always hits the
    // network, even when the cache exists, and only remounts the
    // conversation if something changed.
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
