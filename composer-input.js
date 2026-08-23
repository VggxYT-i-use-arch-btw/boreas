// Boreas: composer, formato do input, plugins e menções.

const modelPill  = document.getElementById("model-pill");
const modelLabel = document.getElementById("model-label");

const noVisionWarnEl   = document.getElementById("novision-warn");
const noVisionWarnText = document.getElementById("novision-warn-text");
let noVisionWarnTimeout = null;
function showNoVisionWarn(text) {
  if (!noVisionWarnEl) return;
  noVisionWarnText.textContent = text;
  noVisionWarnEl.classList.add("show");
  clearTimeout(noVisionWarnTimeout);
  noVisionWarnTimeout = setTimeout(() => noVisionWarnEl.classList.remove("show"), 2800);
}

modelLabel.textContent = TIERS[currentTier].label;
document.querySelectorAll(".model-option").forEach(o =>
  o.classList.toggle("active", o.dataset.tier === currentTier)
);
syncEffortUI();

modelPill.addEventListener("click", e => { modelPill.classList.toggle("open"); e.stopPropagation(); });
modelPill.addEventListener("pointerdown", e => { if (e.target === modelPill || e.target === modelLabel || e.target.closest(".model-pill") === modelPill && !e.target.closest(".model-dropdown")) { modelPill.classList.add("pressing"); } });
modelPill.addEventListener("pointerup",     () => modelPill.classList.remove("pressing"));
modelPill.addEventListener("pointerleave",  () => modelPill.classList.remove("pressing"));
document.addEventListener("click", () => {
  modelPill.classList.remove("open");
  document.getElementById("effort-section")?.classList.remove("open");
  document.getElementById("more-models-section")?.classList.remove("open");
});

document.getElementById("more-models-btn")?.addEventListener("click", e => {
  e.stopPropagation();
  document.getElementById("more-models-section")?.classList.toggle("open");
});

document.querySelectorAll(".model-option").forEach(opt => {
  opt.addEventListener("click", e => {
    e.stopPropagation();
    const tier = String(opt.dataset.tier ?? "");
    if (!Object.hasOwn(TIERS, tier) || !Object.hasOwn(TIER_SPEEDS, tier)) return;

    if (NO_VISION_TIERS.includes(tier)) {
      const hasImages = messages.some(m =>
        Array.isArray(m.content) && m.content.some(p => p.type === "image_url")
      );
      if (hasImages) {
        modelPill.classList.remove("open");
        showNoVisionWarn(`${NO_VISION_LABEL[tier]} não suporta imagens nesta conversa`);
        return;
      }
    }

    currentTier = tier;
    currentSpeed = TIER_SPEEDS[currentTier];
    currentEffort = EFFORT_TIERS.includes(currentTier) ? lastEffortFor(currentTier) : "default";
    modelLabel.textContent = TIERS[tier].label;
    document.querySelectorAll(".model-option").forEach(o => o.classList.remove("active"));
    opt.classList.add("active");
    syncEffortUI();
    modelPill.classList.remove("open");
    updateImageAttach();

    localStorage.setItem(LAST_TIER_KEY, currentTier);

    saveCurrentMessages();
  });
});

const effortSection = document.getElementById("effort-section");
document.getElementById("effort-pill-btn")?.addEventListener("click", e => {
  e.stopPropagation();
  effortSection?.classList.toggle("open");
});

document.querySelectorAll(".effort-option").forEach(btn => {
  btn.addEventListener("click", e => {
    e.stopPropagation();
    if (!EFFORT_TIERS.includes(currentTier)) return; // section is hidden anyway, but guard just in case
    if (!VALID_EFFORTS.includes(btn.dataset.effort)) return;
    currentEffort = btn.dataset.effort;
    document.querySelectorAll(".effort-option").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("effort-pill-btn-value").textContent = EFFORT_LABELS[currentEffort] ?? "Padrão";
    localStorage.setItem((ACCOUNT_SCOPE ? "boreas_last_effort_" + ACCOUNT_SCOPE + "_" : "boreas_last_effort_unauthed_") + currentTier, currentEffort);
    effortSection?.classList.remove("open");
    saveCurrentMessages();
  });
});

const speedDescEl = document.getElementById("speed-desc");
const speedDescriptions = {
  fastest: "⚡ Responde rapidamente mas consome até 3x mais tokens.",
  cheapest: "🪙 Economiza seu uso mas é mais lento.",
};

function updateImageAttach() {
  const camCard = document.getElementById("asheet-camera");
  const photoCard = document.getElementById("asheet-photos");
  if (!camCard || !photoCard) return;
  if (NO_VISION_TIERS.includes(currentTier)) {
    camCard.classList.add("disabled");
    photoCard.classList.add("disabled");
    camCard.title = photoCard.title = `Boreas ${NO_VISION_LABEL[currentTier]} não suporta imagens`;

    if (pendingImages.length) {
      pendingImages = [];
      renderPreviewThumbs();
    }
  } else {
    camCard.classList.remove("disabled");
    photoCard.classList.remove("disabled");
    camCard.title = photoCard.title = "";
  }
}

document.getElementById("lock-upgrade-btn")?.addEventListener("click", () => {
  const requested = document.getElementById("lock-upgrade-btn").dataset.switchTo;
  const switchTo = Object.hasOwn(TIERS, requested) ? requested : "normal";
  currentTier = switchTo;
  currentSpeed = TIER_SPEEDS[currentTier];
  currentEffort = EFFORT_TIERS.includes(currentTier) ? lastEffortFor(currentTier) : "default";
  modelLabel.textContent = TIERS[currentTier].label;
  document.querySelectorAll(".model-option").forEach(o =>
    o.classList.toggle("active", o.dataset.tier === currentTier)
  );
  syncEffortUI();
  lockBar.classList.remove("show");
  if (inputRow) inputRow.style.display = "";
  sendBtn.disabled = false;
  updateImageAttach();
});

function setSpeed(btn) {
  if (!Object.values(TIER_SPEEDS).includes(btn.dataset.speed)) return;
  currentSpeed = btn.dataset.speed;
  document.querySelectorAll(".speed-opt").forEach(b => b.classList.remove("active"));
  void btn.offsetWidth;
  btn.classList.add("active");
  speedDescEl.textContent = speedDescriptions[currentSpeed];
  saveCurrentMessages();
}

document.querySelectorAll(".speed-opt").forEach(btn => {
  btn.addEventListener("click", e => { e.stopPropagation(); setSpeed(btn); });
});

const messagesEl = document.getElementById("messages");
const scrollBottomBtn = document.getElementById("scroll-bottom-btn");

let autoScroll = true;
let _scrollFrame = 0;
function updateScrollBtn() {
  const hasScrollableMessages = messagesEl.querySelector(".msg-row")
    && messagesEl.scrollHeight > messagesEl.clientHeight + 4;
  const distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  const awayFromLatest = hasScrollableMessages && distance > 80;
  scrollBottomBtn.classList.toggle("show", awayFromLatest);
}
messagesEl.addEventListener("scroll", () => {
  const dist = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  autoScroll = dist < 4;
  updateScrollBtn();
});
scrollBottomBtn.addEventListener("click", () => scrollToBottom(true));

function scrollToBottom(force) {
  if (force) autoScroll = true;
  updateScrollBtn();
  if (!autoScroll || _scrollFrame) return;

  // Streaming can call this function several times per network chunk. Keep
  // one write per frame so reading scrollHeight and updating scrollTop do not
  // force repeated layout passes while the answer is being rendered.
  _scrollFrame = requestAnimationFrame(() => {
    _scrollFrame = 0;
    if (autoScroll) messagesEl.scrollTop = messagesEl.scrollHeight;
    updateScrollBtn();
  });
}
const msgInput   = document.getElementById("msg-input");
const sendBtn    = document.getElementById("send-btn");

msgInput.focus();

function inputMaxHeight() {
  return Math.round(window.innerHeight * 0.25);
}

let _shrinkTimer = null;
let _collapsedWidth = null;

const _radiusMirror = document.createElement("div");
_radiusMirror.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;top:-9999px;left:-9999px;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;";
document.body.appendChild(_radiusMirror);

function getCollapsedWidth() {
  const row = document.querySelector(".input-row");
  if (!row) return msgInput.clientWidth;

  if (!row.classList.contains("expanded")) {
    _collapsedWidth = msgInput.clientWidth;
    return _collapsedWidth;
  }

  // Estamos no estado expandido (é justamente quando updateInputRadius()
  // mais precisa medir "quanto mediria a caixa colapsada" pra decidir se dá
  // pra encolher). Antes, isso caía no fallback `_collapsedWidth ?? clientWidth`
  // e ficava lendo um valor cacheado antigo (ou, na primeira vez, o próprio
  // clientWidth JÁ EXPANDIDO, que é bem mais largo que o colapsado). Isso
  // fazia o cálculo de quebra de linha errar e a barra virar bolinha (999px)
  // mesmo com texto que ainda precisa de 2 linhas, ou travar quadrada quando
  // não devia. Tira a classe, mede de verdade, bota de volta - tudo síncrono,
  // então o navegador nunca chega a pintar o estado intermediário.
  row.classList.remove("expanded");
  const w = msgInput.clientWidth;
  row.classList.add("expanded");
  _collapsedWidth = w;
  return w;
}
window.addEventListener("resize", () => { _collapsedWidth = null; });

function applyInputShape(isExpanded) {
  const row = document.querySelector(".input-row");
  if (row.classList.contains("expanded") === isExpanded) return;
  row.style.borderRadius = isExpanded ? "18px" : "999px";
  row.classList.toggle("expanded", isExpanded);

  void row.offsetWidth;
}

function updateInputRadius() {
  const cs = getComputedStyle(msgInput);
  const lineHeight = parseFloat(cs.lineHeight) || 22;
  const paddingV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const oneLineHeight = lineHeight + paddingV;

  _radiusMirror.style.fontFamily = cs.fontFamily;
  _radiusMirror.style.fontSize   = cs.fontSize;
  _radiusMirror.style.lineHeight = cs.lineHeight;
  _radiusMirror.style.padding    = cs.padding;
  _radiusMirror.style.width      = getCollapsedWidth() + "px";
  _radiusMirror.textContent      = msgInput.value + "\u200b"; // preserva quebra em \n no final

  const h = _radiusMirror.scrollHeight;

  const shouldExpand = h > oneLineHeight + 1; // +1px de tolerância pra rounding

  if (shouldExpand) {
    if (_shrinkTimer) { clearTimeout(_shrinkTimer); _shrinkTimer = null; }
    applyInputShape(true);
  } else if (_shrinkTimer === null) {
    _shrinkTimer = setTimeout(() => {
      _shrinkTimer = null;
      _radiusMirror.style.width = getCollapsedWidth() + "px";
      _radiusMirror.textContent = msgInput.value + "\u200b";
      if (_radiusMirror.scrollHeight <= oneLineHeight + 1) applyInputShape(false);
    }, 180);
  }
}

// Liga o scroll da textarea só quando o texto passa da altura máxima.
function syncInputOverflow() {
  const maxH = inputMaxHeight();
  msgInput.style.overflowY = msgInput.scrollHeight > maxH ? "auto" : "hidden";
}

msgInput.addEventListener("input", () => {
  if (!loading) sendBtn.disabled = !msgInput.value.trim() && !pendingImages.length && !pendingFile;
  msgInput.style.height = "auto";
  msgInput.style.height = Math.min(msgInput.scrollHeight, inputMaxHeight()) + "px";
  syncInputOverflow();
  updateInputRadius();
});

window.addEventListener("resize", () => {
  msgInput.style.height = "auto";
  msgInput.style.height = Math.min(msgInput.scrollHeight, inputMaxHeight()) + "px";
  syncInputOverflow();
});

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const PLUGINS = [
  {
    id: "web_search", label: "Busca na Web", desc: "Sugere ao modelo pesquisar na web antes de responder",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  },
  {
    id: "deep_thinking", label: "Pensamento Aprofundado", desc: "Raciocínio no esforço máximo só nesta mensagem",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2.05V17h6v-.25c0-.85.4-1.55 1-2.05A7 7 0 0 0 12 2Z"/></svg>`,
  },
  {
    id: "deep_research", label: "Pesquisa Aprofundada", desc: "Plano de pesquisa em etapas, com barra de progresso",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a2 2 0 0 1 2-2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M14 2v5h5M9 13h6M9 17h6"/></svg>`,
  },
  {
    id: "study", label: "Estudar e Aprender", desc: "Explica passo a passo e pode gerar flashcards",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.1 2.7 3 6 3s6-1.9 6-3v-5"/></svg>`,
  },
  {
    id: "agentic_loop", label: "Loop Agêntico", desc: "Executa um /Objetivo em etapas até 100%",
    enabled: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`,
  },
];

let activePlugin = null;   // id do plugin ativo pra próxima mensagem enviada
let mentionStart = -1;     // índice do "@" que abriu o pop-up atual
let mentionActiveIndex = 0;

const mentionPopup      = document.getElementById("mention-popup");
const mentionPopupInner = document.getElementById("mention-popup-inner");
const pluginPill        = document.getElementById("plugin-pill");
const pluginPillLabel   = document.getElementById("plugin-pill-label");
const pluginPillRemove  = document.getElementById("plugin-pill-remove");

// Recalcula a posição do pop-up quando a visual viewport muda com o teclado.
function viewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight;
}
function positionMentionPopup() {
  const rect = document.querySelector(".input-row").getBoundingClientRect();
  const vh = viewportHeight();
  mentionPopup.style.left   = rect.left + "px";
  mentionPopup.style.width  = rect.width + "px";
  // Clampa pra nunca ficar com bottom negativo (o que empurraria o popup
  // pra fora da área visível, atrás do teclado) - se rect.top já estiver
  // além da visual viewport (input escondido atrás do teclado), cola o
  // popup rente ao rodapé visível em vez de extrapolar.
  const bottom = Math.max(8, vh - rect.top + 8);
  mentionPopup.style.bottom = bottom + "px";
}

function renderMentionPopup() {
  mentionActiveIndex = 0;
  mentionPopupInner.replaceChildren(...PLUGINS.map((p, i) => {
    const option = document.createElement("div");
    option.className = `mention-option${p.enabled ? "" : " disabled"}${i === 0 ? " active" : ""}`;
    option.dataset.id = p.id;
    const icon = document.createElement("div");
    icon.className = "mention-option-icon";
    icon.appendChild(createPluginIcon(p.icon));
    const name = document.createElement("div");
    name.className = "mention-option-name";
    name.textContent = p.label;
    option.append(icon, name);
    if (!p.enabled) {
      const soon = document.createElement("span");
      soon.className = "mention-option-soon";
      soon.textContent = "Em breve";
      option.appendChild(soon);
    }
    return option;
  }));
  mentionPopupInner.querySelectorAll(".mention-option").forEach(el => {
    el.addEventListener("click", () => selectPlugin(el.dataset.id));
  });
}

function createPluginIcon(rawIcon) {
  const template = document.createElement("template");
  template.innerHTML = typeof DOMPurify !== "undefined"
    ? DOMPurify.sanitize(String(rawIcon ?? ""), { USE_PROFILES: { svg: true } })
    : "";
  const svg = template.content.firstElementChild;
  if (svg?.tagName?.toLowerCase() === "svg") return svg;
  const fallback = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  fallback.setAttribute("viewBox", "0 0 24 24");
  return fallback;
}

function openMentionPopup() {
  positionMentionPopup();
  renderMentionPopup();
  mentionPopup.classList.add("open");
}

function closeMentionPopup() {
  mentionPopup.classList.remove("open");
  mentionStart = -1;
}

function updatePluginPill() {
  const plugin = PLUGINS.find(p => p.id === activePlugin);
  if (!plugin) { pluginPill.classList.remove("show"); return; }
  pluginPillLabel.textContent = plugin.label;
  const oldIcon = document.getElementById("plugin-pill-icon");
  const newIcon = createPluginIcon(plugin.icon);
  newIcon.id = "plugin-pill-icon";
  oldIcon?.replaceWith(newIcon);
  pluginPill.classList.add("show");
}

function applyPluginMention(plugin) {
  const val = msgInput.value;
  let rest = val;
  for (const p of PLUGINS) {
    const pref = `@${p.label} `;
    if (rest.startsWith(pref)) { rest = rest.slice(pref.length); break; }
  }
  const mention = `@${plugin.label} `;
  msgInput.value = mention + rest;
  activePlugin = plugin.id;
  updatePluginPill();
  msgInput.dispatchEvent(new Event("input"));
  return mention.length;
}

function selectPlugin(id) {
  const plugin = PLUGINS.find(p => p.id === id);
  if (!plugin || !plugin.enabled) return;
  const val = msgInput.value;
  const cursor = msgInput.selectionStart;
  const before = val.slice(0, mentionStart);
  const after  = val.slice(cursor);
  msgInput.value = (before + after).replace(/^\s+/, "");
  const mentionLen = applyPluginMention(plugin);
  closeMentionPopup();
  msgInput.focus();
  msgInput.setSelectionRange(mentionLen, mentionLen);
}

function clearActivePlugin() {
  activePlugin = null;
  updatePluginPill();
}

const asheetPluginsRow  = document.getElementById("asheet-plugins-row");
const asheetPluginsList = document.getElementById("asheet-plugins-list");

asheetPluginsList.replaceChildren(...PLUGINS.map(p => {
  const option = document.createElement("div");
  option.className = `asheet-plugin-option${p.enabled ? "" : " disabled"}`;
  option.dataset.id = p.id;
  const icon = document.createElement("div");
  icon.className = "asheet-plugin-icon";
  icon.appendChild(createPluginIcon(p.icon));
  const info = document.createElement("div");
  info.className = "asheet-plugin-info";
  const name = document.createElement("div");
  name.className = "asheet-plugin-name";
  name.textContent = p.label;
  const desc = document.createElement("div");
  desc.className = "asheet-plugin-desc";
  desc.textContent = p.desc;
  info.append(name, desc);
  option.append(icon, info);
  if (!p.enabled) {
    const soon = document.createElement("span");
    soon.className = "asheet-plugin-soon";
    soon.textContent = "Em breve";
    option.appendChild(soon);
  }
  return option;
}));

asheetPluginsList.querySelectorAll(".asheet-plugin-option").forEach(el => {
  el.addEventListener("click", () => {
    const plugin = PLUGINS.find(p => p.id === el.dataset.id);
    if (!plugin || !plugin.enabled) return;
    applyPluginMention(plugin);
    closeAttachSheet(); // minimiza a aba de anexar, como no @
    msgInput.focus();
  });
});

asheetPluginsRow.addEventListener("click", () => {
  asheetPluginsRow.classList.toggle("open");
  asheetPluginsList.classList.toggle("open");
});

pluginPillRemove.addEventListener("click", () => {
  const plugin = PLUGINS.find(p => p.id === activePlugin);
  if (plugin && msgInput.value.startsWith(`@${plugin.label} `)) {
    msgInput.value = msgInput.value.slice(`@${plugin.label} `.length);
    msgInput.dispatchEvent(new Event("input"));
  }
  clearActivePlugin();
  msgInput.focus();
});

function detectMention() {

  if (activePlugin) {
    const plugin = PLUGINS.find(p => p.id === activePlugin);
    if (plugin && !msgInput.value.startsWith(`@${plugin.label} `)) clearActivePlugin();
  }

  const val = msgInput.value;
  const cursor = msgInput.selectionStart;
  let at = -1;
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = val[i];
    if (ch === "@") { at = i; break; }
    if (ch === " " || ch === "\n") break;
  }
  if (at === -1) { closeMentionPopup(); return; }
  mentionStart = at;
  openMentionPopup();
}

document.addEventListener("click", e => {
  if (!mentionPopup.contains(e.target) && e.target !== msgInput) closeMentionPopup();
});

msgInput.addEventListener("input", detectMention);
window.addEventListener("resize", () => { if (mentionPopup.classList.contains("open")) positionMentionPopup(); });
// Recalcula a posição do pop-up quando a visual viewport muda com o teclado.
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => { if (mentionPopup.classList.contains("open")) positionMentionPopup(); });
  window.visualViewport.addEventListener("scroll", () => { if (mentionPopup.classList.contains("open")) positionMentionPopup(); });
}

msgInput.addEventListener("keydown", e => {
  if (mentionPopup.classList.contains("open")) {
    const options = [...mentionPopupInner.querySelectorAll(".mention-option")];
    if (e.key === "Escape") { e.preventDefault(); closeMentionPopup(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      options[mentionActiveIndex]?.classList.remove("active");
      mentionActiveIndex = e.key === "ArrowDown"
        ? (mentionActiveIndex + 1) % options.length
        : (mentionActiveIndex - 1 + options.length) % options.length;
      options[mentionActiveIndex]?.classList.add("active");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation(); // não deixa o listener de "enviar" abaixo disparar send()
      const el = options[mentionActiveIndex];
      if (el) selectPlugin(el.dataset.id);
      return;
    }
  }
});

msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !isMobile) {
    e.preventDefault(); if (!sendBtn.disabled) send();
  }
});

(function() {
  var msgInput = document.getElementById('msg-input');

  // Placeholder changes after the first message.
  var placeholderChanged = false;
  var observer = new MutationObserver(function(mutations) {
    // Clearing a chat can leave the old scrollTop behind. Keep the empty
    // state pinned to the top so reopening/starting a chat cannot animate the
    // header or reveal a phantom scroll range.
    if (!messagesEl.querySelector('.msg-row')) {
      messagesEl.scrollTop = 0;
      autoScroll = true;
      updateScrollBtn();
    }
    if (placeholderChanged) return;
    for (var m of mutations) {
      for (var node of m.addedNodes) {
        if (node.nodeType === 1 && node.classList && node.classList.contains('msg-row')) {
          if (node.classList.contains('user')) {
            msgInput.placeholder = 'Continue explorando o infinito...';
            placeholderChanged = true;
            return;
          }
        }
      }
    }
  });
  var messagesEl = document.getElementById('messages');
  if (messagesEl) observer.observe(messagesEl, { childList: true, subtree: true });

  // Adds the share button to message actions.
  var shareObs = new MutationObserver(function(mutations) {
    for (var m of mutations) {
      for (var node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        var actions = node.classList && node.classList.contains('msg-actions')
          ? [node]
          : Array.from(node.querySelectorAll ? node.querySelectorAll('.msg-actions') : []);
        actions.forEach(function(actionsEl) {
          if (actionsEl.querySelector('.share-btn')) return;
          var btn = document.createElement('button');
          btn.className = 'msg-action-btn share-btn';
          btn.title = 'Compartilhar';
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
          btn.addEventListener('click', function() {});
          actionsEl.appendChild(btn);
        });
      }
    }
  });
  if (messagesEl) shareObs.observe(messagesEl, { childList: true, subtree: true });
})();
