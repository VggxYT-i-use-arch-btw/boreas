// Boreas frontend module: streaming state, reconnection, watchdogs, and stop controls.
// Loaded as a classic script in the exact order declared by index.html.

// Boreas: streaming, renderização, envio e regeneração.

let currentAbortController = null;

let currentGenId = null;
let userStoppedGeneration = false; // true only while an explicit Parar click's abort is in flight
const PENDING_GEN_KEY = "boreas_pending_gen";
function savePendingGen(genId, chatId) {
  try { localStorage.setItem(PENDING_GEN_KEY, JSON.stringify({ genId, chatId, ts: Date.now() })); } catch {}
}
function getPendingGen() {
  try { return JSON.parse(localStorage.getItem(PENDING_GEN_KEY)); } catch { return null; }
}
function clearPendingGen() {
  try { localStorage.removeItem(PENDING_GEN_KEY); } catch {}
}

let syncInFlight = null;
let syncInFlightGenId = null;
let syncRetryTimer = null;
let syncRetryAttempt = 0;

function schedulePendingSync(genId) {
  if (syncRetryTimer || !genId || navigator.onLine === false) return;
  if (getPendingGen()?.genId !== genId) return;
  const delay = Math.min(16000, 1000 * (2 ** Math.min(syncRetryAttempt++, 4)));
  syncRetryTimer = setTimeout(() => {
    syncRetryTimer = null;
    syncGeneration(genId, { resetRetry: false });
  }, delay);
}

function showSyncBanner(genId) {
  document.getElementById("resume-banner")?.remove();
  document.getElementById("sync-banner")?.remove();
  const banner = document.createElement("div");
  banner.id = "sync-banner";
  banner.className = "resume-banner-el";
  banner.innerHTML = `<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 12h8"></path><path d="M12 8v8"></path><path d="M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"></path></svg> Conexão interrompida - a resposta pode ter continuado.</span><button id="sync-btn">Reconectar</button>`;
  messagesEl.appendChild(banner);
  scrollToBottom();
  document.getElementById("sync-btn").addEventListener("click", () => syncGeneration(genId));
}

function syncGeneration(genId, { resetRetry = true } = {}) {
  if (!genId) return Promise.resolve(false);
  if (syncInFlight && syncInFlightGenId === genId) return syncInFlight;
  clearTimeout(syncRetryTimer); syncRetryTimer = null;
  if (resetRetry) syncRetryAttempt = 0;
  syncInFlightGenId = genId;
  syncInFlight = syncGenerationOnce(genId).finally(() => {
    syncInFlight = null;
    syncInFlightGenId = null;
  });
  return syncInFlight;
}

async function syncGenerationOnce(genId) {
  document.getElementById("sync-banner")?.remove();
  loading = true; showStopBtn();
  currentGenId = genId;

  // A conexão pode cair depois de a resposta parcial já estar na tela. O
  // endpoint de sync reenvia todos os chunks desde o começo; removemos apenas
  // a linha marcada para esta geração antes de reconstruí-la, evitando uma
  // segunda resposta visual com o mesmo conteúdo.
  [...messagesEl.querySelectorAll(".msg-row.bot")]
    .filter(row => row.dataset.generationId === String(genId))
    .forEach(row => row.remove());

  let masterRow = null, masterCol = null, responseBubble = null;
  let reply = "", segmentReply = "";
  let msgAttachments = [];
  const previousAssistant = messages.at(-1)?.role === "assistant" ? messages.at(-1) : null;
  const activity = {};
  let sawDone = false;
  let syncMissing = false;
  function ensureRow() {
    if (!masterRow) {
      removeTyping();
      masterRow = document.createElement("div"); masterRow.className = "msg-row bot";
      masterRow.dataset.generationId = String(genId);
      const avatar = document.createElement("div"); avatar.className = "avatar";
      avatar.innerHTML = `<img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" style="width:42px;height:42px;object-fit:contain;opacity:0.95" loading="lazy" decoding="async" draggable="false">`;
      masterCol = document.createElement("div"); masterCol.className = "bot-col"; masterCol.style.gap = "4px";
      masterRow.appendChild(avatar); masterRow.appendChild(masterCol);
      messagesEl.appendChild(masterRow);
    }
  }

  try {
    const res = await fetch(`${BACKEND_URL}/chat/sync/${genId}`, {
      headers: { "x-session-id": localStorage.getItem("boreas_session_id") ?? "" },
      credentials: "include",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim(); if (raw === "[DONE]") { sawDone = true; continue; }
        let chunk; try { chunk = JSON.parse(raw); } catch { continue; }

        if (chunk.type === "sync_missing") {
          syncMissing = true;
          continue;
        }
        if (chunk.type === "gen_id" || chunk.type === "heartbeat" || chunk.type === "token_exhausted") continue;
        if (chunk.type === "file" && chunk.name) { ensureRow(); masterCol.appendChild(createFileCard(chunk.name, chunk.data, chunk.mime)); msgAttachments.push({ type: "file", name: chunk.name, data: chunk.data, mime: chunk.mime }); scrollToBottom(); continue; }
        if (chunk.type === "deep_research") { ensureRow(); renderDeepResearchCard(masterCol, chunk); if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "deep_research"), { ...chunk }]; continue; }
        if (chunk.type === "agentic_loop") { ensureRow(); renderAgenticLoopCard(masterCol, chunk); if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "agentic_loop"), { ...chunk }]; continue; }
        if (chunk.type === "ask_user_prompt") { ensureRow(); const _aupAns = await renderAskUserPromptCard(masterCol, chunk.promptId, chunk.questions); msgAttachments.push({ type: "ask_user_prompt", promptId: chunk.promptId, questions: chunk.questions, answers: _aupAns ?? null, timedOut: !_aupAns }); continue; }
        if (chunk.type === "step") {
          ensureRow(); responseBubble = null; segmentReply = "";
          ensureThinkingSegment(activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
          ensureToolActivityCard(masterCol, chunk, activity);
          scrollToBottom(); continue;
        }
        if (chunk.type === "sources") { ensureRow(); masterCol.appendChild(createSourcesButton(chunk.results)); continue; }
        if (chunk.type === "error") { ensureRow(); appendMessage("bot", `Erro: ${chunk.message}`); continue; }

        const delta = chunk.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          ensureRow();
          ensureThinkingSegment(activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
          appendThinkingSegment(activity, delta.reasoning_content);
        }
        if (delta?.content) {
          ensureRow();
          reply += delta.content;
          segmentReply += delta.content;
          if (!responseBubble) { responseBubble = document.createElement("div"); responseBubble.className = "bubble bot"; masterCol.appendChild(responseBubble); }
          scheduleMarkdownRender(responseBubble, segmentReply);
          scrollToBottom();
        }
      }
    }

    if (responseBubble) renderMarkdown(responseBubble, segmentReply);
    finalizeThinkingSegment(activity);
    if (sawDone || syncMissing) clearPendingGen();
    if (reply || msgAttachments.length) {
      const sameContent = previousAssistant
        && previousAssistant.content === reply
        && (Array.isArray(previousAssistant.attachments) ? previousAssistant.attachments.length : 0) === msgAttachments.length;
      if (sameContent) {
        masterRow?.remove();
      } else {
        messages.push({ role: "assistant", content: reply, ...(msgAttachments.length ? { attachments: msgAttachments } : {}) });
      }
      saveCurrentMessages();
      updateRegenerateAvailability();
      if (responseBubble) responseBubble._rawText = reply;
    }
  } catch (e) {
    if (getPendingGen()?.genId === genId) {
      showSyncBanner(genId);
      schedulePendingSync(genId);
    } else {
      ensureRow();
      appendMessage("bot", "Não foi possível sincronizar agora. Tente de novo em instantes.");
    }
  } finally {
    loading = false; hideStopBtn(); currentGenId = null;
  }
}

function startElapsedTicker(getBubbleEl, startTime) {
  const intervalId = setInterval(() => {
    const b = getBubbleEl();
    if (!b || !b.innerHTML.includes("Em trabalho")) return;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    b.innerHTML = `<span style="color:rgba(120,180,220,0.4);font-size:12px;letter-spacing:0.08em">Em trabalho</span><span style="color:rgba(100,160,200,0.35);font-size:11px;margin-left:5px">${elapsed}s</span><span style="display:inline-flex;gap:3px;margin-left:6px;vertical-align:middle"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
  }, 1000);
  return () => clearInterval(intervalId); // stop() - idempotente
}

// Sem nenhum chunk do servidor (nem "gen_id") dentro desse prazo = geração
// travada antes mesmo de começar. Aborta e deixa o usuário tentar de novo,
// em vez de esperar o timeout genérico de 90s do fetch.
const NO_RESPONSE_TIMEOUT_MS = 20000;
function startNoResponseWatchdog(_getBubbleEl, onExpire) {
  const timer = setTimeout(onExpire, NO_RESPONSE_TIMEOUT_MS);
  return () => clearTimeout(timer); // stop()
}

function showNoResponseError(retryFn) {
  removeTyping();
  document.getElementById("sync-banner")?.remove();
  document.getElementById("no-response-banner")?.remove();
  const banner = document.createElement("div");
  banner.id = "no-response-banner";
  banner.className = "resume-banner-el";
  banner.innerHTML = `<span>⏱️ Sem resposta, cancelado automaticamente.</span><button id="no-response-retry-btn">Tentar novamente ↻</button>`;
  messagesEl.appendChild(banner);
  scrollToBottom();
  document.getElementById("no-response-retry-btn").addEventListener("click", () => {
    banner.remove();
    retryFn();
  }, { once: true });
}

// O botão de envio volta sempre para o PNG oficial depois do modo "parar".
// O modo parada continua usando o quadrado inline, que é um estado diferente.
const SEND_ICON = `<img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/send_msg.png" alt="Enviar mensagem" draggable="false">`;
const STOP_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="var(--bg)"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`;

function showStopBtn() {
  sendBtn.innerHTML = STOP_ICON;
  sendBtn.classList.add("stop-mode");
  sendBtn.disabled = false;
}
function hideStopBtn() {
  sendBtn.innerHTML = SEND_ICON;
  sendBtn.classList.remove("stop-mode");
  sendBtn.disabled = !msgInput.value.trim() && !pendingImages.length && !pendingFile;
}

sendBtn.addEventListener("click", () => {
  if (loading && currentAbortController) {
    userStoppedGeneration = true;
    currentAbortController.abort();

    if (currentGenId) {
      fetch(`${BACKEND_URL}/chat/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-id": localStorage.getItem("boreas_session_id") ?? "" },
        body: JSON.stringify({ genId: currentGenId }),
        keepalive: true,
      }).catch(() => {});
    }
    clearPendingGen();
  } else if (!loading) {
    send();
  }
});
