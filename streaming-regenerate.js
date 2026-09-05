// Boreas frontend module: response regeneration.
// Loaded as a classic script in the exact order declared by index.html.

function showTyping() {
  const row = document.createElement("div");
  row.className = "msg-row bot"; row.id = "typing-row";
  const avatar = document.createElement("div"); avatar.className = "avatar";
      avatar.innerHTML = `<img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" style="width:42px;height:42px;object-fit:contain;opacity:0.95" loading="lazy" decoding="async" draggable="false">`;
  const bubble = document.createElement("div"); bubble.className = "bubble bot";
  bubble.innerHTML = `<div class="typing-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
  row.appendChild(avatar); row.appendChild(bubble);
  messagesEl.appendChild(row); scrollToBottom();
}

function removeTyping() { document.getElementById("typing-row")?.remove(); }

let warnShownThisSession = false;
const warnOverlay = document.getElementById("warn-overlay");
const lockBar     = document.getElementById("lock-bar");
const inputRow    = document.querySelector(".input-row");

document.getElementById("warn-btn").addEventListener("click", () => warnOverlay.classList.remove("show"));

async function regenerate(botRow, botBubble, actionsEl) {
  if (globalThis.BoreasSessionContextStale) return;
  if (loading) return;
  const retryFromUser = botRow?._isRetryOfUser === true;
  const regenerateIndex = Number.isInteger(botRow?._msgIndex) ? botRow._msgIndex : messages.length - 1;
  if (!retryFromUser && (messages.at(-1)?.role !== "assistant" || regenerateIndex !== messages.length - 1)) return;
  if (retryFromUser && messages.at(-1)?.role !== "user") return;
  autoScroll = true; updateScrollBtn();
  if (messages.length && messages[messages.length - 1].role === "assistant") messages.pop();
  const streamMessages = messages;
  const streamChatId = localStorage.getItem(ACTIVE_KEY);

  const col = botRow.querySelector(".bot-col");
  if (col) {
    // Regeneration starts a clean sequence; this also removes every
    // reasoning segment, tool, and intermediate bubble from the previous response.
    col.replaceChildren();
    botBubble = document.createElement("div");
    botBubble.className = "bubble bot";
    col.appendChild(botBubble);
  }

  botBubble.innerHTML = `<div class="typing-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
  if (actionsEl) actionsEl.style.opacity = "0";

  loading = true; showStopBtn();
  let reply = "", reasoning = "";
  let msgAttachments = [];
  let attachmentBase64Bytes = 0;
  const MAX_SSE_BUFFER = 8 * 1024 * 1024;
  const MAX_ATTACHMENT_BASE64 = 24 * 1024 * 1024;
  const MAX_RESPONSE_CHARS = 8 * 1024 * 1024;
  let responseBubble = null, currentBubbleText = "";
  let pendingSourcesR = null;
  let streamFailed = false;
  let streamFailureMessage = "";
  const activity = {};
  let stepsCount = 0;
  let hasUsedTool = false; const extraThinkState = {};
  const DOTS = `<span style="display:inline-flex;gap:3px;margin-left:2px"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
  const CHEVRON = `<svg class="pill-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

  let thinkingTimer = setTimeout(() => {
    botBubble.innerHTML = `<span class="work-status-label">Em trabalho</span><span style="display:inline-flex;gap:3px;margin-left:6px;vertical-align:middle"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
  }, 1000);

  currentAbortController = new AbortController();
  const _regenStartTime = Date.now();

  const stopElapsedTicker = startElapsedTicker(() => botBubble, _regenStartTime);
  let noGenIdTimedOut = false;
  const stopNoResponseWatchdog = startNoResponseWatchdog(() => botBubble, () => {
    noGenIdTimedOut = true;
    try { currentAbortController.abort(); } catch {}
  });

  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      signal: currentAbortController.signal,
      headers: BoreasSessionHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({ tier: currentTier, speed: currentSpeed, effort: currentEffort, messages: streamMessages, chatId: streamChatId, regenerate: true, regenerateIndex, name: localStorage.getItem("boreas_name") ?? "", use: localStorage.getItem("boreas_use") ?? "", chatMemoryEnabled }),
    });
    clearTimeout(thinkingTimer);
    if (!res.ok) { throw await boreasHttpError(res); }

    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
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
            if (botRow) botRow.dataset.generationId = String(chunk.id);
            savePendingGen(chunk.id, localStorage.getItem(ACTIVE_KEY));
            stopNoResponseWatchdog();
            continue;
          }
          if (chunk.type === "heartbeat") { continue; } // Ignora o evento heartbeat.
          if (chunk.type === "file" && chunk.name) {    // Anexa o arquivo na timeline.
            if (typeof chunk.data !== "string" || chunk.data.length > MAX_ATTACHMENT_BASE64 ||
                (attachmentBase64Bytes += chunk.data.length) > MAX_ATTACHMENT_BASE64 * 2) {
              throw new Error("anexo recebido excede o limite de segurança");
            }
            col.appendChild(createFileCard(chunk.name, chunk.data, chunk.mime));
            msgAttachments.push({ type: "file", name: chunk.name, data: chunk.data, mime: chunk.mime });
            scrollToBottom();
            continue;
          }

          if (chunk.type === "deep_research") {
            clearTimeout(thinkingTimer);
            renderDeepResearchCard(col, chunk);
            if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "deep_research"), { ...chunk }];
            continue;
          }

          if (chunk.type === "agentic_loop") {
            clearTimeout(thinkingTimer);
            renderAgenticLoopCard(col, chunk);
            if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "agentic_loop"), { ...chunk }];
            continue;
          }

          if (chunk.type === "image_generation") {
            clearTimeout(thinkingTimer);
            renderImageGenerationCard(col, chunk);
            if (chunk.status === "ready" || chunk.status === "failed") {
              msgAttachments = [
                ...msgAttachments.filter(a => !(a.type === "generated_image" && a.image_id === chunk.image_id)),
                { type: "generated_image", image_id: chunk.image_id, status: chunk.status, aspect_ratio: chunk.aspect_ratio, width: chunk.width, height: chunk.height, is_edit: chunk.is_edit },
              ];
            }
            continue;
          }

          if (chunk.type === "ask_user_prompt") {
            clearTimeout(thinkingTimer);
            const _aupAns = await renderAskUserPromptCard(col, chunk.promptId, chunk.questions);
            msgAttachments.push({ type: "ask_user_prompt", promptId: chunk.promptId, questions: chunk.questions, answers: _aupAns ?? null, timedOut: !_aupAns });
            continue;
          }

          if (chunk.type === "error") {
            streamFailed = true;
            streamFailureMessage = String(chunk.message || "Falha na geração.");
            clearTimeout(thinkingTimer);
            if (botBubble?.isConnected) botBubble.textContent = `Erro: ${streamFailureMessage}`;
            else { const errorBubble = document.createElement("div"); errorBubble.className = "bubble bot"; errorBubble.textContent = `Erro: ${streamFailureMessage}`; col.appendChild(errorBubble); }
            continue;
          }

          if (chunk.type === "sources" && chunk.results?.length) {
            pendingSourcesR = chunk.results;
            if (actionsEl?.isConnected && !actionsEl.querySelector(".sources-btn-wrap")) {
              actionsEl.appendChild(createSourcesButton(pendingSourcesR));
            }
            continue;
          }

          if (chunk.type === "step") {
            hasUsedTool = true; closeExtraThink(extraThinkState);

            clearTimeout(thinkingTimer);
            stopElapsedTicker();

            col.querySelectorAll(".msg-actions").forEach(el => el.remove());
            if (botBubble?.isConnected) botBubble.remove();
            responseBubble = null; currentBubbleText = "";
            ensureToolActivityCard(col, chunk, activity, (pill, detail) => { col.appendChild(pill); col.appendChild(detail); });
            if (chunk.output !== undefined && chunk.output !== "") {
              showInlineToolResult(col, chunk.id, chunk.tool, chunk.output, responseBubble, chunk.value);
            }
            stepsCount++;
            scrollToBottom();
            continue;
          }

          const delta = chunk.choices?.[0]?.delta ?? {};
          const rd = delta.reasoning_content ?? "", cd = delta.content ?? "";
          if (rd) {
            if (reasoning.length + String(rd).length > MAX_RESPONSE_CHARS) throw new Error("Resposta SSE grande demais");
            reasoning += rd;
            if (botBubble?.isConnected) botBubble.remove();
            ensureThinkingSegment(activity, (pill, detail) => { col.appendChild(pill); col.appendChild(detail); });
            appendThinkingSegment(activity, rd);
            scrollToBottom();
          }
          if (cd) {
            if (reply.length + String(cd).length > MAX_RESPONSE_CHARS) throw new Error("Resposta SSE grande demais");
            if (!responseBubble) {
              if (botBubble?.isConnected) botBubble.remove();
              responseBubble = document.createElement("div"); responseBubble.className = "bubble bot"; col.appendChild(responseBubble);
            }
            reply += cd; currentBubbleText += cd; scheduleMarkdownRender(responseBubble, currentBubbleText);
            responseBubble._rawText = currentBubbleText;
            scrollToBottom(); await new Promise(r => setTimeout(r, 0));
          }
        } catch (parseErr) { /* SSE inválida; ignorar. */ }
      }
    }

    if (responseBubble) renderMarkdown(responseBubble, currentBubbleText);
    finalizeThinkingSegment(activity);

    if (streamFailed) {
      stopNoResponseWatchdog(); stopElapsedTicker();
      clearPendingGen();
      currentGenId = null;
      if (actionsEl) actionsEl.style.opacity = "";
      return;
    }

    if (messages !== streamMessages || localStorage.getItem(ACTIVE_KEY) !== streamChatId) { stopNoResponseWatchdog(); stopElapsedTicker(); return; }
    if (reply || msgAttachments.length) {
      messages.push({ role: "assistant", content: reply, ...(msgAttachments.length ? { attachments: msgAttachments } : {}), ...(currentGenId ? { genId: currentGenId } : {}) });
      saveCurrentMessages();
      updateRegenerateAvailability();
    }
    if (responseBubble && !col.querySelector(".msg-actions")) {
      const actions = document.createElement("div"); actions.className = "msg-actions";
      const copyBtn = document.createElement("button"); copyBtn.className = "msg-action-btn";
      copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar`;
      copyBtn.addEventListener("click", () => copyText(responseBubble._rawText ?? "", copyBtn));
      const regenBtn = document.createElement("button"); regenBtn.className = "msg-action-btn msg-regenerate-btn";
      regenBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.27"/></svg> Tentar novamente`;
      regenBtn.addEventListener("click", () => regenerate(botRow, responseBubble, actions));
      if (pendingSourcesR?.length) actions.appendChild(createSourcesButton(pendingSourcesR));
      actions.appendChild(copyBtn); actions.appendChild(regenBtn); col.appendChild(actions);
    }
    if (responseBubble) responseBubble._rawText = currentBubbleText;
    if (actionsEl) actionsEl.style.opacity = "";
    clearPendingGen(); currentGenId = null;
    stopNoResponseWatchdog(); stopElapsedTicker();
  } catch (e) {
    stopNoResponseWatchdog(); stopElapsedTicker();
    if (messages !== streamMessages || localStorage.getItem(ACTIVE_KEY) !== streamChatId) return;
    clearTimeout(thinkingTimer);

    if (noGenIdTimedOut) {

      if (col) col.querySelectorAll(".thinking-pill, .thinking-inline, .tasks-pill, .tasks-detail").forEach(el => el.remove());
      showNoResponseError(() => regenerate(botRow, botBubble, actionsEl));
    } else if (e.name === "AbortError" && userStoppedGeneration) {

    } else if (currentGenId) {
      if (col) col.querySelectorAll(".thinking-pill, .thinking-inline, .tasks-pill, .tasks-detail").forEach(el => el.remove());
      showSyncBanner(currentGenId);
    } else if (e.name !== "AbortError") {
      if (col) col.querySelectorAll(".thinking-pill, .thinking-inline, .tasks-pill, .tasks-detail").forEach(el => el.remove());
      if (botBubble) botBubble.textContent = `Erro: ${String(e?.message ?? "Falha na geração.")}`;
    }
    if (actionsEl) actionsEl.style.opacity = "";
  } finally {
    loading = false;
    hideStopBtn();
    userStoppedGeneration = false;
  }
}
