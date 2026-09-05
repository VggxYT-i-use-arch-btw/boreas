// Boreas frontend module: streaming state, reconnection, watchdogs, and stop controls.
// Loaded as a classic script in the exact order declared by index.html.

// Boreas: streaming, rendering, sending, and regeneration.

let currentAbortController = null;

let currentGenId = null;
let userStoppedGeneration = false; // true only while an explicit Parar click's abort is in flight
const PENDING_GEN_KEY = "boreas_pending_gen";
function pendingAccountScope() {
  const scope = String(localStorage.getItem("boreas_session_scope") || "").trim().toLowerCase();
  return /^[a-f0-9]{32}$/.test(scope) ? scope : "";
}
function validGenerationId(id) {
  return typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
}

async function boreasHttpError(response) {
  let message = `HTTP ${response.status}`;
  try {
    const data = await response.clone().json();
    if (typeof data?.error === "string" && data.error.trim()) message = data.error.trim();
  } catch {}
  const error = new Error(message);
  error.status = response.status;
  if (response.status === 401) document.dispatchEvent(new CustomEvent("boreas:session-expired"));
  return error;
}
function validPendingChatId(id) {
  return typeof id === "string" && /^(?!__proto__$|prototype$|constructor$)[A-Za-z0-9_-]{1,80}$/i.test(id);
}
function savePendingGen(genId, chatId) {
  const accountScope = pendingAccountScope();
  if (!validGenerationId(genId) || !validPendingChatId(chatId) || !accountScope) return;
  try { localStorage.setItem(PENDING_GEN_KEY, JSON.stringify({ genId, chatId, accountScope, ts: Date.now() })); } catch {}
}
function getPendingGen() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_GEN_KEY));
    return pending && validGenerationId(pending.genId) && validPendingChatId(pending.chatId)
      && pending.accountScope === pendingAccountScope()
      ? pending
      : null;
  } catch { return null; }
}
function clearPendingGen() {
  try { localStorage.removeItem(PENDING_GEN_KEY); } catch {}
}

let syncInFlight = null;
let syncInFlightGenId = null;
let syncRetryTimer = null;
let syncRetryAttempt = 0;
let syncAbortController = null;

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

  // The connection can drop after the partial response is already on
  // screen. The sync endpoint resends every chunk from the start; only the
  // row tagged for this generation is removed before rebuilding it, to
  // avoid a second visual response with the same content.
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
  let syncFailed = false;
  let syncFailureMessage = "";
  const stalePromptIds = new Set();
  const controller = new AbortController();
  syncAbortController = controller;
  currentAbortController = controller;
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
    if (!validGenerationId(genId)) return false;
    const res = await fetch(`${BACKEND_URL}/chat/sync/${encodeURIComponent(genId)}`, {
      headers: BoreasSessionHeaders(),
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok) throw await boreasHttpError(res);

    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    const MAX_SYNC_SSE_BUFFER = 8 * 1024 * 1024;
    const MAX_SYNC_RESPONSE_CHARS = 8 * 1024 * 1024;
    const syncByteEncoder = new TextEncoder();
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      if (!value || value.byteLength > MAX_SYNC_SSE_BUFFER - syncByteEncoder.encode(buffer).byteLength) {
        await reader.cancel().catch(() => {});
        throw new Error("Resposta de sincronização excedeu o limite de 8 MB");
      }
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
        if (chunk.type === "sync_truncated") {
          syncFailed = true;
          syncFailureMessage = String(chunk.message || "A resposta não pôde ser reconstruída integralmente.");
          continue;
        }
        if (chunk.type === "ask_user_prompt_stale" && chunk.promptId) { stalePromptIds.add(String(chunk.promptId)); continue; }
        if (chunk.type === "gen_id" || chunk.type === "heartbeat" || chunk.type === "token_exhausted") continue;
        if (chunk.type === "file" && chunk.name) { ensureRow(); masterCol.appendChild(createFileCard(chunk.name, chunk.data, chunk.mime)); msgAttachments.push({ type: "file", name: chunk.name, data: chunk.data, mime: chunk.mime }); scrollToBottom(); continue; }
        if (chunk.type === "deep_research") { ensureRow(); renderDeepResearchCard(masterCol, chunk); if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "deep_research"), { ...chunk }]; continue; }
        if (chunk.type === "agentic_loop") { ensureRow(); renderAgenticLoopCard(masterCol, chunk); if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "agentic_loop"), { ...chunk }]; continue; }
        if (chunk.type === "image_generation") {
          ensureRow(); renderImageGenerationCard(masterCol, chunk);
          if (chunk.status === "ready" || chunk.status === "failed") {
            msgAttachments = [
              ...msgAttachments.filter(a => !(a.type === "generated_image" && a.image_id === chunk.image_id)),
              { type: "generated_image", image_id: chunk.image_id, status: chunk.status, aspect_ratio: chunk.aspect_ratio, width: chunk.width, height: chunk.height, is_edit: chunk.is_edit },
            ];
          }
          continue;
        }
        // Um ask_user_prompt já sinalizado como stale (respondido/expirado
        // em outra reconexão ou já resolvido no servidor) vira só um recap
        // somente-leitura - sem isso, cada reconexão (focus/pageshow/online
        // disparam uma) reabria um novo card interativo aguardando resposta
        // para a MESMA pergunta, empilhando cards órfãos a cada vez que a
        // página saía e voltava do foco.
        if (chunk.type === "ask_user_prompt" && stalePromptIds.has(String(chunk.promptId))) {
          ensureRow();
          renderAskUserPromptRecap(masterCol, { questions: chunk.questions, answers: null, timedOut: true });
          msgAttachments.push({ type: "ask_user_prompt", promptId: chunk.promptId, questions: chunk.questions, answers: null, timedOut: true });
          continue;
        }
        if (chunk.type === "ask_user_prompt") { ensureRow(); const _aupAns = await renderAskUserPromptCard(masterCol, chunk.promptId, chunk.questions); msgAttachments.push({ type: "ask_user_prompt", promptId: chunk.promptId, questions: chunk.questions, answers: _aupAns ?? null, timedOut: !_aupAns }); continue; }
        if (chunk.type === "step") {
          ensureRow(); responseBubble = null; segmentReply = "";
          ensureToolActivityCard(masterCol, chunk, activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
          if (chunk.output !== undefined && chunk.output !== "") {
            showInlineToolResult(masterCol, chunk.id, chunk.tool, chunk.output, responseBubble, chunk.value);
          }
          scrollToBottom(); continue;
        }
        if (chunk.type === "sources") { ensureRow(); masterCol.appendChild(createSourcesButton(chunk.results)); continue; }
        if (chunk.type === "error") {
          syncFailed = true;
          syncFailureMessage = String(chunk.message || "Falha na geração.");
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          ensureRow();
          ensureThinkingSegment(activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
          appendThinkingSegment(activity, delta.reasoning_content);
        }
        if (delta?.content) {
          if (reply.length + String(delta.content).length > MAX_SYNC_RESPONSE_CHARS) throw new Error("Resposta de sincronização grande demais");
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
    // O replay de sync nunca monta os botões de ação (copiar/tentar
    // novamente) porque, ao contrário do streaming ao vivo, não passa pelo
    // trecho que os cria junto com a bolha. Sem isso a mensagem sincronizada
    // fica sem copiar/retry até a página ser recarregada do zero.
    if (masterCol && !syncFailed && !syncMissing && (responseBubble || msgAttachments.length) && !masterCol.querySelector(".msg-actions")) {
      const actions = document.createElement("div"); actions.className = "msg-actions";
      const copyBtn = document.createElement("button"); copyBtn.className = "msg-action-btn";
      copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar`;
      copyBtn.addEventListener("click", () => copyText(responseBubble?._rawText ?? reply ?? "", copyBtn));
      const regenBtn = document.createElement("button"); regenBtn.className = "msg-action-btn msg-regenerate-btn";
      regenBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.27"/></svg> Tentar novamente`;
      regenBtn.addEventListener("click", () => regenerate(masterRow, responseBubble, actions));
      actions.appendChild(copyBtn); actions.appendChild(regenBtn);
      masterCol.appendChild(actions);
    }
    if (syncFailed) {
      masterRow?.remove();
      clearPendingGen();
      appendMessage("bot", `Erro: ${syncFailureMessage || "A resposta não pôde ser reconstruída."}`);
      return false;
    }
    if (syncMissing) {
      clearPendingGen();
      if (!reply && !msgAttachments.length) appendMessage("bot", "A geração não está mais disponível. Tente enviar a mensagem novamente.");
      return false;
    }
    if (sawDone || syncMissing) clearPendingGen();
    if (reply || msgAttachments.length) {
      // Dedupe by genId rather than text equality, since the reconstructed
      // reply can differ slightly from the original render.
      const alreadyAppended = (previousAssistant?.genId === genId) || messages.some(m => m.role === "assistant" && m.genId === genId);
      if (alreadyAppended) {
        masterRow?.remove();
      } else {
        messages.push({ role: "assistant", content: reply, ...(msgAttachments.length ? { attachments: msgAttachments } : {}), genId });
      }
      saveCurrentMessages();
      updateRegenerateAvailability();
      if (responseBubble) responseBubble._rawText = reply;
    }
  } catch (e) {
    if (e.name === "AbortError" && userStoppedGeneration) return false;
    if (getPendingGen()?.genId === genId) {
      showSyncBanner(genId);
      schedulePendingSync(genId);
    } else {
      ensureRow();
      appendMessage("bot", "Não foi possível sincronizar agora. Tente de novo em instantes.");
    }
  } finally {
    if (syncAbortController === controller) syncAbortController = null;
    if (currentAbortController === controller) currentAbortController = null;
    loading = false; hideStopBtn(); currentGenId = null;
    if (userStoppedGeneration) userStoppedGeneration = false;
  }
}

function startElapsedTicker(getBubbleEl, startTime) {
  const intervalId = setInterval(() => {
    const b = getBubbleEl();
    if (!b || !b.innerHTML.includes("Em trabalho")) return;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    b.innerHTML = `<span class="work-status-label">Em trabalho</span><span class="work-status-elapsed">${elapsed}s</span><span style="display:inline-flex;gap:3px;margin-left:6px;vertical-align:middle"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
  }, 1000);
  return () => clearInterval(intervalId); // stop() - idempotente
}

// No server chunk at all (not even "gen_id") within this window means the
// generation stalled before it even started. Aborts and lets the user
// retry, instead of waiting for the fetch's generic 90s timeout.
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

// The send button always reverts to the official PNG after "stop" mode.
// Stop mode keeps using the inline square, a separate state.
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
  if (loading && (currentAbortController || syncAbortController)) {
    userStoppedGeneration = true;
    try { currentAbortController?.abort(); } catch {}
    try { syncAbortController?.abort(); } catch {}

    if (currentGenId) {
      fetch(`${BACKEND_URL}/chat/stop`, {
        method: "POST",
        headers: BoreasSessionHeaders({ "Content-Type": "application/json" }),
        credentials: "include",
        body: JSON.stringify({ genId: currentGenId }),
        keepalive: true,
      }).catch(() => {});
    }
    clearPendingGen();
  } else if (!loading) {
    send();
  }
});
