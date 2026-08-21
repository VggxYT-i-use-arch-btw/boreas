// Boreas frontend module: message rendering, actions, context menu, editing, and retry.
// Loaded as a classic script in the exact order declared by index.html.

function appendMessage(role, content, imageB64, msgIndex, attachments, thinking, steps, activity) {
  const emptyEl = document.getElementById("empty");
  if (emptyEl) emptyEl.remove();

  const row = document.createElement("div");
  row.className = `msg-row ${role}`;
  if (role === "bot" && Number.isInteger(msgIndex)) row._msgIndex = msgIndex;

  if (role === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.innerHTML = `<img src="https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png" style="width:42px;height:42px;object-fit:contain;opacity:0.95" loading="lazy" decoding="async" draggable="false">`;
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
    pill.innerHTML = `<span class="thinking-segment-icon">${BOREAS_BRAIN_ICON}</span>Processo de pensamento<svg class="pill-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
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
    const activityState = {};
    sequence.forEach(item => {
      if (item?.type === "thinking" && String(item.text ?? "").trim()) {
        ensureThinkingSegment(activityState, (pill, detail) => { col.appendChild(pill); col.appendChild(detail); });
        appendThinkingSegment(activityState, String(item.text));
      } else if (item?.type === "tool") {
        ensureThinkingSegment(activityState, (pill, detail) => { col.appendChild(pill); col.appendChild(detail); });
        ensureToolActivityCard(col, item, activityState);
      }
    });
    finalizeThinkingSegment(activityState);
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
      img.loading = "lazy";
      img.decoding = "async";
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
        // Mensagens do usuário também aceitam Markdown. O renderer já passa
        // pelo mesmo marked + DOMPurify usado nas respostas do Boreas.
        // IMPORTANTE: nunca chamar renderMarkdown(bubble, ...) direto aqui -
        // renderMarkdownNow faz `el.innerHTML = ...`, e se a bubble já tem o
        // grid de imagens anexado (bloco acima), isso apaga o grid inteiro.
        // Era por isso que a imagem sumia da bolha sempre que a mensagem
        // tinha legenda (o modelo via a imagem via API normalmente, só a
        // UI que perdia ela). Renderiza num filho separado.
        const textEl = document.createElement("div");
        renderMarkdown(textEl, content);
        bubble.appendChild(textEl);
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
  fakeAvatar.innerHTML = `<img src="${BOT_IMG_SRC}" style="width:42px;height:42px;object-fit:contain;opacity:0.95" loading="lazy" decoding="async" draggable="false">`;
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

