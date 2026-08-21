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
  if (loading) return;
  const retryFromUser = botRow?._isRetryOfUser === true;
  const regenerateIndex = Number.isInteger(botRow?._msgIndex) ? botRow._msgIndex : messages.length - 1;
  if (!retryFromUser && (messages.at(-1)?.role !== "assistant" || regenerateIndex !== messages.length - 1)) return;
  if (retryFromUser && messages.at(-1)?.role !== "user") return;
  autoScroll = true; updateScrollBtn();
  if (messages.length && messages[messages.length - 1].role === "assistant") messages.pop();

  const col = botRow.querySelector(".bot-col");
  if (col) {
    // Regeneração começa uma sequência limpa; isso também remove todos os
    // segmentos de reasoning, tools e bolhas intermediárias da resposta anterior.
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
  let responseBubble = null, currentBubbleText = "";
  const activity = {};
  let stepsCount = 0;
  let hasUsedTool = false; const extraThinkState = {};
  const DOTS = `<span style="display:inline-flex;gap:3px;margin-left:2px"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
  const CHEVRON = `<svg class="pill-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  const TOOL_META = { WEB_SEARCH: { icon: "🔍" }, WEB_FETCH: { icon: "🌐" }, BASH: { icon: "💻" }, DELETE: { icon: "🗑️" }, STR_REPLACE: { icon: "✏️" }, SEND_FILE: { icon: "📎" }, CREATE_FILE: { icon: "📄" }, MEMORY: { icon: "🧠" }, PREFERENCES: { icon: "⚙️" }, ASK_USER: { icon: "❓" }, CALCULATOR: { icon: "🧮" }, GRAPH: { icon: "📊" }, FORWARD_MESSAGE: { icon: "🚀" }, USE_PLUGIN: { icon: "🧩" }, IMAGE_SEARCH: { icon: "🔍" }, PRESENT_IMAGE: { icon: "🖼️" }, VIEW_CHATS: { icon: "🗂️" }, CURRENCY: { icon: "💱" } };

  let thinkingTimer = setTimeout(() => {
    botBubble.innerHTML = `<span style="color:rgba(120,180,220,0.4);font-size:12px;letter-spacing:0.08em">Em trabalho</span><span style="display:inline-flex;gap:3px;margin-left:6px;vertical-align:middle"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
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
      headers: { "Content-Type": "application/json", "x-session-id": localStorage.getItem("boreas_session_id") ?? "" },
      body: JSON.stringify({ tier: currentTier, speed: currentSpeed, effort: currentEffort, messages, chatId: localStorage.getItem(ACTIVE_KEY), regenerate: true, regenerateIndex, name: localStorage.getItem("boreas_name") ?? "", use: localStorage.getItem("boreas_use") ?? "", chatMemoryEnabled }),
    });
    clearTimeout(thinkingTimer);
    if (!res.ok) { throw new Error(`HTTP ${res.status}`); }

    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
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

          if (chunk.type === "ask_user_prompt") {
            clearTimeout(thinkingTimer);
            const _aupAns = await renderAskUserPromptCard(col, chunk.promptId, chunk.questions);
            msgAttachments.push({ type: "ask_user_prompt", promptId: chunk.promptId, questions: chunk.questions, answers: _aupAns ?? null, timedOut: !_aupAns });
            continue;
          }

          if (chunk.type === "error") {
            clearTimeout(thinkingTimer);
            if (botBubble?.isConnected) botBubble.innerHTML = `Erro: ${chunk.message}`;
            else { const errorBubble = document.createElement("div"); errorBubble.className = "bubble bot"; errorBubble.textContent = `Erro: ${chunk.message}`; col.appendChild(errorBubble); }
            continue;
          }

          if (chunk.type === "sources" && chunk.results?.length) {

            if (actionsEl) actionsEl.appendChild(createSourcesButton(chunk.results));
            continue;
          }

          if (chunk.type === "step") {
            hasUsedTool = true; closeExtraThink(extraThinkState);
            closeThinkingSegment(activity);

            clearTimeout(thinkingTimer);
            stopElapsedTicker();

            col.querySelectorAll(".msg-actions").forEach(el => el.remove());
            if (botBubble?.isConnected) botBubble.remove();
            responseBubble = null; currentBubbleText = "";
            ensureThinkingSegment(activity, (pill, detail) => { col.appendChild(pill); col.appendChild(detail); });
            ensureToolActivityCard(col, chunk, activity);
            scrollToBottom();
            continue;

            ensureThinkingSegment(activity, (pill, detail) => { col.appendChild(pill); col.appendChild(detail); });
            const stepsDetail = activity.detail;
            const meta = TOOL_META[chunk.tool] ?? { icon: "🔧" };
            const rawHasOutput = chunk.output !== undefined && chunk.output !== "";
            const hasOutput = rawHasOutput && !isBadgeOnlyTool(chunk.tool);
            if (!stepsDetail._byId) stepsDetail._byId = {};

            if (chunk.id && stepsDetail._byId[chunk.id]) {
              const ex = stepsDetail._byId[chunk.id];
              ex.lSpan.textContent = taskItemLabel(chunk.tool, chunk.value, rawHasOutput);
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
            const lSpan = document.createElement("span"); lSpan.className = "task-item-label"; lSpan.textContent = taskItemLabel(chunk.tool, chunk.value, rawHasOutput);
            hdr.appendChild(iSpan); hdr.appendChild(lSpan);
            if (hasOutput) {
              const chev = document.createElement("span"); chev.className = "task-item-chevron";
              chev.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
              hdr.appendChild(chev);
              const body = document.createElement("div"); body.className = "task-item-body";
              renderStepBody(body, chunk.tool, chunk.value, chunk.output);
              taskEl.appendChild(hdr); taskEl.appendChild(body);
              hdr.addEventListener("click", () => taskEl.classList.toggle("expanded"));
            } else { taskEl.appendChild(hdr); }
            // Direto no fim da timeline - sem agrupar por tipo de tool, pra
            // preservar a ordem cronológica real das chamadas.
            stepsDetail.appendChild(taskEl);
            if (chunk.id) stepsDetail._byId[chunk.id] = { taskEl, hdr, lSpan, iSpan };
            scrollToBottom();
            continue;
          }

          const delta = chunk.choices?.[0]?.delta ?? {};
          const rd = delta.reasoning_content ?? "", cd = delta.content ?? "";
          if (rd) {
            reasoning += rd;
            if (botBubble?.isConnected) botBubble.remove();
            ensureThinkingSegment(activity, (pill, detail) => { col.appendChild(pill); col.appendChild(detail); });
            appendThinkingSegment(activity, rd);
            scrollToBottom();
          }
          if (cd) {
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

    if (reply || msgAttachments.length) {
      messages.push({ role: "assistant", content: reply, ...(msgAttachments.length ? { attachments: msgAttachments } : {}) });
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
      actions.appendChild(copyBtn); actions.appendChild(regenBtn); col.appendChild(actions);
    }
    if (responseBubble) responseBubble._rawText = currentBubbleText;
    if (actionsEl) actionsEl.style.opacity = "";
    clearPendingGen(); currentGenId = null;
    stopNoResponseWatchdog(); stopElapsedTicker();
  } catch (e) {
    clearTimeout(thinkingTimer);
    stopNoResponseWatchdog(); stopElapsedTicker();

    if (noGenIdTimedOut) {

      if (col) col.querySelectorAll(".thinking-pill, .thinking-inline, .tasks-pill, .tasks-detail").forEach(el => el.remove());
      showNoResponseError(() => regenerate(botRow, botBubble, actionsEl));
    } else if (e.name === "AbortError" && userStoppedGeneration) {

    } else if (currentGenId) {
      if (col) col.querySelectorAll(".thinking-pill, .thinking-inline, .tasks-pill, .tasks-detail").forEach(el => el.remove());
      showSyncBanner(currentGenId);
    } else if (e.name !== "AbortError") {
      if (col) col.querySelectorAll(".thinking-pill, .thinking-inline, .tasks-pill, .tasks-detail").forEach(el => el.remove());
      botBubble.innerHTML = `Erro: ${e.message}`;
    }
    if (actionsEl) actionsEl.style.opacity = "";
  } finally {
    loading = false;
    hideStopBtn();
    userStoppedGeneration = false;
  }
}

