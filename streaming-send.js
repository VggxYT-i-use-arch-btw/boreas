// Boreas frontend module: normal message sending and incremental SSE rendering.
// Loaded as a classic script in the exact order declared by index.html.

async function send() {
  if (globalThis.BoreasSessionContextStale) return;
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
  // Switching conversations mid-stream replaces the global array. Keeps
  // this reference so a late response is never saved into the new chat.
  const streamMessages = messages;
  const streamChatId = activeChatId;

  // Rendered optimistically, before the network round-trip below - the
  // user's own message should never wait on a server response to appear
  // in the chat (was the ~200ms+ visible delay, worse on slow connections).
  const fileBlockForDisplay = fileSnapshot
    ? `[Arquivo: ${fileSnapshot.name}]\n\`\`\`\n${fileSnapshot.content}\n\`\`\``
    : null;
  const displayContent = imagesSnapshot.length
    ? (fileBlockForDisplay ? `${fileBlockForDisplay}${text ? `\n\n${text}` : ""}` : (text || ""))
    : (fileSnapshot ? userContent : (typeof userContent === "string" ? userContent : text));
  appendMessage("user", displayContent, imagesSnapshot, userMsgIndex);

  pendingImages = []; pendingFile = null;
  renderPreviewThumbs();
  previewWrap.querySelector("#file-name-label")?.remove();
  showTyping();

  // Awaited (with keepalive) before the generation stream opens: the server
  // only learns about this message through this save, so it must land
  // before the request can be interrupted by a background/reload. This no
  // longer blocks the message bubble above, which is already on screen.
  await saveCurrentMessages({ keepalive: true });

  if (isFirstMessage && activeChatId) {
    const titleSeed = text || fileSnapshot?.name || (imagesSnapshot.length ? "Imagem enviada" : "");
    if (titleSeed) generateTitle(activeChatId, titleSeed);
  }

  let thinkingTimer = setTimeout(() => {
    const tr = document.getElementById("typing-row");
    if (tr) {
      const b = tr.querySelector(".bubble");
      if (b) b.innerHTML = `<span class="work-status-label">Em trabalho</span><span style="display:inline-flex;gap:3px;margin-left:6px;vertical-align:middle"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
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
      headers: BoreasSessionHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({ tier: currentTier, speed: currentSpeed, effort: currentEffort, messages: streamMessages, chatId: streamChatId, name: localStorage.getItem("boreas_name") ?? "", use: localStorage.getItem("boreas_use") ?? "", chatMemoryEnabled, plugin: pluginSnapshot }),
    });
    clearTimeout(_fetchTimeout);

    if (res.status === 429) {
      removeTyping();
      appendMessage("bot", "Muitas solicitações ao mesmo tempo. Aguarde alguns segundos e tente novamente.");
      loading = false; hideStopBtn(); return;
    }
    if (!res.ok) { throw await boreasHttpError(res); }

    const reader = res.body.getReader(); const decoder = new TextDecoder();
    let reply = "", reasoning = "", buffer = "";
    let msgAttachments = [];
    let attachmentBase64Bytes = 0;
    const MAX_SSE_BUFFER = 8 * 1024 * 1024;
    const MAX_ATTACHMENT_BASE64 = 24 * 1024 * 1024;
    const MAX_RESPONSE_CHARS = 8 * 1024 * 1024;
    const activity = {};
    let stepsCount = 0;
  let hasUsedTool = false; const extraThinkState = {};
    let responseBubble = null; let responseActions = null; let currentBubbleText = ""; // Guarda o texto apenas da bolha atual, separado do reply total salvo no histórico.
    let pendingSources = null;
    let streamFailed = false;
    let streamFailureMessage = "";

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
      if (buffer.length > MAX_SSE_BUFFER) throw new Error("stream SSE grande demais");
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
            if (typeof chunk.data !== "string" || chunk.data.length > MAX_ATTACHMENT_BASE64 ||
                (attachmentBase64Bytes += chunk.data.length) > MAX_ATTACHMENT_BASE64 * 2) {
              throw new Error("anexo recebido excede o limite de segurança");
            }
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

          if (chunk.type === "tier_used") {
            // Server may have escalated tier/speed/effort mid-generation
            // (forward_message). Without this, currentTier/meta stay on
            // the pre-escalation value and the next saveCurrentMessages()
            // would send it back to the server, overwriting the correct
            // tier that was just persisted after generation finished.
            currentTier = chunk.tier ?? currentTier;
            currentSpeed = chunk.speed ?? currentSpeed;
            currentEffort = chunk.effort ?? currentEffort;
            const activeId = localStorage.getItem(ACTIVE_KEY);
            if (activeId && _chatsMeta[activeId]) {
              _chatsMeta[activeId].tier = currentTier;
              _chatsMeta[activeId].speed = currentSpeed;
              _chatsMeta[activeId].effort = currentEffort;
            }
            continue;
          }

          if (chunk.type === "token_exhausted") {
            console.warn(`⚠️ Token HF esgotado no servidor - ${chunk.remaining}/${chunk.total} restantes.`);
            continue;
          }

          if (chunk.type === "step") {
            hasUsedTool = true; closeExtraThink(extraThinkState);
            clearTimeout(thinkingTimer);
            ensureMasterRow();
            masterCol.querySelectorAll(".msg-actions").forEach(el => el.remove());
            // Closes the current text bubble once a tool call arrives, so
            // text before and after the tool doesn't mix in the same bubble.
            responseBubble = null; currentBubbleText = "";
            ensureToolActivityCard(masterCol, chunk, activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
            // Rich widget (currency, chart, calculator, images...) shown
            // directly in the conversation, outside the collapsible, not
            // just hidden inside the "N steps" accordion.
            if (chunk.output !== undefined && chunk.output !== "") {
              showInlineToolResult(masterCol, chunk.id, chunk.tool, chunk.output, responseBubble, chunk.value);
            }
            stepsCount++;
            scrollToBottom();
            continue;
          }

          if (chunk.type === "image_generation") {
            clearTimeout(thinkingTimer);
            ensureMasterRow();
            removeTyping();
            renderImageGenerationCard(masterCol, chunk);
            if (chunk.status === "ready" || chunk.status === "failed") {
              msgAttachments = [
                ...msgAttachments.filter(a => !(a.type === "generated_image" && a.image_id === chunk.image_id)),
                { type: "generated_image", image_id: chunk.image_id, status: chunk.status, aspect_ratio: chunk.aspect_ratio, width: chunk.width, height: chunk.height, is_edit: chunk.is_edit },
              ];
            }
            continue;
          }

          if (chunk.type === "error") {
            streamFailed = true;
            streamFailureMessage = String(chunk.message || "Falha na geração.");
            clearTimeout(thinkingTimer); removeTyping(); ensureMasterRow();
            const eb = document.createElement("div"); eb.className = "bubble bot";
            eb.textContent = `Erro: ${streamFailureMessage}`;
            masterCol.appendChild(eb); continue;
          }

          if (chunk.type === "sources" && chunk.results?.length) {
            pendingSources = chunk.results;
            if (responseActions && responseActions.isConnected && !responseActions.querySelector(".sources-btn-wrap")) {
              responseActions.appendChild(createSourcesButton(pendingSources));
            }
            continue;
          }

          const delta = chunk.choices?.[0]?.delta ?? {};
          const reasoningDelta = delta.reasoning_content ?? "", contentDelta = delta.content ?? "";

          if (reasoningDelta) {
            if (reasoning.length + String(reasoningDelta).length > MAX_RESPONSE_CHARS) throw new Error("Resposta SSE grande demais");
            reasoning += reasoningDelta;
            ensureMasterRow();
            ensureThinkingSegment(activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
            appendThinkingSegment(activity, reasoningDelta);
            scrollToBottom();
          }

          if (contentDelta) {
            if (reply.length + String(contentDelta).length > MAX_RESPONSE_CHARS) throw new Error("Resposta SSE grande demais");
            if (!responseBubble) {
              removeTyping();
              ensureMasterRow();

              responseBubble = document.createElement("div"); responseBubble.className = "bubble bot";
              const thisBubble = responseBubble; // Captura a bolha atual antes de ela mudar depois de uma tool call.
              masterCol.appendChild(responseBubble);
              const actions = document.createElement("div"); actions.className = "msg-actions streaming";
              responseActions = actions;
              const copyBtn = document.createElement("button"); copyBtn.className = "msg-action-btn";
              copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar`;
              // Uses _rawText to copy the bubble's real text without reading the full DOM.
              copyBtn.addEventListener("click", () => copyText(thisBubble._rawText ?? "", copyBtn));
              copyBtn.disabled = true;
              const regenBtn = document.createElement("button"); regenBtn.className = "msg-action-btn msg-regenerate-btn";
              regenBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.27"/></svg> Tentar novamente`;
              regenBtn.addEventListener("click", () => regenerate(masterRow, thisBubble, actions));
              regenBtn.disabled = true;
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
            if (reply.length + String(cd2).length > MAX_RESPONSE_CHARS) throw new Error("Resposta SSE grande demais");
            reply += cd2;
            currentBubbleText += cd2;
            if (responseBubble) scheduleMarkdownRender(responseBubble, currentBubbleText);
          }
        } catch {}
      }
    }
    if (responseBubble) renderMarkdown(responseBubble, currentBubbleText);
    finalizeThinkingSegment(activity);

    if (streamFailed) {
      clearPendingGen();
      currentGenId = null;
      return;
    }

    removeTyping();

    if (responseActions) {
      responseActions.classList.remove("streaming");
      responseActions.querySelectorAll(".msg-action-btn").forEach(btn => { btn.disabled = false; });
    }

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

    if (messages !== streamMessages || localStorage.getItem(ACTIVE_KEY) !== streamChatId) return;
    // genId on the message lets the reconnection flow (syncGenerationOnce)
    // reliably detect whether this generation was already appended,
    // instead of comparing text.
    messages.push({ role: "assistant", content: reply, ...(msgAttachments.length ? { attachments: msgAttachments } : {}), ...(currentGenId ? { genId: currentGenId } : {}) });
    saveCurrentMessages();
    updateRegenerateAvailability();
    if (responseBubble && !responseBubble._rawText) responseBubble._rawText = reply;
    clearPendingGen(); currentGenId = null;
    stopElapsedTicker();

  } catch (e) {
    if (messages !== streamMessages || localStorage.getItem(ACTIVE_KEY) !== streamChatId) return;
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
