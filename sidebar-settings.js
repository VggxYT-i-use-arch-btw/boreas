// Boreas — sidebar, menu de modelos e configurações.

async function generateTitle(chatId, promptText) {
  try {
    const sessionId = localStorage.getItem("boreas_session_id") ?? "";
    const r = await fetch(BACKEND_URL + "/title", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-id": sessionId },
      body: JSON.stringify({ prompt: promptText.slice(0, 400) }),
    });
    if (!r.ok) return;
    const { title } = await r.json();
    if (title) setChatTitle(chatId, title);
  } catch {}
}

const sidebarEl    = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");

function openSidebar()  {
  document.body.classList.remove("sidebar-closed");
  document.body.classList.add("sidebar-open");
  sidebarEl.classList.add("open");
  sidebarOverlay.classList.add("open");
  renderSidebar();
}
function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  if (window.matchMedia("(min-width: 1100px)").matches) document.body.classList.add("sidebar-closed");
  sidebarEl.classList.remove("open");
  sidebarOverlay.classList.remove("open");
}

document.getElementById("hamburger-btn").addEventListener("click", openSidebar);
document.getElementById("sidebar-close").addEventListener("click", closeSidebar);
sidebarOverlay.addEventListener("click", closeSidebar);

(function setupSidebarSwipe() {
  const EDGE_ZONE = 24;      // px a partir da borda esquerda pra iniciar o gesto de abrir
  const SIDEBAR_W = 280;
  const MOVE_THRESHOLD = 10; // px de arrasto real antes de "armar" o gesto - evita comer taps/cliques
  let startX = 0, startY = 0, tracking = false, dragging = false, mode = null;

  function onStart(x, y) {
    const isOpen = sidebarEl.classList.contains("open");
    if (!isOpen && x > EDGE_ZONE) return;
    startX = x; startY = y; tracking = true; dragging = false;
    mode = isOpen ? "close" : "open";
  }
  function onMove(x, y) {
    if (!tracking) return;
    const dx = x - startX, dy = y - startY;
    if (!dragging) {
      if (Math.abs(dx) < MOVE_THRESHOLD && Math.abs(dy) < MOVE_THRESHOLD) return; // ainda pode ser só um tap
      if (Math.abs(dy) > Math.abs(dx) * 1.3) { tracking = false; return; } // gesto vertical (scroll) - não é swipe de sidebar

      dragging = true;
      sidebarEl.style.transition = "none";
      sidebarOverlay.style.transition = "none";
      if (mode === "open") { sidebarEl.classList.add("open"); sidebarOverlay.classList.add("open"); }
    }
    let progress;
    if (mode === "open") progress = Math.min(1, Math.max(0, dx / SIDEBAR_W));
    else progress = Math.min(1, Math.max(0, 1 + dx / SIDEBAR_W));
    sidebarEl.style.transform = `translateX(${(progress - 1) * 100}%)`;
    sidebarOverlay.style.opacity = String(progress * 0.5 * 2 <= 1 ? progress : 1);
  }
  function onEnd(x) {
    tracking = false;
    if (!dragging) return; // nunca virou arrasto - era só um tap, não faz nada
    dragging = false;
    sidebarEl.style.transition = "";
    sidebarOverlay.style.transition = "";
    sidebarEl.style.transform = "";
    sidebarOverlay.style.opacity = "";
    const dx = x - startX;
    const shouldOpen = mode === "open" ? dx > SIDEBAR_W * 0.3 : dx > -SIDEBAR_W * 0.3;
    if (shouldOpen) openSidebar(); else closeSidebar();
  }

  document.addEventListener("touchstart", e => onStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  document.addEventListener("touchmove", e => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  document.addEventListener("touchend", e => onEnd(e.changedTouches[0].clientX), { passive: true });
})();

document.getElementById("sidebar-new-chat").addEventListener("click", async () => {
  saveCurrentMessages(); // salva a conversa anterior em segundo plano - não trava a criação da nova
  const tierParaNovoChat = lockBar.classList.contains("show") ? "normal" : currentTier;
  if (tierParaNovoChat !== currentTier) {
    currentTier = tierParaNovoChat;
    currentSpeed = TIER_SPEEDS[currentTier];
    modelLabel.textContent = TIERS[currentTier].label;
    document.querySelectorAll(".model-option").forEach(o =>
      o.classList.toggle("active", o.dataset.tier === currentTier)
    );
  }
  const id = await createChat(currentTier, currentSpeed);

  await loadChat(id, { skipRemote: true });
  updateImageAttach();
  closeSidebar();
});

document.getElementById("sidebar-projeto").addEventListener("click", () => {
  document.getElementById("coming-soon-overlay").classList.add("show");
});
document.getElementById("coming-soon-close").addEventListener("click", () => {
  document.getElementById("coming-soon-overlay").classList.remove("show");
});
document.getElementById("coming-soon-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("coming-soon-overlay"))
    document.getElementById("coming-soon-overlay").classList.remove("show");
});

function renderSidebar() {
  const chats    = loadAllChats();
  const activeId = localStorage.getItem(ACTIVE_KEY);
  const searchQuery = String(window.__boreasSearchQuery ?? "").trim();
  const searchMatches = Array.isArray(window.__boreasSearchResults) ? window.__boreasSearchResults : [];

  const sorted = searchQuery
    ? searchMatches.map(match => ({ ...(chats[match.id] ?? {}), ...match, hasMessages: true }))
    : Object.values(chats)
      .filter(c => c.hasMessages || (c.updatedAt && c.updatedAt !== c.createdAt))
      .sort((a, b) => (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? 1 : -1);
  const listEl = document.getElementById("sidebar-chat-list");
  listEl.innerHTML = "";

  if (!sorted.length) {
    const emptyText = searchQuery
      ? (window.__boreasSearchPending ? "Buscando nas mensagens…" : "Nenhum conteúdo encontrado")
      : "Nenhum chat ainda";
    listEl.innerHTML = `<div class="sidebar-empty-msg">${emptyText}</div>`;
    return;
  }

  for (const chat of sorted) {
    const item = document.createElement("div");
    item.className = "sidebar-chat-item" + (chat.id === activeId ? " active" : "");

    const tierLabel = TIERS[chat.tier]?.label ?? chat.tier ?? "Boreas";
    item.dataset.chatId = chat.id;
    item.innerHTML = `
      <div class="sidebar-chat-item-text">
        <div class="sidebar-chat-title">${escHtml(chat.title)}</div>
        <div class="sidebar-chat-meta">${escHtml(tierLabel)}${chat.role ? ` · ${chat.role === "user" ? "Você" : "Boreas"}` : ""}</div>
        ${chat.snippet ? `<div class="sidebar-chat-match">${escHtml(chat.snippet)}</div>` : ""}
      </div>`;

    item.addEventListener("click", async () => {
      if (item.classList.contains("active")) { closeSidebar(); return; }
      await saveCurrentMessages();
      loadChat(chat.id);
      closeSidebar();
    });

    let _pt;
    item.addEventListener("pointerdown", e => {
      item.classList.add("pressing");
      _pt = setTimeout(() => {
        e.preventDefault();
        item.classList.remove("pressing");
        showCtxMenu(e.clientX, e.clientY, chat.id, chat.title);
      }, 500);
    });
    ["pointerup", "pointercancel", "pointermove"].forEach(ev =>
      item.addEventListener(ev, () => { clearTimeout(_pt); item.classList.remove("pressing"); })
    );

    listEl.appendChild(item);
  }
}

function updateSidebarUser() {
  const name  = localStorage.getItem("boreas_name") ?? "";
  const email = localStorage.getItem("boreas_email") ?? "";
  const initial = name ? name[0].toUpperCase() : "?";
  const el = id => document.getElementById(id);
  if (el("sidebar-avatar"))       el("sidebar-avatar").textContent = initial;
  if (el("sidebar-user-name"))    el("sidebar-user-name").textContent = name || "—";
  if (el("settings-avatar-lg"))   el("settings-avatar-lg").textContent = initial;
  if (el("settings-user-name-modal")) el("settings-user-name-modal").textContent = name || "—";
  if (el("settings-user-email"))  el("settings-user-email").textContent = email || "—";
}

function updateMemoryBtns() {
  const btns = document.getElementById("memory-btns");
  const btn  = document.getElementById("memory-toggle-btn");
  if (!btns) return;
  if (!memoryEnabledGlobal || chatHasMessages) {
    btns.style.display = "none";
  } else {
    btns.style.display = "flex";
    btn.classList.toggle("active", chatMemoryEnabled);
  }
}

document.getElementById("memory-toggle-btn").addEventListener("click", (e) => {
  if (chatHasMessages) return;
  chatMemoryEnabled = !chatMemoryEnabled;
  const btn = document.getElementById("memory-toggle-btn");
  btn.classList.toggle("active", chatMemoryEnabled);

  btn.blur();
  const id = localStorage.getItem(ACTIVE_KEY);
  if (id) {
    if (_chatsMeta[id]) { _chatsMeta[id].memoryEnabled = chatMemoryEnabled; }
  }
});

let _memInfoClose = null;

document.getElementById("memory-info-btn").addEventListener("click", e => {
  e.stopPropagation();

  if (_memInfoClose) { document.removeEventListener("pointerdown", _memInfoClose); _memInfoClose = null; }
  const existing = document.getElementById("memory-popup-el");
  if (existing) { existing.remove(); return; }
  const popup = document.createElement("div");
  popup.className = "memory-info-popup"; popup.id = "memory-popup-el";
  const state = chatMemoryEnabled ? "ligadas" : "desligadas";
  popup.innerHTML = `
    <div class="memory-popup-title">Memória do Boreas</div>
    <div class="memory-popup-desc">Ao ativar, o Boreas vai usar o resumo gerado automaticamente para dar contexto ao modelo, sabendo mais sobre seus interesses e personalidade.</div>
    <div class="memory-popup-status">Atualmente as memórias estão <strong>${state}</strong> para essa conversa.</div>`;
  const r = document.getElementById("memory-info-btn").getBoundingClientRect();
  popup.style.top   = (r.bottom + 8) + "px";
  popup.style.right = Math.max(8, window.innerWidth - r.right - 20) + "px";
  document.body.appendChild(popup);
  const infoBtn = document.getElementById("memory-info-btn");
  const close = ev => {
    if (!popup.contains(ev.target) && !infoBtn.contains(ev.target)) {
      popup.remove();
      document.removeEventListener("pointerdown", close);
      _memInfoClose = null;
    }
  };
  _memInfoClose = close;
  setTimeout(() => document.addEventListener("pointerdown", close), 10);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveCurrentMessages({ keepalive: true });
});
window.addEventListener("pagehide", () => saveCurrentMessages({ keepalive: true }));

const SETTINGS_ICONS = {
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  usage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>',
  capabilities: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="var(--bg)"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="16" cy="12" r="2" fill="var(--bg)"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2" fill="var(--bg)"/></svg>',
  connectors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M9 2v4M15 2v4M7 6h10l-1 5a5 5 0 0 1-8 0L7 6Z"/><path d="M12 15v3M9 21h6"/></svg>',
  font: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 7v13"/></svg>',
  privacy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><polyline points="9 18 15 12 9 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><polyline points="20 6 9 17 4 12"/></svg>',
};
document.querySelectorAll("[data-icon]").forEach(el => {
  el.innerHTML = SETTINGS_ICONS[el.dataset.icon] ?? "";
});

function openSettingsSubview(target) {
  const titles = {
    profile: "Perfil", usage: "Uso", capabilities: "Capacidades",
    connectors: "Conectores", fontstyle: "Estilo de fonte", privacy: "Privacidade",
    memory: "Memória",
  };
  document.getElementById("sub-title").textContent = titles[target] ?? "—";
  document.getElementById("sub-body").innerHTML = "";
  document.getElementById("sub-body").dataset.view = target;
  document.getElementById("view-main").classList.remove("active");
  document.getElementById("view-main").classList.add("behind");
  document.getElementById("view-sub").classList.add("active");
  renderSubview(target);
}
function closeSettingsSubview() {
  document.getElementById("view-sub").classList.remove("active");
  document.getElementById("view-main").classList.remove("behind");
  document.getElementById("view-main").classList.add("active");
}
document.getElementById("settings-back").addEventListener("click", closeSettingsSubview);
document.getElementById("settings-close").addEventListener("click", () => {
  closeUsageModal();
  document.getElementById("settings-overlay").classList.remove("show");
});

function openUsageModal() {
  const overlay = document.getElementById("usage-modal-overlay");
  const body = document.getElementById("usage-modal-body");
  if (!overlay || !body) return;
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
  renderUsageView(body);
}

function closeUsageModal() {
  const overlay = document.getElementById("usage-modal-overlay");
  if (!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
}

document.getElementById("usage-modal-close")?.addEventListener("click", closeUsageModal);
document.getElementById("usage-modal-overlay")?.addEventListener("click", e => {
  if (e.target.id === "usage-modal-overlay") closeUsageModal();
});

function renderSubview(target) {
  const body = document.getElementById("sub-body");
  if (target === "profile")       return renderProfileView(body);
  if (target === "usage")         return renderUsageView(body);
  if (target === "capabilities")  return renderCapabilitiesView(body);
  if (target === "connectors")    return renderConnectorsView(body);
  if (target === "fontstyle")     return renderFontView(body);
  if (target === "privacy")       return renderPrivacyView(body);
  if (target === "memory")        return renderMemoryView(body);
}

document.querySelectorAll(".settings-menu-item[data-target]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.target === "usage") openUsageModal();
    else openSettingsSubview(btn.dataset.target);
  });
});

async function renderProfileView(body) {
  body.innerHTML = `
    <div class="settings-field-label">Seu nome</div>
    <input class="settings-input" id="profile-name-input" placeholder="Seu nome">
    <div class="settings-field-label" style="margin-top:6px">Eu uso o Boreas para...</div>
    <input class="settings-input" id="profile-use-input" placeholder="Ex: estudar, programar, organizar o dia">
    <div class="settings-field-label" style="margin-top:6px">Quais preferências pessoais o Boreas deve seguir?</div>
    <div class="settings-field-hint">Suas preferências serão aplicadas a todas as conversas</div>
    <textarea class="settings-textarea" id="profile-prefs-input" placeholder="Ex: seja direto, evite emojis, use humor ácido..."></textarea>
    <button class="settings-save-btn" id="profile-save-btn" disabled>Atualizar perfil</button>
  `;
  const nameEl = document.getElementById("profile-name-input");
  const useEl  = document.getElementById("profile-use-input");
  const prefEl = document.getElementById("profile-prefs-input");
  const saveBtn = document.getElementById("profile-save-btn");
  let original = { name: "", use: "", preferences: "" };

  const sessionId = localStorage.getItem("boreas_session_id");
  nameEl.value = localStorage.getItem("boreas_name") ?? "";
  useEl.value  = localStorage.getItem("boreas_use") ?? "";
  original.name = nameEl.value; original.use = useEl.value;

  if (sessionId) {
    try {
      const r = await fetch(BACKEND_URL + "/profile", { headers: { "x-session-id": sessionId } });
      if (r.ok) {
        const data = await r.json();
        nameEl.value = data.name ?? nameEl.value;
        useEl.value  = data.use ?? useEl.value;
        prefEl.value = data.preferences ?? "";
        original = { name: nameEl.value, use: useEl.value, preferences: prefEl.value };
      }
    } catch {}
  }

  function checkDirty() {
    const dirty = nameEl.value !== original.name || useEl.value !== original.use || prefEl.value !== original.preferences;
    saveBtn.disabled = !dirty;
  }
  [nameEl, useEl, prefEl].forEach(el => el.addEventListener("input", checkDirty));

  saveBtn.addEventListener("click", async () => {
    if (!sessionId) return;
    saveBtn.disabled = true; saveBtn.textContent = "Salvando...";
    try {
      const r = await fetch(BACKEND_URL + "/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-session-id": sessionId },
        body: JSON.stringify({ name: nameEl.value, use: useEl.value, preferences: prefEl.value }),
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      original = { name: data.name, use: data.use, preferences: data.preferences };
      localStorage.setItem("boreas_name", data.name);
      localStorage.setItem("boreas_use", data.use);
      updateSidebarUser();
      saveBtn.textContent = "Atualizar perfil";
    } catch {
      saveBtn.textContent = "Erro — tentar novamente";
      saveBtn.disabled = false;
    }
  });
}

function renderUsageView(body) {
  body.innerHTML = `
    <div class="usage-period-tabs" id="usage-tabs">
      <button class="usage-tab active" data-period="last_hour">Última hora</button>
      <button class="usage-tab" data-period="today">Hoje</button>
      <button class="usage-tab" data-period="yesterday">Ontem</button>
      <button class="usage-tab" data-period="last_7_days">7 dias</button>
      <button class="usage-tab" data-period="last_30_days">30 dias</button>
      <button class="usage-tab" data-period="last_3_months">3 meses</button>
      <button class="usage-tab" data-period="all_time">Total</button>
    </div>
    <div id="usage-display"><div class="usage-loading">Carregando...</div></div>
  `;
  document.getElementById("usage-tabs").addEventListener("click", e => {
    const btn = e.target.closest(".usage-tab");
    if (!btn) return;
    document.querySelectorAll("#usage-tabs .usage-tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    _activePeriod = btn.dataset.period;
    renderUsage(_activePeriod);
  });
  loadUsageStats();
}

async function renderCapabilitiesView(body) {
  body.innerHTML = `
    <div class="settings-row">
      <div><div class="settings-row-label">Busca na web</div>
        <div class="settings-row-sub">Dá acesso ao Boreas a pesquisa na web, quando necessitar de informações atuais</div></div>
      <div class="toggle-switch" id="cap-webSearch"><div class="toggle-knob"></div></div>
    </div>
    <div class="settings-row">
      <div><div class="settings-row-label">Artefatos</div>
        <div class="settings-row-sub">Permite que o Boreas te envie arquivos diretamente</div></div>
      <div class="toggle-switch" id="cap-artifacts"><div class="toggle-knob"></div></div>
    </div>
    <div class="settings-row">
      <div><div class="settings-row-label">Execução de código</div>
        <div class="settings-row-sub">Dá a capacidade que o Boreas execute código e comandos em seu terminal bash</div></div>
      <div class="toggle-switch" id="cap-codeExecution"><div class="toggle-knob"></div></div>
    </div>
    <div class="settings-section-label">Memória</div>
    <div class="settings-row">
      <div><div class="settings-row-label">Gerar memória a partir de suas conversas</div>
        <div class="settings-row-sub">Permitir que o Boreas lembre do contexto relevante das suas conversas</div></div>
      <div class="toggle-switch" id="memory-global-toggle"><div class="toggle-knob"></div></div>
    </div>
    <button class="settings-menu-item" id="memory-nav-row" style="background:var(--surface);border:1px solid var(--border);border-radius:12px">
      <span class="settings-menu-item-text">
        <div class="settings-row-label" style="font-weight:500">Memória</div>
        <div class="settings-menu-item-sub" id="memory-nav-sub">Carregando...</div>
      </span>
      <span class="settings-menu-chevron" data-icon="chevron"></span>
    </button>
  `;
  document.getElementById("memory-nav-row").querySelector('[data-icon="chevron"]').innerHTML = SETTINGS_ICONS.chevron;
  document.getElementById("memory-global-toggle").classList.toggle("on", memoryEnabledGlobal);
  document.getElementById("memory-global-toggle").addEventListener("click", () => {
    memoryEnabledGlobal = !memoryEnabledGlobal;
    localStorage.setItem("boreas_memory_global", String(memoryEnabledGlobal));
    document.getElementById("memory-global-toggle").classList.toggle("on", memoryEnabledGlobal);
    updateMemoryBtns();
  });
  document.getElementById("memory-nav-row").addEventListener("click", () => openSettingsSubview("memory"));
  loadMemoryNavSub();

  const sessionId = localStorage.getItem("boreas_session_id");
  const caps = ["webSearch", "artifacts", "codeExecution"];
  let current = { webSearch: true, artifacts: true, codeExecution: true };
  if (sessionId) {
    try {
      const r = await fetch(BACKEND_URL + "/capabilities", { headers: { "x-session-id": sessionId } });
      if (r.ok) current = (await r.json()).capabilities;
    } catch {}
  }
  caps.forEach(cap => {
    const el = document.getElementById("cap-" + cap);
    el.classList.toggle("on", current[cap] !== false);
    el.addEventListener("click", async () => {
      const next = !el.classList.contains("on");
      el.classList.toggle("on", next);
      if (!sessionId) return;
      try {
        await fetch(BACKEND_URL + "/capabilities", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-session-id": sessionId },
          body: JSON.stringify({ [cap]: next }),
        });
      } catch {}
    });
  });
}

async function loadMemoryNavSub() {
  const sub = document.getElementById("memory-nav-sub");
  if (!BoreasSync.isAuthed() || !sub) return;
  const data = await BoreasSync.memory.get();
  _memoryCache = data.memory ?? "";
  _memoryLastUpdate = data.lastUpdate ?? 0;
  sub.textContent = data.memory ? `Atualizada ${hoursAgo(data.lastUpdate)}` : "Nenhuma memória ainda";
}
function hoursAgo(ts) {
  if (!ts) return "há pouco";
  const h = Math.max(0, Math.round((Date.now() - ts) / 3600000));
  if (h < 1) return "há poucos minutos";
  if (h === 1) return "há 1 hora";
  if (h < 24) return `há ${h} horas`;
  const d = Math.round(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

function renderMemoryView(body) {
  body.innerHTML = `
    <div class="memory-edit-row" id="memory-edit-row">
      <div class="memory-edit-top">
        <div>
          <div class="settings-row-label">Suas memórias</div>
          <div class="settings-row-sub" id="memory-edit-sub">Carregando...</div>
        </div>
        <button id="memory-edit-btn">✏️</button>
      </div>
      <div id="memory-editor-wrap">
        <textarea id="memory-editor-textarea" placeholder="Nenhuma memória ainda..."></textarea>
        <div class="memory-editor-btns">
          <button id="memory-editor-cancel">Cancelar</button>
          <button id="memory-editor-save">Salvar</button>
        </div>
      </div>
    </div>`;
  loadMemoryIntoSettings();
  document.getElementById("memory-edit-btn").addEventListener("click", () => {
    const wrap = document.getElementById("memory-editor-wrap");
    const ta   = document.getElementById("memory-editor-textarea");
    if (wrap.classList.contains("open")) { wrap.classList.remove("open"); }
    else { ta.value = _memoryCache; wrap.classList.add("open"); ta.focus(); }
  });
  document.getElementById("memory-editor-cancel").addEventListener("click", () => {
    document.getElementById("memory-editor-wrap").classList.remove("open");
  });
  document.getElementById("memory-editor-save").addEventListener("click", async () => {
    if (!BoreasSync.isAuthed()) return;
    const ta = document.getElementById("memory-editor-textarea");
    const btn = document.getElementById("memory-editor-save");
    const subEl = document.getElementById("memory-edit-sub");
    const newMemory = ta.value;
    btn.disabled = true; btn.textContent = "Salvando...";
    const res = await BoreasSync.memory.set(newMemory, undefined);
    if (res.ok) {
      _memoryCache = newMemory;
      _memoryLastUpdate = Date.now();
      if (subEl) subEl.textContent = newMemory ? `Atualizada ${hoursAgo(_memoryLastUpdate)}` : "Nenhuma memória ainda";
      document.getElementById("memory-editor-wrap").classList.remove("open");
    } else {
      // BoreasSync centralizes authenticated chats, memory, and usage calls.
      btn.textContent = res.error === "unauthorized" ? "Sessão expirada" : "Sem conexão — será enviado depois";
    }
    btn.disabled = false;
    if (btn.textContent === "Salvando...") btn.textContent = "Salvar";
  });
}

async function renderConnectorsView(body) {
  body.innerHTML = `
    <div class="settings-connectors-intro">
      <div class="settings-connectors-intro-icon">${SETTINGS_ICONS.connectors}</div>
      <div>
        <div class="settings-row-label">Conectores do Boreas</div>
        <div class="settings-row-sub">Permissões externas ficam desligadas por padrão e só são aplicadas à VM desta conta.</div>
      </div>
    </div>
    <div class="settings-section-label">Sandbox</div>
    <div class="settings-row settings-connector-card">
      <div class="settings-connector-copy">
        <div class="settings-row-label">Acesso web na VM</div>
        <div class="settings-row-sub">Permite DNS, HTTP e HTTPS dentro da VM para pesquisas, downloads e instalações. Sem isso, a VM não possui rota de internet.</div>
      </div>
      <div class="toggle-switch" id="cap-sandboxNetwork" role="switch" aria-label="Acesso web na VM"><div class="toggle-knob"></div></div>
    </div>
    <div class="settings-security-note">
      <span class="settings-security-note-icon">${SETTINGS_ICONS.privacy}</span>
      <span>Mesmo ativado, o acesso é limitado a web e o serviço de metadata da nuvem permanece bloqueado.</span>
    </div>
    <div class="settings-section-label">Mais conectores</div>
    <div class="settings-connectors-empty">
      <div class="settings-connectors-empty-title">Em breve</div>
      <div class="settings-connectors-empty-desc">Integrações com outras ferramentas e serviços serão adicionadas aqui.</div>
    </div>`;

  const toggle = document.getElementById("cap-sandboxNetwork");
  const sessionId = localStorage.getItem("boreas_session_id");
  let current = { sandboxNetwork: false };
  if (sessionId) {
    try {
      const r = await fetch(BACKEND_URL + "/capabilities", { headers: { "x-session-id": sessionId } });
      if (r.ok) current = (await r.json()).capabilities ?? current;
    } catch {}
  }
  toggle.classList.toggle("on", current.sandboxNetwork === true);
  toggle.setAttribute("aria-checked", String(current.sandboxNetwork === true));
  toggle.addEventListener("click", async () => {
    const next = !toggle.classList.contains("on");
    toggle.classList.toggle("on", next);
    toggle.setAttribute("aria-checked", String(next));
    if (!sessionId) return;
    try {
      const r = await fetch(BACKEND_URL + "/capabilities", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-session-id": sessionId },
        body: JSON.stringify({ sandboxNetwork: next }),
      });
      if (!r.ok) throw new Error("capability update failed");
    } catch {
      toggle.classList.toggle("on", !next);
      toggle.setAttribute("aria-checked", String(!next));
    }
  });
}

function renderPrivacyView(body) {
  body.innerHTML = `
    <div class="settings-privacy-text">Nenhuma sua conversa será acessada ou usada para treinamento. Quando o modelo pesquisa ou executa um comando, é mostrado um log anônimo no servidor, sem seu conteúdo.</div>`;
}

async function renderFontView(body) {
  body.innerHTML = `<div id="font-list-wrap"><div class="usage-loading">Carregando...</div></div>`;
  const sessionId = localStorage.getItem("boreas_session_id");
  let current = { font: localStorage.getItem("boreas_font") || "Inter", availableFonts: [] };
  if (sessionId) {
    try {
      const r = await fetch(BACKEND_URL + "/appearance", { headers: { "x-session-id": sessionId } });
      if (r.ok) current = await r.json();
    } catch {}
  }
  if (current.availableFonts.length) {
    const previewId = "font-preview-link";
    let previewLink = document.getElementById(previewId);
    if (!previewLink) {
      previewLink = document.createElement("link");
      previewLink.id = previewId; previewLink.rel = "stylesheet";
      document.head.appendChild(previewLink);
    }
    const families = current.availableFonts
      .map(f => "family=" + f.replace(/ /g, "+") + ":wght@400;600")
      .join("&");
    previewLink.href = "https://fonts.googleapis.com/css2?" + families + "&display=swap";
  }
  const wrap = document.getElementById("font-list-wrap");
  wrap.innerHTML = `<div class="settings-menu-group">` +
    current.availableFonts.map(f =>
      `<div class="font-list-item${f === current.font ? " selected" : ""}" data-font="${f}">
        <span style="font-family:'${f}',sans-serif">${f}</span>
        <span class="settings-check">${SETTINGS_ICONS.check}</span>
      </div>`
    ).join("") + `</div>`;
  wrap.querySelectorAll(".font-list-item").forEach(item => {
    item.addEventListener("click", async () => {
      const font = item.dataset.font;
      applyFont(font);
      wrap.querySelectorAll(".font-list-item").forEach(i => i.classList.toggle("selected", i === item));
      if (!sessionId) return;
      try {
        await fetch(BACKEND_URL + "/appearance", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-session-id": sessionId },
          body: JSON.stringify({ font }),
        });
      } catch {}
    });
  });
}

function applyFont(font) {
  localStorage.setItem("boreas_font", font);
  const linkId = "user-font-link";
  let link = document.getElementById(linkId);
  if (!link) {
    link = document.createElement("link");
    link.id = linkId; link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = "https://fonts.googleapis.com/css2?family=" + font.replace(/ /g, "+") + ":wght@400;500;600;700&display=swap";
  document.documentElement.style.setProperty("--user-font", `'${font}'`);
}
(function initFontOnLoad() {
  const saved = localStorage.getItem("boreas_font");
  if (saved && saved !== "Inter") applyFont(saved);
})();
// O tema claro foi removido; elimina a preferência antiga sem afetar outras
// configurações locais do usuário.
try { localStorage.removeItem("boreas_theme"); } catch {}

document.getElementById("sidebar-settings-btn").addEventListener("click", async () => {
  closeSidebar();
  updateSidebarUser();
  closeUsageModal();
  closeSettingsSubview();
  document.getElementById("settings-overlay").classList.add("show");

  const sessionId = localStorage.getItem("boreas_session_id");
  if (sessionId) {
    try {
      const r = await fetch(BACKEND_URL + "/appearance", { headers: { "x-session-id": sessionId } });
      if (r.ok) {
        const data = await r.json();
        if (data.font) applyFont(data.font);
      }
    } catch {}
  }
});

let _memoryLastUpdate = 0;
let _usageData = null;
let _activePeriod = "last_hour";

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function renderUsage(period) {
  const el = document.getElementById("usage-display");
  if (!_usageData) { el.innerHTML = '<div class="usage-loading">Sem dados ainda.</div>'; return; }
  const d = _usageData[period];
  if (!d) { el.innerHTML = '<div class="usage-loading">—</div>'; return; }
  const promptTokens = Number(d.prompt_tokens ?? 0);
  const completionTokens = Number(d.completion_tokens ?? 0);
  const totalTokens = Math.max(0, Number(d.total_tokens ?? promptTokens + completionTokens));
  const promptWidth = totalTokens ? Math.round((promptTokens / totalTokens) * 100) : 0;
  const completionWidth = totalTokens ? Math.max(0, 100 - promptWidth) : 0;
  el.innerHTML = `
    <div class="usage-visual-card">
      <div class="usage-visual-head"><span>Atividade no período</span><strong>${fmtNum(totalTokens)} tokens</strong></div>
      <div class="usage-visual-bar" aria-label="${promptWidth}% entrada e ${completionWidth}% saída">
        <span class="usage-visual-prompt" style="width:${promptWidth}%"></span>
        <span class="usage-visual-completion" style="width:${completionWidth}%"></span>
      </div>
      <div class="usage-visual-legend">
        <span><i class="usage-dot prompt"></i>Entrada ${fmtNum(promptTokens)}</span>
        <span><i class="usage-dot completion"></i>Saída ${fmtNum(completionTokens)}</span>
      </div>
    </div>
    <div class="usage-cards">
      <div class="usage-card">
        <div class="usage-card-label">TOTAL</div>
        <div class="usage-card-value">${fmtNum(totalTokens)}</div>
        <div class="usage-card-sub">tokens</div>
      </div>
      <div class="usage-card">
        <div class="usage-card-label">REQUISIÇÕES</div>
        <div class="usage-card-value">${fmtNum(d.requests)}</div>
        <div class="usage-card-sub">mensagens</div>
      </div>
      <div class="usage-card">
        <div class="usage-card-label">ENTRADA</div>
        <div class="usage-card-value">${fmtNum(promptTokens)}</div>
        <div class="usage-card-sub">prompt tokens</div>
      </div>
      <div class="usage-card">
        <div class="usage-card-label">SAÍDA</div>
        <div class="usage-card-value">${fmtNum(completionTokens)}</div>
        <div class="usage-card-sub">completion tokens</div>
      </div>
    </div>`;
}

async function loadUsageStats() {
  const el = document.getElementById("usage-display");
  el.innerHTML = '<div class="usage-loading">Carregando...</div>';
  const data = await BoreasSync.usage.get(); // retries + falls back to last cached usage internally
  if (data) {
    _usageData = data.stats ?? null;
    renderUsage(_activePeriod);
    return;
  }
  _usageData = null;
  el.innerHTML = '<div class="usage-loading">Não foi possível carregar o uso.</div>';
}

document.getElementById("settings-logout-btn").addEventListener("click", () => {
  ["boreas_session_id","boreas_name","boreas_email","boreas_use","boreas_onboarded",
   ACTIVE_KEY, "boreas_memory_global","boreas_theme","boreas_font"].forEach(k => localStorage.removeItem(k));

  for (const k in _chatsMeta) delete _chatsMeta[k];
  location.reload();
});

let _memoryCache = "";

async function loadMemoryIntoSettings() {
  const subEl     = document.getElementById("memory-edit-sub");
  const editRow   = document.getElementById("memory-edit-row");
  if (!BoreasSync.isAuthed()) { if (editRow) editRow.style.display = "none"; return; }
  if (subEl) subEl.textContent = "Carregando...";
  const data = await BoreasSync.memory.get(); // retries + cache fallback internally
  _memoryCache = data.memory ?? "";
  _memoryLastUpdate = data.lastUpdate ?? 0;
  if (subEl) {
    subEl.textContent = _memoryCache ? `Atualizada ${hoursAgo(_memoryLastUpdate)}` : "Nenhuma memória ainda";
  }
}

async function tryUpdateMemory() {
  const id = localStorage.getItem(ACTIVE_KEY);
  if (!id) return;
  const chat = _chatsMeta[id];
  if (!chat || chat.memoryEnabled === false || !memoryEnabledGlobal) return;

  if (!BoreasSync.isAuthed()) return;

  const processedUpTo = chat.memoryProcessedUpTo ?? 0;
  const newMsgs = messages.slice(processedUpTo)
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => {
      const text = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter(p => p.type === "text").map(p => p.text).join(" ")
          : "";
      return text ? { role: m.role, content: text } : null;
    })
    .filter(Boolean);

  if (!newMsgs.length) return;

  const res = await BoreasSync.memory.update(newMsgs, Date.now());
  if (res.ok && res.data.updated) {
    if (_chatsMeta[id]) { _chatsMeta[id].memoryProcessedUpTo = messages.length; }
  }
}
function showCtxMenu(x, y, chatId, chatTitle) {
  document.getElementById("ctx-menu-el")?.remove();
  const menu = document.createElement("div");
  menu.className = "ctx-menu"; menu.id = "ctx-menu-el";
  menu.style.left = Math.min(x, window.innerWidth - 176) + "px";
  menu.style.top  = Math.min(y, window.innerHeight - 100) + "px";
  menu.innerHTML = `
    <div class="ctx-item" id="ctx-rename">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Renomear
    </div>
    <div class="ctx-item" id="ctx-resume">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
      Resumir conversa
    </div>
    <div class="ctx-item danger" id="ctx-delete">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      Deletar
    </div>`;
  document.body.appendChild(menu);

  document.getElementById("ctx-rename").addEventListener("click", () => {
    menu.remove(); showRenameModal(chatId, chatTitle);
  });
  document.getElementById("ctx-resume").addEventListener("click", () => {
    menu.remove(); resumeConversation(chatId);
  });
  document.getElementById("ctx-delete").addEventListener("click", () => {
    menu.remove(); deleteChat(chatId);
  });

  const closeCtx = ev => {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("pointerdown", closeCtx); }
  };
  setTimeout(() => document.addEventListener("pointerdown", closeCtx), 10);
}

let _renameId = null;
function showRenameModal(chatId, current) {
  _renameId = chatId;
  const overlay = document.getElementById("rename-overlay");
  const input = document.getElementById("rename-input");
  input.value = current;
  overlay.classList.add("show");
  setTimeout(() => { input.focus(); input.select(); }, 80);
}
document.getElementById("rename-confirm").addEventListener("click", () => {
  if (!_renameId) return;
  setChatTitle(_renameId, document.getElementById("rename-input").value);
  document.getElementById("rename-overlay").classList.remove("show");
  _renameId = null;
});
document.getElementById("rename-cancel").addEventListener("click", () => {
  document.getElementById("rename-overlay").classList.remove("show");
  _renameId = null;
});
document.getElementById("rename-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("rename-confirm").click();
  if (e.key === "Escape") document.getElementById("rename-cancel").click();
});
document.getElementById("rename-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("rename-overlay"))
    document.getElementById("rename-cancel").click();
});

// "Resumir conversa" - trava a tela com um popup enquanto o backend resume
// o histórico salvo do chat (pode levar alguns segundos, é uma chamada real
// de modelo). Ao terminar, se o chat resumido é o que está aberto agora,
// recarrega ele do servidor pra refletir o novo histórico compactado.
function showResumeResult(title, desc) {
  document.getElementById("resume-processing").style.display = "none";
  document.getElementById("resume-result-title").textContent = title;
  document.getElementById("resume-result-desc").textContent = desc;
  document.getElementById("resume-result").style.display = "";
}
const RESUME_FAIL_REASONS = {
  too_short: "Essa conversa ainda é curta demais pra valer a pena resumir.",
  nothing_to_compact: "Não achei nada resumível aqui (só mensagens recentes ou com imagem).",
  no_token: "Nenhum token do Hugging Face disponível agora. Tente de novo mais tarde.",
  token_exhausted: "Os tokens do Hugging Face esgotaram. Tente de novo mais tarde.",
  parse_error: "O modelo devolveu uma resposta em formato inesperado. Tente de novo.",
  bad_shape: "O modelo devolveu uma resposta em formato inesperado. Tente de novo.",
  error: "Algo deu errado ao resumir. Tente de novo.",
  "unauthorized": "Sessão expirada — faça login de novo.",
};
async function resumeConversation(chatId) {
  const overlay = document.getElementById("resume-overlay");
  document.getElementById("resume-processing").style.display = "";
  document.getElementById("resume-result").style.display = "none";
  overlay.classList.add("show");

  const res = await BoreasSync.chats.resume(chatId);

  if (!res.ok || !res.data?.resumed) {
    const reason = res.data?.reason || res.error || "error";
    showResumeResult("Não deu pra resumir", RESUME_FAIL_REASONS[reason] || RESUME_FAIL_REASONS.error);
    return;
  }

  const { charsBefore, charsAfter, messagesCompacted } = res.data;
  const pct = charsBefore > 0 ? Math.round((1 - charsAfter / charsBefore) * 100) : 0;
  showResumeResult(
    "Conversa resumida!",
    `${messagesCompacted} mensagem(ns) antiga(s) foram condensadas — histórico ${pct > 0 ? `~${pct}% menor` : "atualizado"}.`
  );

  // Se o chat resumido é o que está aberto agora, recarrega pra refletir o
  // histórico novo. Se for outro chat da sidebar, não mexe na tela atual.
  if (localStorage.getItem(ACTIVE_KEY) === chatId) {
    await loadChat(chatId);
  }
}
document.getElementById("resume-close-btn").addEventListener("click", () => {
  document.getElementById("resume-overlay").classList.remove("show");
});
document.getElementById("resume-overlay").addEventListener("click", e => {
  // Só fecha clicando fora depois que o resultado já apareceu - enquanto
  // está processando, fica travado de propósito (é o comportamento pedido).
  if (e.target === document.getElementById("resume-overlay") &&
      document.getElementById("resume-result").style.display !== "none") {
    document.getElementById("resume-overlay").classList.remove("show");
  }
});
