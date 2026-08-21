// Boreas frontend module: normal message sending and incremental SSE rendering.
// Loaded as a classic script in the exact order declared by index.html.

async function send() {
  autoScroll = true; updateScrollBtn();
  const text = msgInput.value.trim();
  if ((!text && !pendingImages.length && !pendingFile) || loading) return;

  if (activePlugin === "agentic_loop" && !/(^|\n)\s*\/(Goal|Objetivo)\s*:/i.test(text)) {
    alert("Pra usar o Loop Agêntico, especifique o objetivo com /Objetivo: (ou /Goal:) na mensagem.");
    return;
  }

  const pluginSnapshot = activePlugin; // plugin (se houver) vale só pra esta mensagem
  clearActivePlugin();
  closeMentionPopup();

  loading = true; showStopBtn();
  msgInput.value = ""; msgInput.style.height = "auto"; msgInput.style.overflowY = "hidden";
  if (_shrinkTimer) { clearTimeout(_shrinkTimer); _shrinkTimer = null; }
  applyInputShape(false); // reset instantâneo - aqui não tem oscilação pra confirmar, o campo acabou de ser limpo

  const imagesSnapshot = pendingImages.slice();
  const fileSnapshot    = pendingFile;
  let userContent;

  if (imagesSnapshot.length) {
    userContent = [
      ...imagesSnapshot.map(src => ({ type: "image_url", image_url: { url: src } })),
      ...(fileSnapshot ? [{ type: "text", text: `[Arquivo: ${fileSnapshot.name}]\n\`\`\`\n${fileSnapshot.content}\n\`\`\`` }] : []),
      ...(text ? [{ type: "text", text }] : [])
    ];
  } else if (fileSnapshot) {
    const fileBlock = `[Arquivo: ${fileSnapshot.name}]\n\`\`\`\n${fileSnapshot.content}\n\`\`\``;
    userContent = text ? `${fileBlock}\n\n${text}` : fileBlock;
  } else {
    userContent = text;
  }

  const isFirstMessage = messages.length === 0;
  const activeChatId   = localStorage.getItem(ACTIVE_KEY);

  if (isFirstMessage) {
    chatHasMessages = true;
    updateMemoryBtns();

    if (_chatsMeta[activeChatId]) {
      _chatsMeta[activeChatId].memoryEnabled = chatMemoryEnabled;
    }
  }

  const userMsgIndex = messages.length;
  messages.push({ role: "user", content: userContent });
  saveCurrentMessages();

  // Mantém o conteúdo visível do anexo no mesmo caminho de renderização da
  // mensagem. Antes, quando havia arquivo de texto, displayContent virava
  // string vazia e o modelo recebia o arquivo, mas a bolha do usuário não.
  const displayContent = imagesSnapshot.length
    ? (text || "")
    : (fileSnapshot ? userContent : (typeof userContent === "string" ? userContent : text));
  appendMessage("user", displayContent, imagesSnapshot, userMsgIndex);

  if (isFirstMessage && (text || fileSnapshot) && activeChatId) generateTitle(activeChatId, text || fileSnapshot.name);

  pendingImages = []; pendingFile = null;
  renderPreviewThumbs();
  previewWrap.querySelector("#file-name-label")?.remove();
  showTyping();

  let thinkingTimer = setTimeout(() => {
    const tr = document.getElementById("typing-row");
    if (tr) {
      const b = tr.querySelector(".bubble");
      if (b) b.innerHTML = `<span style="color:rgba(120,180,220,0.4);font-size:12px;letter-spacing:0.08em">Em trabalho</span><span style="display:inline-flex;gap:3px;margin-left:6px;vertical-align:middle"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
    }
  }, 1000);

  currentAbortController = new AbortController();
  const _sendStartTime = Date.now();
  let _fetchTimedOut = false;

  const _fetchTimeout = setTimeout(() => {
    _fetchTimedOut = true;
    try { currentAbortController.abort(); } catch {}
  }, 90000);

  const stopElapsedTicker = startElapsedTicker(
    () => document.getElementById("typing-row")?.querySelector(".bubble"),
    _sendStartTime
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
      headers: { "Content-Type": "application/json", "x-session-id": localStorage.getItem("boreas_session_id") ?? "" },
      body: JSON.stringify({ tier: currentTier, speed: currentSpeed, effort: currentEffort, messages, chatId: localStorage.getItem(ACTIVE_KEY), name: localStorage.getItem("boreas_name") ?? "", use: localStorage.getItem("boreas_use") ?? "", chatMemoryEnabled, plugin: pluginSnapshot }),
    });
    clearTimeout(_fetchTimeout);

    if (res.status === 429) {
      removeTyping();
      if (isFirstMessage && activeChatId) {
        delete _chatsMeta[activeChatId];
        BoreasSync.chats.remove(activeChatId).catch(() => {});
        renderSidebar();
      }
      loading = false; hideStopBtn(); return;
    }
    if (!res.ok) { throw new Error(`HTTP ${res.status}`); }

    const reader = res.body.getReader(); const decoder = new TextDecoder();
    let reply = "", reasoning = "", buffer = "";
    let msgAttachments = [];
    const activity = {};
    let stepsCount = 0;
  let hasUsedTool = false; const extraThinkState = {};
    let responseBubble = null; let currentBubbleText = ""; // Guarda o texto apenas da bolha atual, separado do reply total salvo no histórico.
    let pendingSources = null;

    const BRAIN_ICON = BOREAS_BRAIN_ICON;
    const CHEVRON = `<svg class="pill-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    const DOTS = `<span style="display:inline-flex;gap:3px;margin-left:2px"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
    const BOT_IMG = `<img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" style="width:42px;height:42px;object-fit:contain;opacity:0.95" loading="lazy" decoding="async" draggable="false">`;

    function ensureMasterRow() {
      if (!masterRow) {
        removeTyping();
        masterRow = document.createElement("div"); masterRow.className = "msg-row bot"; masterRow._msgIndex = messages.length;
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
      const lines = buffer.split("\n"); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim(); if (raw === "[DONE]") break;

        let chunk;
        try { chunk = JSON.parse(raw); } catch { continue; }

          if (chunk.type === "gen_id") {
            currentGenId = chunk.id;
            if (masterRow) masterRow.dataset.generationId = String(chunk.id);
            savePendingGen(chunk.id, localStorage.getItem(ACTIVE_KEY));
            stopNoResponseWatchdog();
            continue;
          }

          if (chunk.type === "heartbeat") { continue; } // keep-alive só - o "Ns" agora ticka local (startElapsedTicker)

          if (chunk.type === "file" && chunk.name) {
            clearTimeout(thinkingTimer);
            ensureMasterRow();
            masterCol.appendChild(createFileCard(chunk.name, chunk.data, chunk.mime));
            msgAttachments.push({ type: "file", name: chunk.name, data: chunk.data, mime: chunk.mime });
            scrollToBottom();
            continue;
          }

          if (chunk.type === "deep_research") {
            clearTimeout(thinkingTimer);
            ensureMasterRow();
            renderDeepResearchCard(masterCol, chunk);
            if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "deep_research"), { ...chunk }];
            continue;
          }

          if (chunk.type === "agentic_loop") {
            clearTimeout(thinkingTimer);
            ensureMasterRow();
            renderAgenticLoopCard(masterCol, chunk);
            if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "agentic_loop"), { ...chunk }];
            continue;
          }

          if (chunk.type === "ask_user_prompt") {
            clearTimeout(thinkingTimer);
            ensureMasterRow();
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
            closeThinkingSegment(activity);
            clearTimeout(thinkingTimer);
            ensureMasterRow();
            masterCol.querySelectorAll(".msg-actions").forEach(el => el.remove());
            responseBubble = null; currentBubbleText = "";
            ensureThinkingSegment(activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
            ensureToolActivityCard(masterCol, chunk, activity);
            scrollToBottom();
            continue;
            // Fecha a bolha atual quando uma nova tool call chega, para separar trechos de texto em bolhas diferentes.
            if (responseBubble && currentBubbleText && chunk.id && !activity.detail?._byId?.[chunk.id]) {
              responseBubble = null; currentBubbleText = "";
            }

            ensureThinkingSegment(activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
            const stepsDetail = activity.detail;
            const TOOL_META = { WEB_SEARCH: { icon: "🔍" }, WEB_FETCH: { icon: "🌐" }, BASH: { icon: "💻" }, DELETE: { icon: "🗑️" }, STR_REPLACE: { icon: "✏️" }, SEND_FILE: { icon: "📎" }, CREATE_FILE: { icon: "??" }, MEMORY: { icon: "🧠" }, PREFERENCES: { icon: "⚙️" }, ASK_USER: { icon: "❓" }, CALCULATOR: { icon: "🧮" }, GRAPH: { icon: "📊" }, FORWARD_MESSAGE: { icon: "🚀" }, USE_PLUGIN: { icon: "🧩" }, IMAGE_SEARCH: { icon: "🔍" }, PRESENT_IMAGE: { icon: "🖼️" }, VIEW_CHATS: { icon: "🗂️" }, CURRENCY: { icon: "💱" } };
            const meta = TOOL_META[chunk.tool] ?? { icon: "🔧" };
            const rawHasOutput2 = chunk.output !== undefined && chunk.output !== "";
            const hasOutput = rawHasOutput2 && !isBadgeOnlyTool(chunk.tool);
            if (!stepsDetail._byId) stepsDetail._byId = {};

            if (chunk.id && stepsDetail._byId[chunk.id]) {
              const ex = stepsDetail._byId[chunk.id];
              ex.lSpan.textContent = taskItemLabel(chunk.tool, chunk.value, rawHasOutput2);
              if (hasOutput) {
                ex.iSpan.textContent = meta.icon;
                ex.hdr.classList.add("expandable");
                if (!ex.hdr.querySelector(".task-item-chevron")) {
                  const chev = document.createElement("span"); chev.className = "task-item-chevron";
                  chev.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
                  ex.hdr.appendChild(chev);
                }
                let body = ex.taskEl.querySelector(".task-item-body");
                if (!body) {
                  body = document.createElement("div"); body.className = "task-item-body";
                  renderStepBody(body, chunk.tool, chunk.value, chunk.output);
                  ex.taskEl.appendChild(body);
                  ex.hdr.addEventListener("click", () => ex.taskEl.classList.toggle("expanded"));
                } else {
                  renderStepBody(body, chunk.tool, chunk.value, chunk.output);
                }
                showInlineToolResult(masterCol, chunk.id, chunk.tool, chunk.output, responseBubble, chunk.value);
              }
              scrollToBottom();
              continue;
            }

            stepsCount++;
            const taskEl = document.createElement("div"); taskEl.className = "task-item";
            const hdr = document.createElement("div");
            hdr.className = "task-item-header" + (hasOutput ? " expandable" : "");
            const iSpan = document.createElement("span"); iSpan.className = "task-item-icon";
            iSpan.innerHTML = hasOutput ? meta.icon : `<span class="thinking-dot" style="background:currentColor"></span>`;
            const lSpan = document.createElement("span"); lSpan.className = "task-item-label"; lSpan.textContent = taskItemLabel(chunk.tool, chunk.value, rawHasOutput2);
            hdr.appendChild(iSpan); hdr.appendChild(lSpan);
            if (hasOutput) {
              const chev = document.createElement("span"); chev.className = "task-item-chevron";
              chev.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
              hdr.appendChild(chev);
              const body = document.createElement("div"); body.className = "task-item-body";
              renderStepBody(body, chunk.tool, chunk.value, chunk.output);
              taskEl.appendChild(hdr); taskEl.appendChild(body);
              hdr.addEventListener("click", () => taskEl.classList.toggle("expanded"));
              showInlineToolResult(masterCol, chunk.id, chunk.tool, chunk.output, responseBubble, chunk.value);
            } else { taskEl.appendChild(hdr); }
            // Direto no fim da timeline - sem agrupar por tipo de tool.
            stepsDetail.appendChild(taskEl);
            if (chunk.id) stepsDetail._byId[chunk.id] = { taskEl, hdr, lSpan, iSpan };
            scrollToBottom();
            continue;
          }

          if (chunk.type === "image") {
            clearTimeout(thinkingTimer);
            ensureMasterRow();
            removeTyping();
            const loadingCard = masterCol.querySelector("#img-gen-loading");
            if (loadingCard) loadingCard.remove();
            const wrap = document.createElement("div"); wrap.className = "img-result-wrap";
            const card = document.createElement("div"); card.className = "img-result-card";
            const img  = document.createElement("img");
            img.src = `data:image/jpeg;base64,${chunk.data}`;
            img.alt = chunk.prompt ?? "Imagem gerada";
            img.addEventListener("click", () => { window.open(img.src, "_blank"); });
            card.appendChild(img);
            const actRow = document.createElement("div"); actRow.className = "img-result-actions";
            const dlBtn  = document.createElement("button"); dlBtn.className = "img-dl-btn";
            dlBtn.textContent = "⬇ Baixar";
            dlBtn.addEventListener("click", () => { const a = document.createElement("a"); a.href = img.src; a.download = "boreas-image.jpg"; a.click(); });
            actRow.appendChild(dlBtn);
            wrap.appendChild(card); wrap.appendChild(actRow);
            masterCol.appendChild(wrap);
            scrollToBottom();
            reply = "[Imagem gerada]";
            continue;
          }

          if (chunk.type === "error") {
            clearTimeout(thinkingTimer); removeTyping(); ensureMasterRow();
            const eb = document.createElement("div"); eb.className = "bubble bot";
            eb.textContent = `Erro: ${chunk.message}`;
            masterCol.appendChild(eb); continue;
          }

          if (chunk.type === "sources" && chunk.results?.length) {
            pendingSources = chunk.results;
            continue;
          }

          const delta = chunk.choices?.[0]?.delta ?? {};
          const reasoningDelta = delta.reasoning_content ?? "", contentDelta = delta.content ?? "";

          if (reasoningDelta) {
            reasoning += reasoningDelta;
            ensureMasterRow();
            ensureThinkingSegment(activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
            appendThinkingSegment(activity, reasoningDelta);
            scrollToBottom();
          }

          if (contentDelta) {
            if (!responseBubble) {
              removeTyping();
              ensureMasterRow();

              responseBubble = document.createElement("div"); responseBubble.className = "bubble bot";
              const thisBubble = responseBubble; // Captura a bolha atual antes de ela mudar depois de uma tool call.
              masterCol.appendChild(responseBubble);
              const actions = document.createElement("div"); actions.className = "msg-actions";
              const copyBtn = document.createElement("button"); copyBtn.className = "msg-action-btn";
              copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar`;
              // Usa _rawText para copiar o texto real da bolha sem ler o DOM completo.
              copyBtn.addEventListener("click", () => copyText(thisBubble._rawText ?? "", copyBtn));
              const regenBtn = document.createElement("button"); regenBtn.className = "msg-action-btn msg-regenerate-btn";
              regenBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.27"/></svg> Tentar novamente`;
              regenBtn.addEventListener("click", () => regenerate(masterRow, thisBubble, actions));
              actions.appendChild(copyBtn); actions.appendChild(regenBtn);

              if (pendingSources?.length) actions.appendChild(createSourcesButton(pendingSources));
              masterCol.appendChild(actions);
            }
            reply += contentDelta; currentBubbleText += contentDelta; scheduleMarkdownRender(responseBubble, currentBubbleText);
            responseBubble._rawText = currentBubbleText;
            scrollToBottom();
            await new Promise(r => setTimeout(r, 0));
          }

      }
    }

    if (buffer.startsWith("data: ")) {
      const raw2 = buffer.slice(6).trim();
      if (raw2 && raw2 !== "[DONE]") {
        try {
          const chunk2 = JSON.parse(raw2);
          const cd2 = chunk2.choices?.[0]?.delta?.content ?? "";
          if (cd2) {
            reply += cd2;
            currentBubbleText += cd2;
            if (responseBubble) scheduleMarkdownRender(responseBubble, currentBubbleText);
          }
        } catch {}
      }
    }
    if (responseBubble) renderMarkdown(responseBubble, currentBubbleText);
    finalizeThinkingSegment(activity);

    removeTyping();

    if (!responseBubble && reply) {
      ensureMasterRow();
      responseBubble = document.createElement("div"); responseBubble.className = "bubble bot";
      renderMarkdown(responseBubble, reply);
      masterCol.appendChild(responseBubble);
      const actions2 = document.createElement("div"); actions2.className = "msg-actions";
      const copyBtn2 = document.createElement("button"); copyBtn2.className = "msg-action-btn";
      copyBtn2.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar`;
      copyBtn2.addEventListener("click", () => copyText(reply, copyBtn2));
      const regenBtn2 = document.createElement("button"); regenBtn2.className = "msg-action-btn msg-regenerate-btn";
      regenBtn2.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.27"/></svg> Tentar novamente`;
      regenBtn2.addEventListener("click", () => regenerate(masterRow, responseBubble, actions2));
      actions2.appendChild(copyBtn2); actions2.appendChild(regenBtn2); masterCol.appendChild(actions2);
    } else if (!responseBubble && !reply) {
      appendMessage("bot", "Sem resposta.");
    }

    messages.push({ role: "assistant", content: reply, ...(msgAttachments.length ? { attachments: msgAttachments } : {}) });
    saveCurrentMessages();
    updateRegenerateAvailability();
    if (responseBubble && !responseBubble._rawText) responseBubble._rawText = reply;
    clearPendingGen(); currentGenId = null;
    stopElapsedTicker();

  } catch (e) {
    clearTimeout(thinkingTimer); clearTimeout(_fetchTimeout); stopNoResponseWatchdog(); stopElapsedTicker(); removeTyping();

    if (noGenIdTimedOut) {

      if (masterRow) masterRow.remove();
      showNoResponseError(() => resumePending(pluginSnapshot));
    } else if (e.name === "AbortError" && userStoppedGeneration) {

    } else if (currentGenId) {

      showSyncBanner(currentGenId);
    } else if (e.name !== "AbortError") {

      if (masterRow) masterRow.remove();
      appendMessage("bot", `Erro: ${e.message}`);
    }

  } finally {
    loading = false;
    hideStopBtn();
    userStoppedGeneration = false;
  }
}

