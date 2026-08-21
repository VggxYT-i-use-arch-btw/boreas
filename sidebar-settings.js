// Boreas frontend module: sidebar shell, settings navigation, profile, and capabilities.
// Loaded as a classic script in the exact order declared by index.html.

// Boreas: sidebar, menu de modelos e configurações.

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

function showToast(message) {
  document.querySelectorAll(".sidebar-error-toast").forEach(el => el.remove());
  const toast = document.createElement("div");
  toast.className = "sidebar-error-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

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
      try {
        await saveCurrentMessages();
        await loadChat(chat.id);
      } catch (error) {
        console.error("[sidebar] Falha ao abrir conversa:", error);
        if (typeof showToast === "function") showToast("Não foi possível abrir esta conversa.");
      } finally {
        closeSidebar();
      }
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
  if (el("sidebar-user-name"))    el("sidebar-user-name").textContent = name || "-";
  if (el("settings-avatar-lg"))   el("settings-avatar-lg").textContent = initial;
  if (el("settings-user-name-modal")) el("settings-user-name-modal").textContent = name || "-";
  if (el("settings-user-email"))  el("settings-user-email").textContent = email || "-";
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
    <div class="memory-popup-desc">Ao ativar, o Boreas pode usar a memória persistente organizada por categorias. O modelo adiciona ou consulta itens quando isso for relevante.</div>
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
  document.getElementById("sub-title").textContent = titles[target] ?? "-";
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
      saveBtn.textContent = "Erro - tentar novamente";
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
      <div><div class="settings-row-label">Memória persistente</div>
        <div class="settings-row-sub">Permitir que o modelo guarde e consulte contexto relevante por categoria</div></div>
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
