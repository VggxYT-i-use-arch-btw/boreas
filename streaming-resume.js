// Boreas frontend module: resume flow, initialization, and pending generation recovery.
// Loaded as a classic script in the exact order declared by index.html.

const thinkingSheet   = document.getElementById("thinking-sheet");
const sheetBody       = document.getElementById("sheet-body");
const sheetClose      = document.getElementById("sheet-close");
const sheetHandle     = document.getElementById("sheet-handle");
const sheetBackdrop   = document.getElementById("sheet-backdrop");
const sheetExpandHint = document.getElementById("sheet-expand-hint");

function openSheet(text) {
  sheetBody.textContent = text;
  thinkingSheet.classList.remove("full"); thinkingSheet.classList.add("open");
  sheetBackdrop.classList.add("open"); sheetExpandHint.style.display = "";
}
function closeSheet() {
  thinkingSheet.classList.remove("open","full"); sheetBackdrop.classList.remove("open");
}

sheetClose.addEventListener("click", closeSheet);
sheetBackdrop.addEventListener("click", closeSheet);
sheetHandle.addEventListener("click", () => {
  if (thinkingSheet.classList.contains("full")) {
    thinkingSheet.classList.remove("full"); sheetExpandHint.style.display = "";
  } else {
    thinkingSheet.classList.add("full"); sheetExpandHint.style.display = "none";
  }
});
sheetExpandHint.addEventListener("click", () => {
  thinkingSheet.classList.add("full"); sheetExpandHint.style.display = "none";
});

function handleThinkingClick(pill, inlineEl) {
  const text = inlineEl.textContent;
  if (isMobile) {
    if (thinkingSheet.classList.contains("open") && sheetBody.textContent === text) {
      closeSheet(); pill.classList.remove("expanded");
    } else {
      openSheet(text); pill.classList.add("expanded");
    }
  } else {
    const isOpen = inlineEl.classList.contains("visible");
    inlineEl.classList.toggle("visible", !isOpen); pill.classList.toggle("expanded", !isOpen);
  }
}

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 6  && h < 12) return "Como posso te ajudar esta manhã?";
  if (h >= 12 && h < 18) return "Como posso te ajudar esta tarde?";
  if (h >= 18 && h < 24) return "Como posso te ajudar esta noite?";
  return "Como posso te ajudar nessa madrugada?";
}
function setGreeting() {
  const el = document.querySelector(".empty-text"); if (!el) return;
  const name = localStorage.getItem("boreas_name");
  const base = getGreeting();
  el.textContent = name ? base.replace("?", `, ${name}?`) : base;
}

async function resumePending(pluginOverride) {
  if (globalThis.BoreasSessionContextStale) return;
  if (loading || !messages.length || messages[messages.length - 1].role !== "user") return;
  const streamMessages = messages;
  const streamChatId = localStorage.getItem(ACTIVE_KEY);

  document.getElementById("resume-banner")?.remove();
  showTyping();
  loading = true; showStopBtn();

  let thinkingTimer = setTimeout(() => {
    const tr = document.getElementById("typing-row");
    if (tr) {
      const b = tr.querySelector(".bubble");
      if (b) b.innerHTML = `<span style="color:rgba(120,180,220,0.4);font-size:12px;letter-spacing:0.08em">Em trabalho</span><span style="display:inline-flex;gap:3px;margin-left:6px;vertical-align:middle"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
    }
  }, 1000);

  currentAbortController = new AbortController();
  const _resumeStartTime = Date.now();
  let _resumeTimedOut = false;
  const _resumeTimeout = setTimeout(() => {
    _resumeTimedOut = true;
    try { currentAbortController.abort(); } catch {}
  }, 90000);

  const stopElapsedTicker = startElapsedTicker(
    () => document.getElementById("typing-row")?.querySelector(".bubble"),
    _resumeStartTime
  );

  let noGenIdTimedOut = false;
  const stopNoResponseWatchdog = startNoResponseWatchdog(
    () => document.getElementById("typing-row")?.querySelector(".bubble"),
    () => { noGenIdTimedOut = true; try { currentAbortController.abort(); } catch {} }
  );

  let masterRow = null, masterCol = null;

  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      signal: currentAbortController.signal,
      headers: BoreasSessionHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({ tier: currentTier, speed: currentSpeed, effort: currentEffort, messages: streamMessages, chatId: streamChatId, name: localStorage.getItem("boreas_name") ?? "", use: localStorage.getItem("boreas_use") ?? "", chatMemoryEnabled, plugin: pluginOverride }), // Envia chatId, nome e uso para o servidor salvar a conversa e personalizar o contexto.
    });
    clearTimeout(thinkingTimer); clearTimeout(_resumeTimeout);
    if (!res.ok) { throw await boreasHttpError(res); }

    const reader = res.body.getReader(); const decoder = new TextDecoder();
    let reply = "", reasoning = "", buffer = "";
    let msgAttachments = [];
    let attachmentBase64Bytes = 0;
    const MAX_SSE_BUFFER = 8 * 1024 * 1024;
    const MAX_ATTACHMENT_BASE64 = 24 * 1024 * 1024;
    const MAX_RESPONSE_CHARS = 8 * 1024 * 1024;
    let pendingSourcesR = null;
    let streamFailed = false;
    let streamFailureMessage = "";
    const activity = {};
    let stepsCount = 0;
  let hasUsedTool = false; const extraThinkState = {};
    let responseBubble = null, responseActions = null;

    const BRAIN_ICON = BOREAS_BRAIN_ICON;
    const CHEVRON = `<svg class="pill-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    const DOTS = `<span style="display:inline-flex;gap:3px;margin-left:2px"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
    const BOT_IMG = `<img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" style="width:42px;height:42px;object-fit:contain;opacity:0.95" loading="lazy" decoding="async" draggable="false">`;

    function ensureMasterRowR() {
      if (!masterRow) {
        removeTyping();
        masterRow = document.createElement("div"); masterRow.className = "msg-row bot";
        if (currentGenId) masterRow.dataset.generationId = String(currentGenId);
        const avatar = document.createElement("div"); avatar.className = "avatar";
        avatar.innerHTML = BOT_IMG;
        masterCol = document.createElement("div"); masterCol.className = "bot-col"; masterCol.style.gap = "4px";
        masterRow.appendChild(avatar); masterRow.appendChild(masterCol);
        messagesEl.appendChild(masterRow);
      }
    }

    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_SSE_BUFFER) throw new Error("stream SSE grande demais");
      const lines = buffer.split("\n"); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim(); if (raw === "[DONE]") break;
        try {
          const chunk = JSON.parse(raw);
          if (chunk.type === "gen_id") {

            currentGenId = chunk.id;
            if (masterRow) masterRow.dataset.generationId = String(chunk.id);
            savePendingGen(chunk.id, localStorage.getItem(ACTIVE_KEY));
            stopNoResponseWatchdog();
            continue;
          }
          if (chunk.type === "file" && chunk.name) {
            if (typeof chunk.data !== "string" || chunk.data.length > MAX_ATTACHMENT_BASE64 ||
                (attachmentBase64Bytes += chunk.data.length) > MAX_ATTACHMENT_BASE64 * 2) {
              throw new Error("anexo recebido excede o limite de segurança");
            }
            clearTimeout(thinkingTimer);
            ensureMasterRowR();
            masterCol.appendChild(createFileCard(chunk.name, chunk.data, chunk.mime));
            msgAttachments.push({ type: "file", name: chunk.name, data: chunk.data, mime: chunk.mime });
            scrollToBottom();
            continue;
          }
          if (chunk.type === "deep_research") {
            clearTimeout(thinkingTimer);
            ensureMasterRowR();
            renderDeepResearchCard(masterCol, chunk);
            if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "deep_research"), { ...chunk }];
            continue;
          }
          if (chunk.type === "agentic_loop") {
            clearTimeout(thinkingTimer);
            ensureMasterRowR();
            renderAgenticLoopCard(masterCol, chunk);
            if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "agentic_loop"), { ...chunk }];
            continue;
          }
          if (chunk.type === "ask_user_prompt") {
            clearTimeout(thinkingTimer);
            ensureMasterRowR();
            const _aupAns = await renderAskUserPromptCard(masterCol, chunk.promptId, chunk.questions);
            msgAttachments.push({ type: "ask_user_prompt", promptId: chunk.promptId, questions: chunk.questions, answers: _aupAns ?? null, timedOut: !_aupAns });
            continue;
          }
          if (chunk.type === "token_exhausted") {
            console.warn(`⚠️ Token HF esgotado no servidor - ${chunk.remaining}/${chunk.total} restantes.`);
            continue;
          }
          if (chunk.type === "step") {
            hasUsedTool = true; closeExtraThink(extraThinkState);
            clearTimeout(thinkingTimer);
            ensureMasterRowR();
            masterCol.querySelectorAll(".msg-actions").forEach(el => el.remove());
            responseBubble = null;
            ensureToolActivityCard(masterCol, chunk, activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
            if (chunk.output !== undefined && chunk.output !== "") {
              showInlineToolResult(masterCol, chunk.id, chunk.tool, chunk.output, responseBubble, chunk.value);
            }
            stepsCount++;
            scrollToBottom(); continue;
          }

          if (chunk.type === "error") {
            streamFailed = true;
            streamFailureMessage = String(chunk.message || "Falha na geração.");
            clearTimeout(thinkingTimer); removeTyping(); ensureMasterRowR();
            const eb = document.createElement("div"); eb.className = "bubble bot";
            eb.textContent = `Erro: ${streamFailureMessage}`;
            masterCol.appendChild(eb); continue;
          }

          if (chunk.type === "sources" && chunk.results?.length) {
            pendingSourcesR = chunk.results;
            if (responseActions && responseActions.isConnected && !responseActions.querySelector(".sources-btn-wrap")) {
              responseActions.appendChild(createSourcesButton(pendingSourcesR));
            }
            continue;
          }

          const delta = chunk.choices?.[0]?.delta ?? {};
          const rd = delta.reasoning_content ?? "", cd = delta.content ?? "";
          if (rd) {
            if (reasoning.length + String(rd).length > MAX_RESPONSE_CHARS) throw new Error("Resposta SSE grande demais");
            reasoning += rd; ensureMasterRowR();
            ensureThinkingSegment(activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
            appendThinkingSegment(activity, rd);
            scrollToBottom();
          }
          if (cd) {
            if (reply.length + String(cd).length > MAX_RESPONSE_CHARS) throw new Error("Resposta SSE grande demais");
            if (!responseBubble) {
              removeTyping(); ensureMasterRowR();
              responseBubble = document.createElement("div"); responseBubble.className = "bubble bot";
              masterCol.appendChild(responseBubble);
              const actions = document.createElement("div"); actions.className = "msg-actions";
              responseActions = actions;
              const copyBtn = document.createElement("button"); copyBtn.className = "msg-action-btn";
              copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar`;
              // Usa _rawText para copiar o texto real da bolha sem ler o DOM completo.
              copyBtn.addEventListener("click", () => copyText(responseBubble._rawText ?? "", copyBtn));
              const regenBtn = document.createElement("button"); regenBtn.className = "msg-action-btn msg-regenerate-btn";
              regenBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.27"/></svg> Tentar novamente`;
              regenBtn.addEventListener("click", () => regenerate(masterRow, responseBubble, actions));
              actions.appendChild(copyBtn); actions.appendChild(regenBtn);
              if (pendingSourcesR?.length) actions.appendChild(createSourcesButton(pendingSourcesR));
              masterCol.appendChild(actions);
            }
            reply += cd; scheduleMarkdownRender(responseBubble, reply);
            scrollToBottom();
            await new Promise(r => setTimeout(r, 0));
          }
        } catch (parseErr) { /* SSE inválida; ignorar. */ }
      }
    }

    if (responseBubble) renderMarkdown(responseBubble, reply);
    finalizeThinkingSegment(activity);
    removeTyping();
    if (streamFailed) {
      clearPendingGen();
      currentGenId = null;
      return;
    }
    if (!responseBubble && !reply && !reasoning) appendMessage("bot", "Sem resposta.");
    if (messages !== streamMessages || localStorage.getItem(ACTIVE_KEY) !== streamChatId) return;
    messages.push({ role: "assistant", content: reply, ...(msgAttachments.length ? { attachments: msgAttachments } : {}) });
    saveCurrentMessages();
    updateRegenerateAvailability();
    if (responseBubble) responseBubble._rawText = reply;
    stopElapsedTicker();

  } catch (e) {
    if (messages !== streamMessages || localStorage.getItem(ACTIVE_KEY) !== streamChatId) return;
    clearTimeout(thinkingTimer); clearTimeout(_resumeTimeout); stopNoResponseWatchdog(); stopElapsedTicker(); removeTyping();
    if (e?.name === "AbortError" && userStoppedGeneration) {
      // Stop requested by the user or by a failed prompt-response request.
    } else if (noGenIdTimedOut) {
      if (masterRow) masterRow.remove();
      showNoResponseError(() => resumePending(pluginOverride));
    } else if (currentGenId) {
      showSyncBanner(currentGenId);
    } else if (e.name === "AbortError" && _resumeTimedOut) {
      appendMessage("bot", "⏱ Sem resposta do servidor. Verifique sua conexão e tente novamente.");
    } else if (e.name !== "AbortError") {
      appendMessage("bot", `Erro: ${e.message}`);
    }
  } finally {
    loading = false; hideStopBtn();
  }
}

(async function initChats() {

  let syncDone = false;
  const syncPromise = syncChatsFromServer().then(() => { syncDone = true; });
  try { await Promise.race([syncPromise, new Promise(r => setTimeout(r, 8000))]); } catch {}
  renderSidebar();

  if (!syncDone) {
    syncPromise.then(() => {
      renderSidebar();

      const currentId = localStorage.getItem(ACTIVE_KEY);
      const currentMeta = _chatsMeta[currentId];
      const allNow = Object.values(_chatsMeta).filter(c => c.hasMessages).sort((a, b) =>
        (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? 1 : -1
      );
      if (allNow.length > 0 && currentMeta && !currentMeta.hasMessages && messages.length === 0) {
        loadChat(allNow[0].id);
      }
    }).catch(() => {});
  }

  // Ao abrir o app, só retoma um chat salvo quando existe uma geração pendente; caso contrário, começa um chat novo.
  const pendingBoot = getPendingGen();
  // O índice remoto pode chegar depois do primeiro paint; o chat pendente é
  // uma chave persistida independente do timing da sidebar.
  const shouldResumePendingChat = pendingBoot?.genId && pendingBoot.chatId;

  if (shouldResumePendingChat) {
    await loadChat(pendingBoot.chatId);
  } else {
    const newId = await createChat(currentTier, currentSpeed);
    await loadChat(newId, { skipRemote: true });
  }

  const pending = getPendingGen();
  // Mostra o banner de sincronização quando existe uma geração pendente que ainda pode ser retomada.
  if (pending?.genId && pending.chatId === localStorage.getItem(ACTIVE_KEY)) {
    showSyncBanner(pending.genId);
    setTimeout(() => {
      const current = getPendingGen();
      if (current?.genId === pending.genId && navigator.onLine !== false) syncGeneration(pending.genId);
    }, 120);
  }
})();

function resumePendingGenerationIfNeeded() {
  const pending = getPendingGen();
  if (!pending?.genId || pending.chatId !== localStorage.getItem(ACTIVE_KEY)) return;
  if (loading || syncInFlight || navigator.onLine === false) return;
  syncGeneration(pending.genId);
}

window.addEventListener("online", resumePendingGenerationIfNeeded);
window.addEventListener("pageshow", resumePendingGenerationIfNeeded);
window.addEventListener("focus", resumePendingGenerationIfNeeded);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resumePendingGenerationIfNeeded();
});

setGreeting();
updateSidebarUser();
