// Boreas frontend module: usage, conversation context actions, rename, and resume.
// Loaded as a classic script in the exact order declared by index.html.

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
  if (!d) { el.innerHTML = '<div class="usage-loading">-</div>'; return; }
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

document.getElementById("settings-logout-btn").addEventListener("click", async () => {
  // Invalida a sessão no servidor quando possível. O carregamento da fila e
  // das gerações pendentes também é interrompido abaixo antes de trocar de
  // conta neste navegador.
  if (typeof BoreasSync !== "undefined" && BoreasSync.isAuthed()) {
    const result = await BoreasSync.request("/logout", { method: "POST", retries: 0, silent: true, keepalive: true, timeoutMs: 10000 });
    if (!result.ok && result.error !== "unauthorized") {
      showToast("Não foi possível invalidar a sessão. Tente novamente.");
      return;
    }
  }
  const currentScope = localStorage.getItem("boreas_session_scope") || "";
  await Promise.all([
    globalThis.BoreasClearSyncQueue?.(),
    globalThis.BoreasClearImageStore?.(currentScope),
    globalThis.BoreasClearAllImageStore?.(),
    globalThis.BoreasClearLegacyImageStore?.(),
  ]);
  globalThis.BoreasClearScopedCache?.(currentScope);
  globalThis.BoreasClearAllScopedCaches?.();
  await globalThis.BoreasSetAuthScope?.(null);
  ["boreas_authenticated","boreas_name","boreas_email","boreas_use","boreas_onboarded",
   ACTIVE_KEY, "boreas_pending_gen", "boreas_session_scope", "boreas_memory_global","boreas_theme","boreas_font"].forEach(k => localStorage.removeItem(k));

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
  "unauthorized": "Sessão expirada - faça login de novo.",
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
    `${messagesCompacted} mensagem(ns) antiga(s) foram condensadas - histórico ${pct > 0 ? `~${pct}% menor` : "atualizado"}.`
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
