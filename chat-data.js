// Boreas — estado e CRUD local/remoto de conversas.

const TIERS = {
  altra:  { label: "Boreas Altra I" },
  ultra:  { label: "Boreas 5.8 Ultra" },
  pro:    { label: "Boreas 5.8 Pro" },
  normal: { label: "Boreas 5.8" },
  quick:  { label: "Boreas 5.7 Quick" },
  coding: { label: "Boreas Nova 5.9" },
};

const TIER_SPEEDS = { altra: "cheapest", ultra: "cheapest", pro: "cheapest", normal: "fastest", quick: "fastest", coding: "fastest" };

// Pro, Altra, and Nova (coding, text-only) keep vision disabled in the UI.
const NO_VISION_TIERS = ["pro", "altra", "coding"];
const NO_VISION_LABEL = { pro: "Pro", altra: "Altra I", coding: "Nova 5.9" };

// Mirrors server.js EFFORT_TIERS.
const EFFORT_TIERS = ["altra", "pro", "ultra", "coding"];
const VALID_EFFORTS = ["default", "low", "medium", "high"];
const EFFORT_LABELS = { default: "Padrão", low: "Baixo", medium: "Médio", high: "Alto" };

let currentTier  = (localStorage.getItem("boreas_last_tier") in TIER_SPEEDS)
  ? localStorage.getItem("boreas_last_tier")
  : "ultra";
let currentSpeed = TIER_SPEEDS[currentTier];

// Stores the last effort used per tier.

function lastEffortFor(tier) {
  const v = localStorage.getItem("boreas_last_effort_" + tier);
  return VALID_EFFORTS.includes(v) ? v : "default";
}
let currentEffort = EFFORT_TIERS.includes(currentTier) ? lastEffortFor(currentTier) : "default";

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

let memoryEnabledGlobal = localStorage.getItem("boreas_memory_global") !== "false";
let chatMemoryEnabled   = true;
let chatHasMessages     = false;

const ACTIVE_KEY = "boreas_active_chat_v2";

let _chatsMeta = {};

function loadAllChats() {
  return _chatsMeta;
}

async function syncChatsFromServer() {
  if (!BoreasSync.isAuthed()) return;
  const serverList = await BoreasSync.chats.list(); // retry + cache fallback handled inside
  if (!Array.isArray(serverList) || !serverList.length) {
    if (Array.isArray(serverList)) console.warn("[syncChats] Lista vazia (servidor ou cache).");
    return;
  }
  _chatsMeta = {};
  for (const sc of serverList) _chatsMeta[sc.id] = { ...sc, hasMessages: true };
}

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
    console.warn("[pushChatToServer] falhou (" + res.error + ") — chat enfileirado para reenvio automático:", id);
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
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function stripImagesForStorage(msgs, chatId) {
  const result = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!Array.isArray(m.content)) { result.push(m); continue; }
    const newContent = [];
    let imgIdx = 0;
    for (const p of m.content) {
      if (p.type === "image_url") {
        const url = p.image_url?.url ?? "";
        const key = `${chatId}:${i}:${imgIdx++}`;
        if (url.startsWith("data:")) {
          try { await idbSetImage(key, url); } catch {}
        }

        newContent.push({ type: "image_url", image_url: { url: url.startsWith("__idb:") ? url : `__idb:${key}` } });
      } else {
        newContent.push(p);
      }
    }
    result.push({ ...m, content: newContent });
  }
  return result;
}

async function restoreImages(msgs) {
  const result = [];
  for (const m of msgs) {
    if (!Array.isArray(m.content)) { result.push(m); continue; }
    const newContent = [];
    for (const p of m.content) {
      if (p.type === "image_url") {
        const url = p.image_url?.url ?? "";
        if (url.startsWith("__idb:")) {
          const b64 = await idbGetImage(url.slice(6));
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
  const id = localStorage.getItem(ACTIVE_KEY);
  if (!id) return;
  const meta = _chatsMeta[id];
  if (!meta) return;

  const storedMsgs = await stripImagesForStorage(messages, id);

  await pushChatToServer(id, meta.title, storedMsgs, currentTier, currentSpeed, currentEffort, { keepalive });

  if (!keepalive) renderSidebar();
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
  try { await idbDeleteByPrefix(id + ":"); } catch {}
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

async function loadChat(id, { skipRemote = false } = {}) {

  if (currentAbortController) { try { currentAbortController.abort(); } catch {} }
  loading = false;
  hideStopBtn();
  currentAbortController = null;
  removeTyping();

  let chat = (!skipRemote && BoreasSync.isAuthed()) ? await BoreasSync.chats.get(id) : null;

  if (!chat && _chatsMeta[id]) chat = { ..._chatsMeta[id], messages: [] };
  if (!chat) return;

  localStorage.setItem(ACTIVE_KEY, id);
  messages = await restoreImages(chat.messages ?? []);

  chatMemoryEnabled = chat.memoryEnabled !== false;
  chatHasMessages   = messages.length > 0;
  updateMemoryBtns();

  if (chat.tier && TIERS[chat.tier]) {
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
        appendMessage("bot", display, null, undefined, m.attachments, m.thinking, m.steps);
      }
    }
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
}

