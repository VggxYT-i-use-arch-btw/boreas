// Boreas — streaming, renderização, envio e regeneração.

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

function showSyncBanner(genId) {
  document.getElementById("resume-banner")?.remove();
  document.getElementById("sync-banner")?.remove();
  const banner = document.createElement("div");
  banner.id = "sync-banner";
  banner.className = "resume-banner-el";
  banner.innerHTML = `<span>🔌 Conexão perdida — a resposta pode ter continuado sendo gerada.</span><button id="sync-btn">Sincronizar ↻</button>`;
  messagesEl.appendChild(banner);
  scrollToBottom();
  document.getElementById("sync-btn").addEventListener("click", () => syncGeneration(genId));
}

async function syncGeneration(genId) {
  document.getElementById("sync-banner")?.remove();
  loading = true; showStopBtn();
  currentGenId = genId;

  let masterRow = null, masterCol = null, responseBubble = null;
  let reply = "", segmentReply = "";
  let msgAttachments = [];
  function ensureRow() {
    if (!masterRow) {
      removeTyping();
      masterRow = document.createElement("div"); masterRow.className = "msg-row bot";
      const avatar = document.createElement("div"); avatar.className = "avatar";
      avatar.innerHTML = `<img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" style="width:42px;height:42px;object-fit:contain;opacity:0.95" draggable="false">`;
      masterCol = document.createElement("div"); masterCol.className = "bot-col"; masterCol.style.gap = "4px";
      masterRow.appendChild(avatar); masterRow.appendChild(masterCol);
      messagesEl.appendChild(masterRow);
    }
  }

  try {
    const res = await fetch(`${BACKEND_URL}/chat/sync/${genId}`, {
      headers: { "x-session-id": localStorage.getItem("boreas_session_id") ?? "" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim(); if (raw === "[DONE]") continue;
        let chunk; try { chunk = JSON.parse(raw); } catch { continue; }

        if (chunk.type === "sync_missing") {

          continue;
        }
        if (chunk.type === "gen_id" || chunk.type === "heartbeat" || chunk.type === "token_exhausted") continue;
        if (chunk.type === "file" && chunk.name) { ensureRow(); masterCol.appendChild(createFileCard(chunk.name, chunk.data, chunk.mime)); msgAttachments.push({ type: "file", name: chunk.name, data: chunk.data, mime: chunk.mime }); scrollToBottom(); continue; }
        if (chunk.type === "deep_research") { ensureRow(); renderDeepResearchCard(masterCol, chunk); if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "deep_research"), { ...chunk }]; continue; }
        if (chunk.type === "agentic_loop") { ensureRow(); renderAgenticLoopCard(masterCol, chunk); if (chunk.done) msgAttachments = [...msgAttachments.filter(a => a.type !== "agentic_loop"), { ...chunk }]; continue; }
        if (chunk.type === "ask_user_prompt") { ensureRow(); const _aupAns = await renderAskUserPromptCard(masterCol, chunk.promptId, chunk.questions); msgAttachments.push({ type: "ask_user_prompt", promptId: chunk.promptId, questions: chunk.questions, answers: _aupAns ?? null, timedOut: !_aupAns }); continue; }
        if (chunk.type === "step") {
          ensureRow(); responseBubble = null; segmentReply = "";
          ensureToolActivityCard(masterCol, chunk);
          scrollToBottom(); continue;
        }
        if (chunk.type === "sources") { ensureRow(); masterCol.appendChild(createSourcesButton(chunk.results)); continue; }
        if (chunk.type === "error") { ensureRow(); appendMessage("bot", `Erro: ${chunk.message}`); continue; }

        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          ensureRow();
          reply += delta.content;
          segmentReply += delta.content;
          if (!responseBubble) { responseBubble = document.createElement("div"); responseBubble.className = "bubble bot"; masterCol.appendChild(responseBubble); }
          renderStreamingMarkdown(responseBubble, segmentReply);
          scrollToBottom();
        }
      }
    }

    finishStreamingMarkdown(responseBubble);
    clearPendingGen();
    if (reply || msgAttachments.length) {
      messages.push({ role: "assistant", content: reply, ...(msgAttachments.length ? { attachments: msgAttachments } : {}) });
      saveCurrentMessages();
      updateRegenerateAvailability();
      if (responseBubble) responseBubble._rawText = reply;
    }
  } catch (e) {

    ensureRow();
    appendMessage("bot", "Não foi possível sincronizar agora. Tente de novo em instantes.");
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

function createSourcesButton(sources) {
  const wrap = document.createElement("div");
  wrap.className = "sources-btn-wrap";

  const btn = document.createElement("button");
  btn.className = "msg-action-btn";
  btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Fontes`;

  const dropdown = document.createElement("div");
  dropdown.className = "sources-dropdown";
  const titleEl = document.createElement("div");
  titleEl.className = "sources-dropdown-title"; titleEl.textContent = "Pesquisa na web";
  dropdown.appendChild(titleEl);

  sources.forEach(s => {
    const a = document.createElement("a");
    a.className = "sources-link"; a.href = s.url; a.target = "_blank"; a.rel = "noopener noreferrer";
    try {
      const ico = document.createElement("img");
      ico.src = s.favicon ?? `https://www.google.com/s2/favicons?domain=${new URL(s.url).hostname}&sz=32`;
      ico.onerror = () => { ico.style.display = "none"; };
      a.appendChild(ico);
    } catch {}
    const lbl = document.createElement("span"); lbl.textContent = s.title || s.url;
    a.appendChild(lbl);
    dropdown.appendChild(a);
  });

  let closeHandler = null;
  btn.addEventListener("click", e => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle("open");
    if (isOpen) {
      closeHandler = ev => {
        if (!wrap.contains(ev.target)) { dropdown.classList.remove("open"); document.removeEventListener("pointerdown", closeHandler); }
      };
      setTimeout(() => document.addEventListener("pointerdown", closeHandler), 10);
    } else if (closeHandler) {
      document.removeEventListener("pointerdown", closeHandler);
    }
  });

  wrap.appendChild(dropdown);
  wrap.appendChild(btn);
  return wrap;
}

if (typeof DOMPurify !== 'undefined') {
  // Normaliza os atributos target e rel dos links para manter a navegação segura.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('target')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

if (typeof marked !== 'undefined') {
  const renderer = new marked.Renderer();
  const _origLink = renderer.link.bind(renderer);
  renderer.link = (href, title, text) => {
    const html = _origLink(href, title, text);
    return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
  };
  renderer.code = (code, lang) => {
    const language = (lang && typeof hljs !== 'undefined' && hljs.getLanguage(lang)) ? lang : 'plaintext';
    const highlighted = (typeof hljs !== 'undefined')
      ? hljs.highlight(code, { language }).value
      : code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
  };
  marked.use({
    gfm: true,
    breaks: false,
    renderer,
  });
}

function _sanitizeMarkdownHtml(rawHtml) {
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target', 'rel'] });
  }
  return rawHtml;
}

function _renderMarkdownBlockHtml(text) {
  if (typeof marked !== 'undefined') {
    return _sanitizeMarkdownHtml(marked.parse(text));
  }
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// Static/history renderer. This is intentionally separate from the live
// renderer below: history can afford one complete parse because it happens
// once per message, not once per token.
function renderMarkdown(el, text) {
  try {
    el.innerHTML = _renderMarkdownBlockHtml(text);
    _queueMathRender(el);
  } catch(e) {
    el.textContent = text;
  }
}

function _parseMarkdownFragment(text) {
  const holder = document.createElement('div');
  holder.innerHTML = _renderMarkdownBlockHtml(text);
  const nodes = Array.from(holder.childNodes);
  return nodes;
}

function _queueMathRenderNode(node) {
  if (typeof renderMathInElement === 'undefined' || !node?.isConnected) return;
  const run = () => {
    if (!node.isConnected || !node.textContent?.match(/\$|\\\(|\\\[/)) return;
    try {
      renderMathInElement(node, {
        delimiters: [
          {left:"$$",right:"$$",display:true},
          {left:"$",right:"$",display:false},
          {left:"\\(",right:"\\)",display:false},
          {left:"\\[",right:"\\]",display:true}
        ],
        throwOnError: false
      });
    } catch {}
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 180 });
  else setTimeout(run, 32);
}

function _looksLikeMarkdown(text) {
  return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~)|[*_`\[\]\\$]/.test(text);
}

function _stripOpenFenceForLiveCode(text) {
  const first = text.match(/^\s*(```+|~~~+)\s*([^\n]*)\n?/);
  if (!first) return null;
  const marker = first[1][0];
  const lines = text.split('\n');
  let closing = -1;
  for (let i = 1; i < lines.length; i++) {
    if (new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[i])) { closing = i; break; }
  }
  const codeLines = closing >= 0 ? lines.slice(1, closing) : lines.slice(1);
  return { language: first[2].trim(), code: codeLines.join('\n'), closed: closing >= 0 };
}

function createStreamingMarkdownRenderer(el) {
  // Live renderer: prioritize latency and incremental DOM work. The response
  // is append-only, so never re-parse text that has already been painted.
  const state = {
    el,
    source: '',
    stableSource: '',
    activeNodes: [],
    queued: false,
    raf: 0,
    lastPaint: 0,
    fence: null,
    scanPos: 0,
    stableEnd: 0,
    finished: false,
    plainNode: null,
    plainStart: 0,
    plainRenderedLength: 0,
  };

  const clearActive = () => {
    for (const node of state.activeNodes) node.remove();
    state.activeNodes = [];
    state.plainNode = null;
  };

  const appendNodes = (nodes, queueMath = true) => {
    for (const node of nodes) {
      state.el.appendChild(node);
      if (queueMath && node.nodeType === 1) _queueMathRenderNode(node);
    }
  };

  // Find the last complete Markdown block without rescanning the prefix.
  // A block becomes immutable after a blank line outside a fenced code block.
  const scanForStableBoundary = () => {
    let i = state.scanPos;
    let lineStart = i;
    let boundary = state.stableEnd;
    let fence = state.fence;
    const src = state.source;

    while (i < src.length) {
      const nl = src.indexOf('\n', i);
      if (nl < 0) break;
      const line = src.slice(lineStart, nl);
      const fenceMatch = line.match(/^\s*(```+|~~~+)/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!fence) fence = marker;
        else if (fence === marker) fence = null;
      }
      if (!fence && line.trim() === '') boundary = nl + 1;
      i = nl + 1;
      lineStart = i;
    }

    state.scanPos = lineStart;
    state.fence = fence;
    state.stableEnd = boundary;
  };

  const commitStable = () => {
    scanForStableBoundary();
    if (state.stableEnd <= state.stableSource.length) return;

    const newlyStable = state.source.slice(state.stableSource.length, state.stableEnd);
    // The active tail is replaced, but committed nodes are never touched.
    clearActive();
    appendNodes(_parseMarkdownFragment(newlyStable));
    state.stableSource = state.source.slice(0, state.stableEnd);
    state.plainStart = state.stableEnd;
    state.plainRenderedLength = 0;
  };

  const paint = (force = false) => {
    state.queued = false;
    state.raf = 0;
    state.lastPaint = performance.now();

    commitStable();

    const tail = state.source.slice(state.stableSource.length);
    if (!tail) return;

    // Fast path for ordinary prose. Append only the newly received suffix to
    // one Text node: no Markdown parser, sanitizer, DOM replacement or layout
    // churn for every token.
    if (!_looksLikeMarkdown(tail) && !state.fence) {
      if (!state.plainNode || state.plainStart > state.source.length) {
        clearActive();
        state.plainNode = document.createTextNode('');
        state.el.appendChild(state.plainNode);
        state.activeNodes = [state.plainNode];
        state.plainStart = state.stableSource.length;
        state.plainRenderedLength = 0;
      }
      const wanted = state.source.slice(state.plainStart);
      const delta = wanted.slice(state.plainRenderedLength);
      if (delta) {
        state.plainNode.appendData(delta);
        state.plainRenderedLength = wanted.length;
      }
      return;
    }

    // If Markdown syntax is active, only the current unfinished tail is
    // parsed. Previously committed blocks remain untouched.
    clearActive();

    const liveCode = _stripOpenFenceForLiveCode(tail);
    if (liveCode && !liveCode.closed) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      const lang = liveCode.language && typeof hljs !== 'undefined' && hljs.getLanguage(liveCode.language)
        ? liveCode.language : 'plaintext';
      code.className = `hljs language-${lang}`;
      code.textContent = liveCode.code;
      pre.appendChild(code);
      state.el.appendChild(pre);
      state.activeNodes = [pre];
      return;
    }

    const nodes = _parseMarkdownFragment(tail);
    appendNodes(nodes);
    state.activeNodes = nodes;
  };

  const schedule = () => {
    if (state.finished || state.queued) return;
    state.queued = true;
    const now = performance.now();
    const elapsed = now - state.lastPaint;
    // Never intentionally hold a visible token batch for a long time.  A
    // frame is the normal path; the 45 ms ceiling protects streaming latency
    // even when frames are busy.
    if (elapsed >= 45) {
      // If the browser has been busy for a while, do not add another frame of
      // latency: paint this small batch now.
      paint();
    } else {
      state.raf = requestAnimationFrame(() => paint());
    }
  };

  state.update = text => {
    if (state.finished) return;
    if (typeof text !== 'string') text = String(text ?? '');
    if (text === state.source) return;
    // The stream is append-only. If a caller supplies a shorter string, keep
    // correctness by resetting only the active tail, never the whole history.
    if (text.length < state.source.length || !text.startsWith(state.source)) {
      state.source = text;
      state.stableSource = '';
      state.scanPos = 0;
      state.stableEnd = 0;
      state.fence = null;
      clearActive();
      state.el.textContent = '';
      state.plainStart = 0;
      state.plainRenderedLength = 0;
    } else {
      state.source = text;
    }
    schedule();
  };

  state.finish = () => {
    if (state.finished) return;
    state.finished = true;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.queued = false;

    // Paint the latest tail immediately, but only that tail. This is a flush,
    // not a complete-message render.
    commitStable();
    clearActive();
    const tail = state.source.slice(state.stableSource.length);
    if (tail) {
      appendNodes(_parseMarkdownFragment(tail));
    }
  };

  return state;
}

function renderStreamingMarkdown(el, text) {
  if (!el._streamRenderer) el._streamRenderer = createStreamingMarkdownRenderer(el);
  el._streamRenderer.update(text);
}

function finishStreamingMarkdown(el) {
  el?._streamRenderer?.finish();
}

// Cópia estática do TOOL_META (as outras instâncias são locais às funções de
// streaming) só pra reconstruir a timeline de steps a partir do histórico
// salvo, fora de qualquer stream ao vivo.
const TOOL_META_STATIC = { WEB_SEARCH: { icon: "🔍" }, WEB_FETCH: { icon: "🌐" }, BASH: { icon: "💻" }, DELETE: { icon: "🗑️" }, STR_REPLACE: { icon: "✏️" }, SEND_FILE: { icon: "📎" }, CREATE_FILE: { icon: "📄" }, MEMORY: { icon: "🧠" }, PREFERENCES: { icon: "⚙️" }, ASK_USER: { icon: "❓" }, CALCULATOR: { icon: "🧮" }, GRAPH: { icon: "📊" }, FORWARD_MESSAGE: { icon: "🚀" }, USE_PLUGIN: { icon: "🧩" }, DEEP_RESEARCH: { icon: "🔬" }, AGENTIC_LOOP: { icon: "🔁" }, IMAGE_SEARCH: { icon: "🔍" }, PRESENT_IMAGE: { icon: "🖼️" }, VIEW_CHATS: { icon: "🗂️" }, CURRENCY: { icon: "💱" } };

// Mantém as ferramentas sensíveis como cartões fixos para não expor texto interno na interface.
const PLUGIN_LABELS = { web_search: "Busca na Web", deep_thinking: "Pensamento Aprofundado", study: "Modo Estudo" };
function isBadgeOnlyTool(tool) { return tool === "FORWARD_MESSAGE" || tool === "USE_PLUGIN"; }
function taskItemLabel(tool, value, hasOutput) {
  if (tool === "FORWARD_MESSAGE") return hasOutput ? `Ativou: Boreas ${value || "?"}` : "Escalando modelo…";
  if (tool === "USE_PLUGIN") return hasOutput ? `Ativou: ${PLUGIN_LABELS[value] ?? value}` : `Ativando: ${PLUGIN_LABELS[value] ?? value}…`;
  return value;
}

// Preenche o corpo (expandido) de um task-item. Compartilhada por todos os
// pontos de renderização (histórico, stream ao vivo, regeneração) - GRAPH é
// especial e desenha um gráfico de verdade via Chart.js a partir do JSON
// devolvido pelo backend; qualquer outra tool cai no par cmd/output em <pre>
// de sempre. Idempotente: pode ser chamada de novo no mesmo body (ex.
// quando o resultado final chega depois do "pendente") que ela reconstrói.
// Monta o card visual (galeria de imagens / câmbio / gráfico) a partir do
// output de uma tool - usado tanto no acordeão "Processo de pensamento"
// quanto (via showInlineToolResult) direto na mensagem. Retorna null se a
// tool não tem representação visual ou o JSON não é o esperado.
function buildToolResultVisual(tool, output, value) {
  if (!output) return null;
  if (tool === "CALCULATOR") {
    // Renderiza a saída textual da calculadora como um cartão simples, sem esperar JSON.
    const lines = String(output).split("\n").filter(Boolean);
    if (!lines.length) return null;
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-top:4px;padding:16px 18px;border-radius:16px;background:var(--surface);border:1px solid var(--border);max-width:320px";
    if (value) {
      const label = document.createElement("div");
      label.style.cssText = "font-size:12px;color:var(--text-dim);margin-bottom:6px;font-family:monospace";
      label.textContent = value;
      wrap.appendChild(label);
    }
    lines.forEach((line, i) => {
      const row = document.createElement("div");
      row.style.cssText = i === 0
        ? "font-size:19px;font-weight:700;color:var(--text);word-break:break-word"
        : "font-size:12px;color:var(--text-faint);margin-top:6px;word-break:break-word";
      row.textContent = line;
      wrap.appendChild(row);
    });
    return wrap;
  }
  if (tool === "PRESENT_IMAGE") {
    try {
      const spec = JSON.parse(output);
      const imgs = Array.isArray(spec.images) ? spec.images : [];
      if (!imgs.length) return null;
      const wrap = document.createElement("div");
      wrap.style.cssText = "margin-top:4px";
      if (spec.caption) {
        const cap = document.createElement("div");
        cap.style.cssText = "font-size:12px;color:var(--text-dim);margin-bottom:6px";
        cap.textContent = spec.caption;
        wrap.appendChild(cap);
      }
      const gallery = document.createElement("div");
      gallery.style.cssText = "display:flex;gap:10px;overflow-x:auto;padding:2px 2px 6px";
      imgs.forEach(im => {
        const card = document.createElement("a");
        card.href = im.source_url || im.url;
        card.target = "_blank";
        card.rel = "noopener noreferrer";
        card.title = im.description || im.domain || "";
        card.style.cssText = "position:relative;flex:0 0 auto;width:200px;height:150px;border-radius:14px;overflow:hidden;display:block;background:var(--surface);border:1px solid var(--border)";
        const img = document.createElement("img");
        img.src = im.url; img.loading = "lazy"; img.alt = im.description || im.domain || "";
        img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
        const pill = document.createElement("span");
        pill.style.cssText = "position:absolute;left:8px;bottom:8px;display:flex;align-items:center;gap:5px;background:rgba(20,20,20,.72);backdrop-filter:blur(6px);color:#fff;font-size:11px;padding:5px 9px;border-radius:999px;max-width:calc(100% - 16px);overflow:hidden";
        if (im.domain) {
          const fav = document.createElement("img");
          fav.src = `https://www.google.com/s2/favicons?domain=${im.domain}&sz=32`;
          fav.style.cssText = "width:12px;height:12px;border-radius:2px;flex-shrink:0";
          pill.appendChild(fav);
        }
        const domainSpan = document.createElement("span");
        domainSpan.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        domainSpan.textContent = im.domain || "imagem";
        pill.appendChild(domainSpan);
        card.appendChild(img); card.appendChild(pill);
        gallery.appendChild(card);
      });
      wrap.appendChild(gallery);
      return wrap;
    } catch (e) { return null; }
  }
  if (tool === "CURRENCY") {
    try {
      const spec = JSON.parse(output);
      const sym = c => ({ USD: "$", EUR: "€", GBP: "£", JPY: "¥", BRL: "R$" }[c] ?? (c + " "));
      const fmt = (n, c) => sym(c) + Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const wrap = document.createElement("div");
      wrap.style.cssText = "margin-top:4px;padding:16px 18px;border-radius:16px;background:var(--surface);border:1px solid var(--border);max-width:320px";
      const label = document.createElement("div");
      label.style.cssText = "font-size:12px;color:var(--text-dim);margin-bottom:6px";
      label.textContent = "Câmbio";
      const main = document.createElement("div");
      main.style.cssText = "font-size:21px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px;flex-wrap:wrap";
      main.textContent = `${fmt(spec.amount, spec.from)} → ${fmt(spec.result, spec.to)}`;
      const sub = document.createElement("div");
      sub.style.cssText = "font-size:12px;color:var(--text-faint);margin-top:8px";
      const dateTxt = spec.date ? ` · atualizado em ${new Date(spec.date).toLocaleDateString("pt-BR")}` : "";
      sub.textContent = `1 ${spec.from} = ${Number(spec.rate).toLocaleString("pt-BR", { maximumFractionDigits: 6 })} ${spec.to}${dateTxt}`;
      wrap.appendChild(label); wrap.appendChild(main); wrap.appendChild(sub);
      return wrap;
    } catch (e) { return null; }
  }
  if (tool === "GRAPH") {
    try {
      const spec = JSON.parse(output);
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative;width:100%;max-width:480px;height:280px;margin-top:4px";
      const canvas = document.createElement("canvas");
      wrap.appendChild(canvas);
      if (!window.Chart) return null;
      // Adia a criação do gráfico até o container estar no DOM e visível, para o Chart.js medir o tamanho correto.
      requestAnimationFrame(() => {
        if (!canvas.isConnected) return;
        new Chart(canvas.getContext("2d"), {
          type: spec.chart_type || "bar",
          data: spec.data,
          options: Object.assign(
            { responsive: true, maintainAspectRatio: false,
              plugins: { title: { display: !!spec.title, text: spec.title || "" }, legend: { display: (spec.data?.datasets?.length ?? 0) > 1 } } },
            spec.options || {}
          ),
        });
      });
      return wrap;
    } catch (e) { return null; }
  }
  return null;
}
// Mostra o resultado visual de uma tool direto na mensagem do modelo (não
// só escondido dentro do acordeão "Processo de pensamento" - era o que o
// usuário reportava: precisava clicar pra ver gráfico/câmbio/imagens).
// container: onde inserir (masterCol/col). before: elemento pra inserir
// antes dele (normalmente o responseBubble), ou null pra ir no final.
// _shownIds evita duplicar o card se o mesmo step atualizar de novo.
const _inlineToolShown = new WeakMap();
function showInlineToolResult(container, stepId, tool, output, before, value) {
  if (!container || !stepId) return;
  let shown = _inlineToolShown.get(container);
  if (!shown) { shown = new Set(); _inlineToolShown.set(container, shown); }
  if (shown.has(stepId)) return;
  const visual = buildToolResultVisual(tool, output, value);
  if (!visual) return;
  shown.add(stepId);
  if (before && before.parentNode === container) container.insertBefore(visual, before);
  else container.appendChild(visual);
}
function renderStepBody(body, tool, value, output) {
  body.innerHTML = "";
  const visual = buildToolResultVisual(tool, output, value);
  if (visual) { body.appendChild(visual); return; }
  const cmdEl = document.createElement("pre"); cmdEl.className = "task-cmd"; cmdEl.textContent = value;
  const outEl = document.createElement("pre"); outEl.className = "task-output"; outEl.textContent = output;
  body.appendChild(cmdEl); body.appendChild(outEl);
}

function appendMessage(role, content, imageB64, msgIndex, attachments, thinking, steps, activity) {
  const emptyEl = document.getElementById("empty");
  if (emptyEl) emptyEl.remove();

  const row = document.createElement("div");
  row.className = `msg-row ${role}`;
  if (role === "bot" && Number.isInteger(msgIndex)) row._msgIndex = msgIndex;

  if (role === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.innerHTML = `<img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" style="width:42px;height:42px;object-fit:contain;opacity:0.95" draggable="false">`;
    row.appendChild(avatar);
  }

  const col = role === "bot" ? document.createElement("div") : null;
  if (col) col.className = "bot-col";

  // Reconstrói a pill "Executando" com a timeline de task-items (tool calls
  // individuais, cada um clicável/expansível com input+output) a partir do
  // histórico salvo - mesma estrutura DOM que o streaming ao vivo monta,
  // só que sem o estado "em progresso". Sem isso os steps só existiam
  // durante a sessão em que foram gerados e sumiam no reload.
  // Timeline única de "Processo de pensamento": um só botão que expande pra
  // uma sequência cronológica real (raciocínio + cada tool call, na ordem
  // em que aconteceram) - antes eram duas pills separadas (thinking-pill +
  // tasks-pill com "N etapas"), o que ficava feio e redundante. Também
  // Preserva a ordem cronológica real das chamadas, em vez de agrupar por tipo de ferramenta.
  const hasThinking = typeof thinking === "string" && thinking.trim();
  const hasSteps = Array.isArray(steps) && steps.length;
  if (false && col && (hasThinking || hasSteps)) {
    const pill = document.createElement("button");
    pill.className = "tasks-pill";
    pill.innerHTML = `<span style="flex-shrink:0;display:flex;align-items:center;color:rgba(154,212,240,0.85)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66z"/></svg></span>Processo de pensamento<svg class="pill-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    const detail = document.createElement("div");
    detail.className = "tasks-detail";
    pill.addEventListener("click", () => { pill.classList.toggle("expanded"); detail.classList.toggle("visible"); });

    if (hasThinking) {
      const taskEl = document.createElement("div"); taskEl.className = "task-item task-item-think";
      const hdr = document.createElement("div"); hdr.className = "task-item-header expandable";
      const iSpan = document.createElement("span"); iSpan.className = "task-item-icon"; iSpan.textContent = "💭";
      const lSpan = document.createElement("span"); lSpan.className = "task-item-label"; lSpan.textContent = "Raciocínio";
      const chev = document.createElement("span"); chev.className = "task-item-chevron";
      chev.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
      hdr.appendChild(iSpan); hdr.appendChild(lSpan); hdr.appendChild(chev);
      const body = document.createElement("div"); body.className = "task-item-body";
      const outEl = document.createElement("pre"); outEl.className = "task-output"; outEl.textContent = thinking;
      body.appendChild(outEl);
      taskEl.appendChild(hdr); taskEl.appendChild(body);
      hdr.addEventListener("click", () => taskEl.classList.toggle("expanded"));
      detail.appendChild(taskEl);
    }

    if (hasSteps) {
      steps.forEach(s => {
        const meta = TOOL_META_STATIC[s.tool] ?? { icon: "🔧" };
        const hasOutput = (s.output !== undefined && s.output !== "") && !isBadgeOnlyTool(s.tool);
        const taskEl = document.createElement("div"); taskEl.className = "task-item";
        const hdr = document.createElement("div"); hdr.className = "task-item-header" + (hasOutput ? " expandable" : "");
        const iSpan = document.createElement("span"); iSpan.className = "task-item-icon"; iSpan.innerHTML = meta.icon;
        const lSpan = document.createElement("span"); lSpan.className = "task-item-label"; lSpan.textContent = taskItemLabel(s.tool, s.value, s.output !== undefined && s.output !== "");
        hdr.appendChild(iSpan); hdr.appendChild(lSpan);
        if (hasOutput) {
          const chev = document.createElement("span"); chev.className = "task-item-chevron";
          chev.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
          hdr.appendChild(chev);
          const body = document.createElement("div"); body.className = "task-item-body";
          renderStepBody(body, s.tool, s.value, s.output);
          taskEl.appendChild(hdr); taskEl.appendChild(body);
          hdr.addEventListener("click", () => taskEl.classList.toggle("expanded"));
        } else { taskEl.appendChild(hdr); }
        // Sem agrupar por tipo de tool - cada item vai direto na ordem em
        // que a tool foi chamada, preservando a sequência real.
        detail.appendChild(taskEl);
      });
    }

    col.appendChild(pill); col.appendChild(detail);
  }

  // Novo formato persistido: cada segmento de raciocínio e cada tool ocupa
  // seu próprio lugar na conversa. Para chats antigos, reconstruímos a mesma
  // separação com o thinking agregado e os steps conhecidos.
  if (col) {
    const sequence = Array.isArray(activity) && activity.length
      ? activity
      : [
          ...(hasThinking ? [{ type: "thinking", text: thinking }] : []),
          ...(hasSteps ? steps.map(s => ({ type: "tool", ...s })) : []),
        ];
    sequence.forEach(item => {
      if (item?.type === "thinking" && String(item.text ?? "").trim()) {
        const state = {};
        ensureThinkingSegment(state, (pill, detail) => { col.appendChild(pill); col.appendChild(detail); });
        appendThinkingSegment(state, String(item.text));
        finalizeThinkingSegment(state);
      } else if (item?.type === "tool") {
        ensureToolActivityCard(col, item);
      }
    });
  }

  // Reconstrói, a partir do histórico salvo, os cards de deep research/loop
  // agêntico e os arquivos mandados nessa resposta - sem isso eles somem
  // ao reabrir a conversa (só o texto puro sobrevive).
  if (col && Array.isArray(attachments) && attachments.length) {
    attachments.forEach(a => {
      if (a.type === "file") col.appendChild(createFileCard(a.name, a.data, a.mime));
      else if (a.type === "deep_research") renderDeepResearchCard(col, { title: a.title, step: 5, done: true });
      else if (a.type === "agentic_loop") renderAgenticLoopCard(col, { plan: a.plan, percent: a.percent, stage: a.stage, summary: a.summary, done: true, converged: a.converged });
      else if (a.type === "ask_user_prompt") renderAskUserPromptRecap(col, { questions: a.questions, answers: a.answers, timedOut: a.timedOut });
    });
  }

  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;

  const images = Array.isArray(imageB64) ? imageB64.filter(Boolean) : (imageB64 ? [imageB64] : []);
  if (images.length) {
    const grid = document.createElement("div");
    grid.className = "bubble-image-grid";
    images.forEach(src => {
      const img = document.createElement("img");
      img.src = src;
      img.addEventListener("click", e => { e.stopPropagation(); openLightbox(src); });
      grid.appendChild(img);
    });
    bubble.appendChild(grid);
  }

  if (role === "bot" && content) renderMarkdown(bubble, content);
  else if (content) {

    const FILE_RE = /^\[Arquivo: (.+?)\]\n```[^\n]*\n([\s\S]*?)\n```([\s\S]*)$/;
    const fileMatch = content.match(FILE_RE);
    if (fileMatch && role === "user") {
      const [, fname, fcontent, remainder] = fileMatch;
      const chip = document.createElement("div"); chip.className = "file-chip";
      chip.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span class="file-chip-name">📄 ${escHtml(fname)}</span><svg class="file-chip-chevron" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
      const body = document.createElement("div"); body.className = "file-chip-body";
      body.textContent = fcontent.slice(0, 4000) + (fcontent.length > 4000 ? "\n…(truncado)" : "");
      chip.addEventListener("click", () => { chip.classList.toggle("open"); body.classList.toggle("open"); });
      bubble.appendChild(chip); bubble.appendChild(body);
      const rest = remainder.trim();
      if (rest) { const span = document.createElement("span"); span.style.display = "block"; span.style.marginTop = "6px"; span.textContent = rest; bubble.appendChild(span); }
    } else {
      const mentionRe = new RegExp("^@(" + PLUGINS.map(p => p.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ") (.*)$", "s");
      const mentionMatch = role === "user" && content.match(mentionRe);
      const mentionPlugin = mentionMatch && PLUGINS.find(p => p.label === mentionMatch[1]);
      if (mentionPlugin) {
        const badge = document.createElement("span");
        badge.className = "msg-mention-badge";
        badge.innerHTML = `${mentionPlugin.icon}${escHtml(mentionPlugin.label)}`;
        bubble.appendChild(badge);
        if (mentionMatch[2]) {
          const rest = document.createElement("span");
          rest.textContent = " " + mentionMatch[2];
          bubble.appendChild(rest);
        }
      } else {
        const span = document.createElement("span"); span.textContent = content; bubble.appendChild(span);
      }
    }
  }

  if (role === "bot") {
    col.appendChild(bubble);
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-action-btn";
    copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar`;
    // Usa ?? para preservar mensagens vazias e evitar ler o DOM por engano.
    copyBtn.addEventListener("click", () => copyText(bubble._rawText ?? "", copyBtn));
    const regenBtn = document.createElement("button");
    regenBtn.className = "msg-action-btn msg-regenerate-btn";
    regenBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.27"/></svg> Tentar novamente`;
    regenBtn.addEventListener("click", () => regenerate(row, bubble, actions));
    actions.appendChild(copyBtn); actions.appendChild(regenBtn);
    col.appendChild(actions); row.appendChild(col);
  } else {

    row._msgIndex = msgIndex ?? (messages.length - 1);
    row._images = images;
    row.appendChild(bubble);

    let userPressTimer;
    row.addEventListener("pointerdown", e => {

      userPressTimer = setTimeout(() => {
        showUserCtxMenu(e.clientX, e.clientY, row, content, row._images);
      }, 350);
    });
    row.addEventListener("contextmenu", e => {
      e.preventDefault();
      clearTimeout(userPressTimer);
      showUserCtxMenu(e.clientX, e.clientY, row, content, row._images);
    });
    ["pointerup", "pointercancel", "pointermove"].forEach(ev =>
      row.addEventListener(ev, () => clearTimeout(userPressTimer))
    );
  }

  messagesEl.appendChild(row);
  scrollToBottom();
  bubble._rawText = content || "";
  return bubble;
}

// Só a resposta que ocupa o último slot do histórico pode ser regenerada.
// O servidor repete essa validação com o chat persistido; esta camada existe
// para manter o histórico visual coerente e não oferecer ações antigas.
function updateRegenerateAvailability() {
  const rows = [...messagesEl.querySelectorAll(".msg-row.bot")];
  const latestIndex = messages.length - 1;
  const allowed = messages.at(-1)?.role === "assistant";
  rows.forEach((row, index) => {
    row.querySelectorAll(".msg-regenerate-btn").forEach(btn => {
      const isLatest = allowed && index === rows.length - 1 && row._msgIndex === latestIndex;
      btn.hidden = !isLatest;
      btn.disabled = !isLatest;
      btn.setAttribute("aria-hidden", String(!isLatest));
    });
  });
}

function canRetryFromUserRow(userRow) {
  const index = userRow?._msgIndex;
  return Number.isInteger(index)
    && messages.at(-1)?.role === "assistant"
    && messages[index]?.role === "user"
    && index === messages.length - 2;
}

function showUserCtxMenu(x, y, userRow, text, images) {
  document.getElementById("user-ctx-menu-el")?.remove();
  const menu = document.createElement("div");
  menu.className = "user-ctx-menu"; menu.id = "user-ctx-menu-el";
  menu.style.left = Math.max(10, Math.min(x, window.innerWidth - 214)) + "px";
  menu.style.top  = Math.max(10, Math.min(y, window.innerHeight - 154)) + "px";

  const retryItem = canRetryFromUserRow(userRow) ? `
    <div class="user-ctx-item" id="uctx-retry">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.27"/></svg>
      Tentar novamente
    </div>` : "";
  menu.innerHTML = `${retryItem}
    <div class="user-ctx-item" id="uctx-copy">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      Copiar
    </div>
    <div class="user-ctx-item" id="uctx-edit">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Editar
    </div>`;
  document.body.appendChild(menu);

  document.getElementById("uctx-retry")?.addEventListener("click", () => {
    menu.remove();
    retryFromUser(userRow);
  });
  document.getElementById("uctx-copy").addEventListener("click", () => {
    menu.remove();
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;opacity:0;top:0;left:0;pointer-events:none";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
  });
  document.getElementById("uctx-edit").addEventListener("click", () => {
    menu.remove();
    editUserMessage(userRow, text, images);
  });

  const closeCtx = ev => {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("pointerdown", closeCtx); }
  };
  setTimeout(() => document.addEventListener("pointerdown", closeCtx), 10);
}

function editUserMessage(userRow, text, images) {
  if (loading) return;

  const msgIdx = userRow._msgIndex ?? 0;
  messages.splice(msgIdx);
  saveCurrentMessages();

  // Recuar o cursor de memória faz a próxima atualização reprocessar o trecho removido.
  const idAtEdit = localStorage.getItem(ACTIVE_KEY);
  if (idAtEdit && _chatsMeta[idAtEdit] && (_chatsMeta[idAtEdit].memoryProcessedUpTo ?? 0) > msgIdx) {
    _chatsMeta[idAtEdit].memoryProcessedUpTo = msgIdx;
  }

  const allRows = [...messagesEl.querySelectorAll(".msg-row")];
  const rowIdx = allRows.indexOf(userRow);
  for (let i = allRows.length - 1; i >= rowIdx; i--) allRows[i].remove();

  msgInput.value = text;
  msgInput.dispatchEvent(new Event("input"));
  msgInput.focus();

  pendingImages = Array.isArray(images) ? images.slice(0, MAX_IMAGES) : (images ? [images] : []);
  renderPreviewThumbs();

  if (!messagesEl.querySelector(".msg-row")) {
    messagesEl.innerHTML = `<div class="empty-state" id="empty">
      <img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" class="empty-logo-img" alt="Boreas" draggable="false">
      <span class="empty-text"></span>
    </div>`;
    setGreeting();
  }
}

async function retryFromUser(userRow) {
  if (loading || !canRetryFromUserRow(userRow)) return;
  autoScroll = true; updateScrollBtn();
  const msgIdx = userRow._msgIndex ?? 0;

  messages.splice(msgIdx + 1);

  // Usa a mesma leitura segura de texto aplicada em editUserMessage.
  const idAtRetry = localStorage.getItem(ACTIVE_KEY);
  if (idAtRetry && _chatsMeta[idAtRetry] && (_chatsMeta[idAtRetry].memoryProcessedUpTo ?? 0) > msgIdx + 1) {
    _chatsMeta[idAtRetry].memoryProcessedUpTo = msgIdx + 1;
  }

  const allRows = [...messagesEl.querySelectorAll(".msg-row")];
  const rowIdx  = allRows.indexOf(userRow);
  for (let i = allRows.length - 1; i > rowIdx; i--) allRows[i].remove();

  const BOT_IMG_SRC = "https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png";
  const fakeRow    = document.createElement("div"); fakeRow.className = "msg-row bot";
  fakeRow._msgIndex = msgIdx + 1;
  fakeRow._isRetryOfUser = true;
  const fakeAvatar = document.createElement("div"); fakeAvatar.className = "avatar";
  fakeAvatar.innerHTML = `<img src="${BOT_IMG_SRC}" style="width:42px;height:42px;object-fit:contain;opacity:0.95" draggable="false">`;
  const fakeCol     = document.createElement("div"); fakeCol.className = "bot-col";
  const fakeBubble  = document.createElement("div"); fakeBubble.className = "bubble bot";
  fakeBubble.innerHTML = `<div class="typing-dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
  const fakeActions = document.createElement("div"); fakeActions.className = "msg-actions"; fakeActions.style.opacity = "0";
  fakeCol.appendChild(fakeBubble); fakeCol.appendChild(fakeActions);
  fakeRow.appendChild(fakeAvatar); fakeRow.appendChild(fakeCol);
  messagesEl.appendChild(fakeRow);
  scrollToBottom();

  await regenerate(fakeRow, fakeBubble, fakeActions);
}

const DR_STEP_TITLES = [
  "Entender a tarefa",
  "Definir objetivos e restrições",
  "Coletar fontes",
  "Verificar e comparar evidências",
  "Escrever resposta final",
];
const DR_CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
// Botão "expandir" nos cards de pesquisa/loop - some as linhas de etapa param
// de truncar com "..." e mostram o texto completo do plano.
const DR_EXPAND_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

function renderDeepResearchCard(col, chunk) {
  if (!col) return;
  let card = col.querySelector(".dr-card");
  if (!card) {
    card = document.createElement("div"); card.className = "dr-card";
    const stepsHtml = DR_STEP_TITLES.map((label, i) => `
      <div class="dr-step" data-step="${i + 1}">
        <span class="dr-step-icon"></span>
        <span class="dr-step-text">${label}</span>
      </div>`).join("");
    card.innerHTML = `
      <div class="dr-card-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a2 2 0 0 1 2-2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M14 2v5h5M9 13h6M9 17h6"/></svg>
        <span class="dr-card-title-text">Pesquisa Aprofundada</span>
      </div>
      <div class="dr-card-steps">${stepsHtml}</div>
      <div class="dr-card-current"></div>
      <button type="button" class="dr-expand-btn" aria-label="Expandir">${DR_EXPAND_ICON}</button>`;
    card.querySelector(".dr-expand-btn").addEventListener("click", () => card.classList.toggle("expanded"));
    col.appendChild(card);
  }

  if (chunk.title) card.querySelector(".dr-card-title-text").textContent = chunk.title;

  const activeStep = Math.max(0, Math.min(5, chunk.step ?? 0));
  card.querySelectorAll(".dr-step").forEach(stepEl => {
    const n = Number(stepEl.dataset.step);
    const icon = stepEl.querySelector(".dr-step-icon");
    stepEl.classList.remove("active", "done");
    if (n < activeStep || chunk.done) { stepEl.classList.add("done"); icon.innerHTML = DR_CHECK_ICON; }
    else if (n === activeStep && !chunk.done) { stepEl.classList.add("active"); icon.innerHTML = ""; }
    else { icon.innerHTML = ""; }
  });

  const currentEl = card.querySelector(".dr-card-current");
  if (chunk.done) {
    currentEl.innerHTML = `<span class="dr-card-done-msg">Pesquisa aprofundada concluída</span>`;
  } else if (chunk.label) {
    currentEl.innerHTML = `<b>Boreas:</b> ${(chunk.label ?? "").replace(/</g, "&lt;")}`;
  }
  scrollToBottom();
}

const AL_STAGE_TITLES = [
  "Início",
  "Pensamento",
  "Execução",
  "Avaliação e correção",
  "Toques finais",
];

// Enquete do modelo (tool ask_user_prompt) - card interativo inline, resolve
// quando o usuário responde tudo (single-select submete na hora; multi-select
// tem botão "Confirmar"). O generation no servidor fica pausado esperando o
// POST em /prompt-response/:id até 5min.
// Enquete do modelo (tool ask_user_prompt) - estilo "card do Claude": uma
// pergunta por vez com contador "N de M", opções em lista numerada, X pra
// pular tudo, e um campo de resposta livre pra quando nenhuma opção serve.
// Contrato com o servidor não muda: resolve mandando POST /prompt-response/:id
// com { answers }, um item por pergunta (string, array de strings, ou null
// se a pergunta foi pulada/expirou).
function renderAskUserPromptCard(col, promptId, questions) {
  return new Promise(resolve => {
    let card, answers, qi = 0, settled = false;
    try {
      card = document.createElement("div");
      card.className = "aup-card";
      answers = new Array(questions.length).fill(null);
    } catch (e) {
      console.error("[aup] falha ao montar o card:", e);
      resolve();
      return;
    }

    // Rede de segurança: se algo travar silenciosamente no meio do fluxo
    // (erro de DOM, race de render), não deixa o stream inteiro preso -
    // desiste depois de 5min e manda tudo como "não respondido", igual o
    // timeout que o servidor já aplica no /prompt-response.
    const safetyTimer = setTimeout(() => {
      console.warn("[aup] safety timeout — resolvendo sem resposta");
      finish();
    }, 300000);

    async function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      try {
        card.classList.add("answered");
        card.innerHTML = "";
        const done = document.createElement("div");
        done.className = "aup-done";
        done.textContent = "Respondido";
        card.appendChild(done);
      } catch (e) { console.error("[aup] falha ao fechar o card:", e); }
      const sessionId = localStorage.getItem("boreas_session_id") || "";
      try {
        await fetch(BACKEND_URL + "/prompt-response/" + promptId, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-session-id": sessionId },
          body: JSON.stringify({ answers }),
        });
      } catch (e) { console.error("[aup] falha ao enviar resposta:", e); }
      resolve(answers);
    }

    function advance() {
      if (qi < questions.length - 1) { qi++; renderQuestion(); scrollToBottom(); }
      else finish();
    }

    function renderQuestion() {
      card.innerHTML = "";
      const q = questions[qi];
      const isMulti = !!q.multi;

      const header = document.createElement("div"); header.className = "aup-header";
      const counter = document.createElement("span"); counter.className = "aup-counter";
      counter.textContent = questions.length > 1 ? `${qi + 1} de ${questions.length}` : "";
      const closeBtn = document.createElement("button");
      closeBtn.type = "button"; closeBtn.className = "aup-close"; closeBtn.setAttribute("aria-label", "Fechar");
      closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      closeBtn.addEventListener("click", finish);
      header.appendChild(counter); header.appendChild(closeBtn);
      card.appendChild(header);

      const qText = document.createElement("div"); qText.className = "aup-question-text"; qText.textContent = q.question;
      card.appendChild(qText);

      const list = document.createElement("div"); list.className = "aup-list";
      (q.options || []).forEach((opt, oi) => {
        const row = document.createElement("button");
        row.type = "button"; row.className = "aup-row";
        const badge = document.createElement("span"); badge.className = "aup-badge"; badge.textContent = String(oi + 1);
        const label = document.createElement("span"); label.className = "aup-row-label"; label.textContent = opt;
        row.appendChild(badge); row.appendChild(label);
        row.addEventListener("click", () => {
          if (isMulti) {
            row.classList.toggle("selected");
            const sel = Array.from(list.querySelectorAll(".aup-row.selected")).map(r => r.querySelector(".aup-row-label").textContent);
            answers[qi] = sel;
            confirmBtn.disabled = !sel.length;
          } else {
            list.querySelectorAll(".aup-row").forEach(r => r.disabled = true);
            answers[qi] = opt;
            advance();
          }
        });
        list.appendChild(row);
      });
      card.appendChild(list);

      let confirmBtn = null;
      if (isMulti) {
        confirmBtn = document.createElement("button");
        confirmBtn.type = "button"; confirmBtn.className = "aup-confirm-btn"; confirmBtn.textContent = "Confirmar";
        confirmBtn.disabled = true;
        confirmBtn.addEventListener("click", advance);
        card.appendChild(confirmBtn);
      } else {
        const inputRow = document.createElement("div"); inputRow.className = "aup-input-row";
        const input = document.createElement("input");
        input.type = "text"; input.className = "aup-input"; input.placeholder = "Digite sua própria resposta...";
        const sendBtn = document.createElement("button");
        sendBtn.type = "button"; sendBtn.className = "aup-send-btn";
        sendBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
        function submitFree() {
          const v = input.value.trim();
          if (!v) return;
          list.querySelectorAll(".aup-row").forEach(r => r.disabled = true);
          input.disabled = true; sendBtn.disabled = true;
          answers[qi] = v;
          advance();
        }
        sendBtn.addEventListener("click", submitFree);
        input.addEventListener("keydown", e => { if (e.key === "Enter") submitFree(); });
        inputRow.appendChild(input); inputRow.appendChild(sendBtn);
        card.appendChild(inputRow);
      }
    }

    try {
      renderQuestion();
      col.appendChild(card);
      scrollToBottom();
    } catch (e) {
      console.error("[aup] falha ao renderizar a pergunta:", e);
      clearTimeout(safetyTimer);
      resolve();
    }
  });
}

// Reconstrói uma enquete (ask_user_prompt) já respondida a partir do
// histórico salvo - versão somente-leitura, sem botões, pra não deixar
// o card sumir ao reabrir a conversa.
function renderAskUserPromptRecap(col, { questions, answers, timedOut }) {
  const card = document.createElement("div");
  card.className = "aup-card answered";
  if (timedOut || !Array.isArray(answers)) {
    const done = document.createElement("div");
    done.className = "aup-done";
    done.textContent = "Não respondido a tempo";
    card.appendChild(done);
  } else {
    (questions || []).forEach((q, i) => {
      const row = document.createElement("div"); row.className = "aup-recap-row";
      const qEl = document.createElement("div"); qEl.className = "aup-question-text"; qEl.textContent = q.question;
      const aVal = answers[i];
      const aEl = document.createElement("div"); aEl.className = "aup-recap-answer";
      aEl.textContent = Array.isArray(aVal) ? aVal.join(", ") : (aVal ?? "(sem resposta)");
      row.appendChild(qEl); row.appendChild(aEl);
      card.appendChild(row);
    });
  }
  col.appendChild(card);
}

// "Pensamento adicional" - depois que o modelo usa pelo menos uma tool,
// qualquer reasoning_content seguinte vira um item colapsável DENTRO da
// timeline de "Executando" (mesma mecânica dos task-items de tool), em vez
// de continuar empilhando no pill "Em trabalho" do topo. Cada nova rodada de
// pensamento após uma tool vira um item novo - o "step" handler chama
// closeExtraThink() pra fechar o item atual assim que uma tool nova roda.
function ensureExtraThinkItem(stepsDetail, state) {
  if (state.el) return state;
  state.text = "";
  const taskEl = document.createElement("div"); taskEl.className = "task-item task-item-think expandable";
  const hdr = document.createElement("div"); hdr.className = "task-item-header expandable";
  const iSpan = document.createElement("span"); iSpan.className = "task-item-icon"; iSpan.innerHTML = "💭";
  const lSpan = document.createElement("span"); lSpan.className = "task-item-label"; lSpan.textContent = "Raciocínio";
  const chev = document.createElement("span"); chev.className = "task-item-chevron";
  chev.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  hdr.appendChild(iSpan); hdr.appendChild(lSpan); hdr.appendChild(chev);
  const body = document.createElement("div"); body.className = "task-item-body";
  const outEl = document.createElement("pre"); outEl.className = "task-output";
  body.appendChild(outEl);
  taskEl.appendChild(hdr); taskEl.appendChild(body);
  hdr.addEventListener("click", () => taskEl.classList.toggle("expanded"));
  // Direto no final da timeline, sem agrupar por seção - preserva a ordem
  // cronológica real (raciocínio intercalado com as tools, na sequência
  // em que aconteceram), em vez de empurrar tudo pra uma seção "THINKING"
  // separada do resto.
  stepsDetail.appendChild(taskEl);
  state.el = taskEl; state.outEl = outEl;
  return state;
}
// Cria (uma vez) a pill única "Processo de pensamento" + a timeline abaixo
// dela, usada tanto pra raciocínio quanto pra tool calls - substitui as duas
// pills separadas (thinking-pill + tasks-pill "N tarefas") que existiam
// antes em cada função de streaming.
function ensureActivityPill(state, mountFn) {
  if (state.pill) return state;
  state.pill = document.createElement("button"); state.pill.className = "tasks-pill";
  state.pill.innerHTML = `<span style="flex-shrink:0;display:flex;align-items:center;color:rgba(154,212,240,0.85)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66z"/></svg></span>Processo de pensamento<span class="tp-dots"><span></span><span></span><span></span></span><svg class="pill-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  state.detail = document.createElement("div"); state.detail.className = "tasks-detail";
  state.pill.addEventListener("click", () => { state.pill.classList.toggle("expanded"); state.detail.classList.toggle("visible"); });
  mountFn(state.pill, state.detail);
  return state;
}
// Tira os pontinhos de "em andamento" quando a geração termina.
function finalizeActivityPill(state) {
  if (!state.pill) return;
  const dots = state.pill.querySelector(".tp-dots");
  if (dots) dots.remove();
}
function appendExtraThink(stepsDetail, state, delta) {
  ensureExtraThinkItem(stepsDetail, state);
  state.text += delta;
  state.outEl.textContent = state.text;
}
function closeExtraThink(state) { state.el = null; state.outEl = null; state.text = ""; }

// Novo renderer: reasoning e tools são segmentos independentes. A pill de
// pensamento nunca recebe task-items; cada tool fica em um cartão inline.
function ensureThinkingSegment(state, mountFn) {
  if (state.pill) return state;
  state.pill = document.createElement("button");
  state.pill.type = "button";
  state.pill.className = "thinking-segment-pill";
  state.pill.innerHTML = `<span class="thinking-segment-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66z"/></svg></span><span>Processo de pensamento</span><span class="thinking-segment-status">Pensando</span><svg class="thinking-segment-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  state.detail = document.createElement("div"); state.detail.className = "thinking-segment-detail";
  state.textEl = document.createElement("div"); state.textEl.className = "thinking-segment-text";
  state.detail.appendChild(state.textEl);
  state.pill.addEventListener("click", () => { state.pill.classList.toggle("expanded"); state.detail.classList.toggle("visible"); });
  mountFn(state.pill, state.detail);
  return state;
}
function appendThinkingSegment(state, delta) {
  state.text = (state.text ?? "") + delta;
  if (state.textEl) state.textEl.textContent = state.text;
}
function finalizeThinkingSegment(state) {
  if (!state?.pill) return;
  state.pill.classList.add("is-complete");
  const status = state.pill.querySelector(".thinking-segment-status");
  if (status) status.textContent = "Concluído";
}
function closeThinkingSegment(state) {
  finalizeThinkingSegment(state);
  if (!state) return;
  state.pill = null; state.detail = null; state.textEl = null; state.text = "";
}

const TOOL_ACTIVITY_LABELS = {
  WEB_SEARCH: "Pesquisando na web", WEB_FETCH: "Lendo fonte", BASH: "Executando no sandbox",
  DELETE: "Removendo arquivo", STR_REPLACE: "Editando arquivo", SEND_FILE: "Preparando arquivo",
  CREATE_FILE: "Criando arquivo", MEMORY: "Atualizando memória", PREFERENCES: "Atualizando preferências",
  ASK_USER: "Aguardando sua resposta", CALCULATOR: "Calculando", GRAPH: "Criando gráfico",
  FORWARD_MESSAGE: "Escalando modelo", USE_PLUGIN: "Ativando recurso", IMAGE_SEARCH: "Buscando imagens",
  PRESENT_IMAGE: "Mostrando imagens", VIEW_CHATS: "Consultando conversas", CURRENCY: "Consultando câmbio",
  DEEP_RESEARCH: "Pesquisando profundamente", AGENTIC_LOOP: "Executando plano",
};
function toolActivityLabel(tool, value) {
  const label = TOOL_ACTIVITY_LABELS[tool] ?? "Usando ferramenta";
  const detail = String(value ?? "").trim();
  return { label, detail: detail.length > 110 ? `${detail.slice(0, 107)}…` : detail };
}
function updateToolActivityCard(card, tool, value, output) {
  const { label, detail } = toolActivityLabel(tool, value);
  card.dataset.tool = tool ?? "";
  card.querySelector(".tool-activity-title").textContent = label;
  card.querySelector(".tool-activity-value").textContent = detail;
  const done = output !== undefined;
  card.classList.toggle("is-done", done);
  card.querySelector(".tool-activity-status").textContent = done ? "Concluído" : "Executando";
  const body = card._body;
  body.innerHTML = "";
  if (!done) return;
  const visual = buildToolResultVisual(tool, output, value);
  if (visual) body.appendChild(visual);
  else {
    const out = document.createElement("pre"); out.className = "tool-activity-output";
    out.textContent = String(output ?? "").slice(0, 5000); body.appendChild(out);
  }
  card.classList.toggle("has-details", !!body.childNodes.length);
}
function ensureToolActivityCard(container, step) {
  if (!container || !step) return null;
  const id = step.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (!container._toolActivityCards) container._toolActivityCards = new Map();
  let card = container._toolActivityCards.get(id);
  if (!card) {
    card = document.createElement("div"); card.className = "tool-activity-card";
    card.innerHTML = `<button type="button" class="tool-activity-header"><span class="tool-activity-icon"></span><span class="tool-activity-copy"><span class="tool-activity-title"></span><span class="tool-activity-value"></span></span><span class="tool-activity-status">Executando</span><svg class="tool-activity-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>`;
    card._body = document.createElement("div"); card._body.className = "tool-activity-body"; card.appendChild(card._body);
    card.querySelector(".tool-activity-icon").textContent = TOOL_META_STATIC[step.tool]?.icon ?? "🔧";
    card.querySelector(".tool-activity-header").addEventListener("click", () => card.classList.toggle("expanded"));
    container._toolActivityCards.set(id, card); container.appendChild(card);
  }
  updateToolActivityCard(card, step.tool, step.value, step.output);
  return card;
}

function renderAgenticLoopCard(col, chunk) {
  if (!col) return;
  let card = col.querySelector(".al-card");
  if (!card) {
    card = document.createElement("div"); card.className = "al-card dr-card";
    const stepsHtml = AL_STAGE_TITLES.map((label, i) => `
      <div class="dr-step" data-step="${i + 1}">
        <span class="dr-step-icon"></span>
        <span class="dr-step-text"><b>${label}</b></span>
      </div>`).join("");
    card.innerHTML = `
      <div class="dr-card-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        <span class="dr-card-title-text">Loop Agêntico</span>
        <span class="al-card-percent"></span>
      </div>
      <div class="dr-card-steps">${stepsHtml}</div>
      <div class="dr-card-current"></div>
      <button type="button" class="dr-expand-btn" aria-label="Expandir">${DR_EXPAND_ICON}</button>`;
    card.querySelector(".dr-expand-btn").addEventListener("click", () => card.classList.toggle("expanded"));
    card._plan = null;
    col.appendChild(card);
  }

  // O modelo escreve, na primeira chamada, uma descrição concreta por etapa
  // (baseada no objetivo real) - guarda no card pra sobreviver a updates
  // futuros que não reenviem o plano.
  if (Array.isArray(chunk.plan) && chunk.plan.length) card._plan = chunk.plan;

  const percentEl = card.querySelector(".al-card-percent");
  if (percentEl && typeof chunk.percent === "number") percentEl.textContent = `${chunk.percent}%`;

  const activeStage = Math.max(0, Math.min(5, chunk.stage ?? 0));
  card.querySelectorAll(".dr-step").forEach(stepEl => {
    const n = Number(stepEl.dataset.step);
    const icon = stepEl.querySelector(".dr-step-icon");
    const textEl = stepEl.querySelector(".dr-step-text");
    const planLine = card._plan?.[n - 1];
    textEl.innerHTML = planLine
      ? `<b>${AL_STAGE_TITLES[n - 1]}:</b> ${String(planLine).replace(/</g, "&lt;")}`
      : `<b>${AL_STAGE_TITLES[n - 1]}</b>`;
    stepEl.classList.remove("active", "done");
    if (n < activeStage || (chunk.done && chunk.converged !== false)) { stepEl.classList.add("done"); icon.innerHTML = DR_CHECK_ICON; }
    else if (n === activeStage && !chunk.done) { stepEl.classList.add("active"); icon.innerHTML = ""; }
    else { icon.innerHTML = ""; }
  });

  const currentEl = card.querySelector(".dr-card-current");
  if (chunk.done && chunk.converged === false) {
    currentEl.innerHTML = `<span class="dr-card-done-msg" style="color:#e08a8a">Não convergiu a tempo — parou sem atingir 100%.</span>`;
  } else if (chunk.done) {
    currentEl.innerHTML = `<span class="dr-card-done-msg">Objetivo alcançado</span>`;
  } else if (chunk.summary) {
    currentEl.innerHTML = `<b>Boreas:</b> ${(chunk.summary ?? "").replace(/</g, "&lt;")}`;
  }

  // Segurança: o card é a fonte de verdade de "terminou ou não" - se o
  // evento chegou marcado como done, garante que o botão de stop volte ao
  // normal mesmo que a promise original que abriu esse fetch tenha ficado
  // presa numa conexão que caiu (comum em long-poll atrás de proxy/túnel).
  if (chunk.done) { loading = false; hideStopBtn(); }

  scrollToBottom();
}

function showTyping() {
  const row = document.createElement("div");
  row.className = "msg-row bot"; row.id = "typing-row";
  const avatar = document.createElement("div"); avatar.className = "avatar";
  avatar.innerHTML = `<img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" style="width:42px;height:42px;object-fit:contain;opacity:0.95" draggable="false">`;
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
            ensureToolActivityCard(col, chunk);
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
            reply += cd; currentBubbleText += cd; renderStreamingMarkdown(responseBubble, currentBubbleText);
            responseBubble._rawText = currentBubbleText;
            scrollToBottom(); await new Promise(r => setTimeout(r, 0));
          }
        } catch (parseErr) { /* SSE inválida — ignorar */ }
      }
    }

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
    tryUpdateMemory();
  }
}

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

  const displayContent = imagesSnapshot.length ? (text || "") : (typeof userContent === "string" ? userContent : text);
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

    const BRAIN_ICON = `<span style="flex-shrink:0;display:flex;align-items:center;color:rgba(154,212,240,0.85)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66z"/></svg></span>`;
    const CHEVRON = `<svg class="pill-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    const DOTS = `<span style="display:inline-flex;gap:3px;margin-left:2px"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
    const BOT_IMG = `<img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" style="width:42px;height:42px;object-fit:contain;opacity:0.95" draggable="false">`;

    function ensureMasterRow() {
      if (!masterRow) {
        removeTyping();
        masterRow = document.createElement("div"); masterRow.className = "msg-row bot"; masterRow._msgIndex = messages.length;
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
            console.warn(`⚠️ Token HF esgotado no servidor — ${chunk.remaining}/${chunk.total} restantes.`);
            continue;
          }

          if (chunk.type === "step") {
            hasUsedTool = true; closeExtraThink(extraThinkState);
            closeThinkingSegment(activity);
            clearTimeout(thinkingTimer);
            ensureMasterRow();
            masterCol.querySelectorAll(".msg-actions").forEach(el => el.remove());
            responseBubble = null; currentBubbleText = "";
            ensureToolActivityCard(masterCol, chunk);
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
            reply += contentDelta; currentBubbleText += contentDelta; renderStreamingMarkdown(responseBubble, currentBubbleText);
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
          if (cd2) { reply += cd2; if (responseBubble) renderStreamingMarkdown(responseBubble, reply); }
        } catch {}
      }
    }
    finalizeThinkingSegment(activity);
    finishStreamingMarkdown(responseBubble);

    removeTyping();

    if (!responseBubble && reply) {
      ensureMasterRow();
      responseBubble = document.createElement("div"); responseBubble.className = "bubble bot";
      renderStreamingMarkdown(responseBubble, reply);
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
    tryUpdateMemory();
  }
}

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
  if (loading || !messages.length || messages[messages.length - 1].role !== "user") return;

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
      headers: { "Content-Type": "application/json", "x-session-id": localStorage.getItem("boreas_session_id") ?? "" },
      body: JSON.stringify({ tier: currentTier, speed: currentSpeed, effort: currentEffort, messages, chatId: localStorage.getItem(ACTIVE_KEY), name: localStorage.getItem("boreas_name") ?? "", use: localStorage.getItem("boreas_use") ?? "", chatMemoryEnabled, plugin: pluginOverride }), // Envia chatId, nome e uso para o servidor salvar a conversa e personalizar o contexto.
    });
    clearTimeout(thinkingTimer); clearTimeout(_resumeTimeout);
    if (!res.ok) { throw new Error(`HTTP ${res.status}`); }

    const reader = res.body.getReader(); const decoder = new TextDecoder();
    let reply = "", reasoning = "", buffer = "";
    let msgAttachments = [];
    let pendingSourcesR = null;
    const activity = {};
    let stepsCount = 0;
  let hasUsedTool = false; const extraThinkState = {};
    let responseBubble = null;

    const BRAIN_ICON = `<span style="flex-shrink:0;display:flex;align-items:center;color:rgba(154,212,240,0.85)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66z"/></svg></span>`;
    const CHEVRON = `<svg class="pill-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    const DOTS = `<span style="display:inline-flex;gap:3px;margin-left:2px"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></span>`;
    const BOT_IMG = `<img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" style="width:42px;height:42px;object-fit:contain;opacity:0.95" draggable="false">`;

    function ensureMasterRowR() {
      if (!masterRow) {
        removeTyping();
        masterRow = document.createElement("div"); masterRow.className = "msg-row bot";
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
        try {
          const chunk = JSON.parse(raw);
          if (chunk.type === "gen_id") {

            currentGenId = chunk.id;
            savePendingGen(chunk.id, localStorage.getItem(ACTIVE_KEY));
            stopNoResponseWatchdog();
            continue;
          }
          if (chunk.type === "file" && chunk.name) {
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
            console.warn(`⚠️ Token HF esgotado no servidor — ${chunk.remaining}/${chunk.total} restantes.`);
            continue;
          }
          if (chunk.type === "step") {
            hasUsedTool = true; closeExtraThink(extraThinkState);
            closeThinkingSegment(activity);
            clearTimeout(thinkingTimer);
            ensureMasterRowR();
            masterCol.querySelectorAll(".msg-actions").forEach(el => el.remove());
            responseBubble = null;
            ensureToolActivityCard(masterCol, chunk);
            scrollToBottom(); continue;
            ensureThinkingSegment(activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
            const stepsDetail = activity.detail;
            const TOOL_META_R = { WEB_SEARCH: { icon: "🔍" }, WEB_FETCH: { icon: "🌐" }, BASH: { icon: "💻" }, DELETE: { icon: "🗑️" }, STR_REPLACE: { icon: "✏️" }, SEND_FILE: { icon: "📎" }, CREATE_FILE: { icon: "📄" }, MEMORY: { icon: "🧠" }, PREFERENCES: { icon: "⚙️" }, ASK_USER: { icon: "❓" }, CALCULATOR: { icon: "🧮" }, GRAPH: { icon: "📊" }, FORWARD_MESSAGE: { icon: "🚀" }, USE_PLUGIN: { icon: "🧩" }, IMAGE_SEARCH: { icon: "🔍" }, PRESENT_IMAGE: { icon: "🖼️" }, VIEW_CHATS: { icon: "🗂️" }, CURRENCY: { icon: "💱" } };
            const metaR = TOOL_META_R[chunk.tool] ?? { icon: "🔧" };
            const rawHasOutputR = chunk.output !== undefined && chunk.output !== "";
            const hasOutputR = rawHasOutputR && !isBadgeOnlyTool(chunk.tool);
            if (!stepsDetail._byId) stepsDetail._byId = {};

            if (chunk.id && stepsDetail._byId[chunk.id]) {
              const exR = stepsDetail._byId[chunk.id];
              exR.lSpan.textContent = taskItemLabel(chunk.tool, chunk.value, rawHasOutputR);
              if (hasOutputR) {
                exR.iSpan.textContent = metaR.icon;
                exR.hdr.classList.add("expandable");
                if (!exR.hdr.querySelector(".task-item-chevron")) {
                  const chevR = document.createElement("span"); chevR.className = "task-item-chevron";
                  chevR.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
                  exR.hdr.appendChild(chevR);
                }
                let bodyR = exR.taskEl.querySelector(".task-item-body");
                if (!bodyR) {
                  bodyR = document.createElement("div"); bodyR.className = "task-item-body";
                  renderStepBody(bodyR, chunk.tool, chunk.value, chunk.output);
                  exR.taskEl.appendChild(bodyR);
                  exR.hdr.addEventListener("click", () => exR.taskEl.classList.toggle("expanded"));
                } else {
                  renderStepBody(bodyR, chunk.tool, chunk.value, chunk.output);
                }
                showInlineToolResult(masterCol, chunk.id, chunk.tool, chunk.output, responseBubble, chunk.value);
              }
              scrollToBottom(); continue;
            }

            stepsCount++;
            const taskElR = document.createElement("div"); taskElR.className = "task-item";
            const hdrR = document.createElement("div");
            hdrR.className = "task-item-header" + (hasOutputR ? " expandable" : "");
            const iSpanR = document.createElement("span"); iSpanR.className = "task-item-icon";
            iSpanR.innerHTML = hasOutputR ? metaR.icon : `<span class="thinking-dot" style="background:currentColor"></span>`;
            const lSpanR = document.createElement("span"); lSpanR.className = "task-item-label"; lSpanR.textContent = taskItemLabel(chunk.tool, chunk.value, rawHasOutputR);
            hdrR.appendChild(iSpanR); hdrR.appendChild(lSpanR);
            if (hasOutputR) {
              const chevR = document.createElement("span"); chevR.className = "task-item-chevron";
              chevR.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
              hdrR.appendChild(chevR);
              const bodyR = document.createElement("div"); bodyR.className = "task-item-body";
              renderStepBody(bodyR, chunk.tool, chunk.value, chunk.output);
              taskElR.appendChild(hdrR); taskElR.appendChild(bodyR);
              hdrR.addEventListener("click", () => taskElR.classList.toggle("expanded"));
              showInlineToolResult(masterCol, chunk.id, chunk.tool, chunk.output, responseBubble, chunk.value);
            } else { taskElR.appendChild(hdrR); }
            // Direto no fim da timeline - sem agrupar por tipo de tool.
            stepsDetail.appendChild(taskElR);
            if (chunk.id) stepsDetail._byId[chunk.id] = { taskEl: taskElR, hdr: hdrR, lSpan: lSpanR, iSpan: iSpanR };
            scrollToBottom(); continue;
          }

          if (chunk.type === "error") {
            clearTimeout(thinkingTimer); removeTyping(); ensureMasterRowR();
            const eb = document.createElement("div"); eb.className = "bubble bot";
            eb.textContent = `Erro: ${chunk.message}`;
            masterCol.appendChild(eb); continue;
          }

          if (chunk.type === "sources" && chunk.results?.length) {
            pendingSourcesR = chunk.results;
            continue;
          }

          const delta = chunk.choices?.[0]?.delta ?? {};
          const rd = delta.reasoning_content ?? "", cd = delta.content ?? "";
          if (rd) {
            reasoning += rd; ensureMasterRowR();
            ensureThinkingSegment(activity, (pill, detail) => { masterCol.appendChild(pill); masterCol.appendChild(detail); });
            appendThinkingSegment(activity, rd);
            scrollToBottom();
          }
          if (cd) {
            if (!responseBubble) {
              removeTyping(); ensureMasterRowR();
              responseBubble = document.createElement("div"); responseBubble.className = "bubble bot";
              masterCol.appendChild(responseBubble);
              const actions = document.createElement("div"); actions.className = "msg-actions";
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
            reply += cd; renderStreamingMarkdown(responseBubble, reply);
            scrollToBottom();
            await new Promise(r => setTimeout(r, 0));
          }
        } catch (parseErr) { /* SSE inválida — ignorar */ }
      }
    }

    finalizeThinkingSegment(activity);
    finishStreamingMarkdown(responseBubble);
    removeTyping();
    if (!responseBubble && !reply && !reasoning) appendMessage("bot", "Sem resposta.");
    messages.push({ role: "assistant", content: reply, ...(msgAttachments.length ? { attachments: msgAttachments } : {}) });
    saveCurrentMessages();
    updateRegenerateAvailability();
    if (responseBubble) responseBubble._rawText = reply;
    stopElapsedTicker();

  } catch (e) {
    clearTimeout(thinkingTimer); clearTimeout(_resumeTimeout); stopNoResponseWatchdog(); stopElapsedTicker(); removeTyping();
    if (noGenIdTimedOut) {
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
    tryUpdateMemory();
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
  const shouldResumePendingChat = pendingBoot?.genId && pendingBoot.chatId && _chatsMeta[pendingBoot.chatId];

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
  }
})();

setGreeting();
updateSidebarUser();
