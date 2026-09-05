// Boreas frontend module: memory, connectors, privacy, and font settings.
// Loaded as a classic script in the exact order declared by index.html.

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
        <textarea id="memory-editor-textarea" placeholder="## You\n- Preferências e fatos importantes sobre você..."></textarea>
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
      btn.textContent = res.error === "unauthorized" ? "Sessão expirada" : "Sem conexão - será enviado depois";
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
  let current = { sandboxNetwork: false };
  if (BoreasSync.isAuthed()) {
    try {
      const r = await fetch(BACKEND_URL + "/capabilities", { headers: BoreasSessionHeaders(), credentials: "include" });
      if (r.ok) current = (await r.json()).capabilities ?? current;
    } catch {}
  }
  toggle.classList.toggle("on", current.sandboxNetwork === true);
  toggle.setAttribute("aria-checked", String(current.sandboxNetwork === true));
  toggle.addEventListener("click", async () => {
    const next = !toggle.classList.contains("on");
    toggle.classList.toggle("on", next);
    toggle.setAttribute("aria-checked", String(next));
    if (!BoreasSync.isAuthed()) return;
    try {
      const r = await fetch(BACKEND_URL + "/capabilities", {
        method: "PUT",
        headers: BoreasSessionHeaders({ "Content-Type": "application/json" }),
        credentials: "include",
        body: JSON.stringify({ sandboxNetwork: next }),
      });
      if (!r.ok) throw await boreasHttpError(r);
    } catch (error) {
      toggle.classList.toggle("on", !next);
      toggle.setAttribute("aria-checked", String(!next));
      showToast(error?.message || "Não foi possível atualizar o acesso web da VM.");
    }
  });
}

function renderPrivacyView(body) {
  body.innerHTML = `
    <div class="settings-privacy-text">Nenhuma sua conversa será acessada ou usada para treinamento. Quando o modelo pesquisa ou executa um comando, é mostrado um log anônimo no servidor, sem seu conteúdo.</div>`;
}

async function renderFontView(body) {
  body.innerHTML = `<div id="font-list-wrap"><div class="usage-loading">Carregando...</div></div>`;
  // NOTE (bug #18, revisado 2026-09-02): "Geist" é a fonte padrão real do
  // app desde o redesign anti-slop (ver --user-font em styles.css), mas
  // não está na lista AVAILABLE_FONTS do back-end (config/runtime.js) -
  // essa lista é só de fontes alternativas de personalização, não inclui
  // a fonte padrão. O bug original era o fallback aqui apontar para
  // "Inter", que É um item real da lista e por isso aparecia marcado
  // como "selected" mesmo quando o usuário nunca escolheu Inter
  // explicitamente. Trocando para "Geist" o problema se resolve por
  // consequência: como Geist não está na lista, nenhum item fica marcado
  // quando não há preferência customizada salva - que é o comportamento
  // correto (nenhuma das alternativas foi escolhida, então nenhuma deve
  // aparecer com check).
  let current = { font: localStorage.getItem("boreas_font") || "Geist", availableFonts: [] };
  if (BoreasSync.isAuthed()) {
    try {
      const r = await fetch(BACKEND_URL + "/appearance", { headers: BoreasSessionHeaders(), credentials: "include" });
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
      const previousFont = localStorage.getItem("boreas_font") || "Geist";
      applyFont(font);
      wrap.querySelectorAll(".font-list-item").forEach(i => i.classList.toggle("selected", i === item));
      if (!BoreasSync.isAuthed()) return;
      try {
        const response = await fetch(BACKEND_URL + "/appearance", {
          method: "PUT",
          headers: BoreasSessionHeaders({ "Content-Type": "application/json" }),
          credentials: "include",
          body: JSON.stringify({ font }),
        });
        if (!response.ok) throw await boreasHttpError(response);
      } catch (error) {
        applyFont(previousFont);
        wrap.querySelectorAll(".font-list-item").forEach(i => i.classList.toggle("selected", i.dataset.font === previousFont));
        showToast(error?.message || "Não foi possível atualizar a fonte.");
      }
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
// Light theme was removed; clears the old preference without affecting
// other local user settings.
try { localStorage.removeItem("boreas_theme"); } catch {}

document.getElementById("sidebar-settings-btn").addEventListener("click", async () => {
  closeSidebar();
  updateSidebarUser();
  closeUsageModal();
  closeSettingsSubview();
  document.getElementById("settings-overlay").classList.add("show");

  if (BoreasSync.isAuthed()) {
    try {
      const r = await fetch(BACKEND_URL + "/appearance", { headers: BoreasSessionHeaders(), credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        if (data.font) applyFont(data.font);
      }
    } catch {}
  }
});

let _memoryLastUpdate = 0;
