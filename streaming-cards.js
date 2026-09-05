// Boreas frontend module: deep research, agentic loop, prompt cards, and activity timeline.
// Loaded as a classic script in the exact order declared by index.html.

const DR_STEP_TITLES = [
  "Entender a tarefa",
  "Definir objetivos e restrições",
  "Coletar fontes",
  "Verificar e comparar evidências",
  "Escrever resposta final",
];
const DR_CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
// "Expand" button on research/loop cards; appears once the step lines stop
// truncating with "..." and show the plan's full text.
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
    currentEl.textContent = "Pesquisa aprofundada concluída";
    currentEl.className = "dr-card-current dr-card-done-msg";
  } else if (chunk.label) {
    currentEl.className = "dr-card-current";
    currentEl.replaceChildren();
    const label = document.createElement("b");
    label.textContent = "Boreas:";
    currentEl.append(label, document.createTextNode(` ${String(chunk.label).slice(0, 2000)}`));
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

// Model poll (ask_user_prompt tool), Claude-card style: one question at a
// time with an "N of M" counter, numbered-list options, an X to skip all,
// and a free-text field for when no option fits.
// Contract with the server doesn't change: resolves by POSTing
// /prompt-response/:id with { answers }, one item per question (string,
// array of strings, or null if the question was skipped or expired).
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

    // Safety net: if something silently hangs mid-flow (a DOM error, a
    // render race), don't leave the whole stream stuck. Gives up after 5
    // minutes and reports everything as unanswered, matching the timeout
    // the server already applies on /prompt-response.
    const safetyTimer = setTimeout(() => {
      console.warn("[aup] safety timeout, resolving unanswered");
      finish();
    }, 300000);

async function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      let responseDelivered = false;
      let responseStatusEl = null;
      try {
        card.classList.add("answered");
        card.innerHTML = "";
        const done = document.createElement("div");
        done.className = "aup-done";
        done.textContent = "Respondido";
        card.appendChild(done);
        responseStatusEl = done;
      } catch (e) { console.error("[aup] falha ao fechar o card:", e); }
      try {
        const safePromptId = encodeURIComponent(String(promptId ?? ""));
        if (!safePromptId || safePromptId === "%22%22") throw new Error("prompt inválido");
        const response = await fetch(BACKEND_URL + "/prompt-response/" + safePromptId, {
          method: "POST",
          headers: BoreasSessionHeaders({ "Content-Type": "application/json" }),
          credentials: "include",
          body: JSON.stringify({ answers }),
        });
        if (!response.ok) throw await boreasHttpError(response);
        responseDelivered = true;
      } catch (e) { console.error("[aup] falha ao enviar resposta:", e); }
      if (!responseDelivered) {
        if (responseStatusEl) {
          responseStatusEl.textContent = "Falha ao enviar";
          responseStatusEl.classList.add("error");
        }
        userStoppedGeneration = true;
        try { currentAbortController?.abort(); } catch {}
        if (currentGenId) {
          fetch(BACKEND_URL + "/chat/stop", {
            method: "POST",
            headers: BoreasSessionHeaders({ "Content-Type": "application/json" }),
            credentials: "include",
            body: JSON.stringify({ genId: currentGenId }),
            keepalive: true,
          }).catch(() => {});
        }
      }
      resolve(responseDelivered ? answers : null);
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

// Rebuilds an already-answered poll (ask_user_prompt) from saved history:
// a read-only version, no buttons, so the card doesn't disappear on reload.
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

// "Additional thinking": once the model has used at least one tool, any
// further reasoning_content becomes a collapsible item INSIDE the
// "Running" timeline (same mechanic as tool task items), instead of piling
// up on the top "Working" pill. Each new thinking round after a tool
// becomes a new item; the "step" handler calls closeExtraThink() to close
// the current item as soon as a new tool runs.
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
  // Appends straight to the end of the timeline, without grouping by
  // section, preserving the real chronological order (reasoning
  // interleaved with tools, in the sequence they happened) instead of
  // pushing everything into a separate "THINKING" section.
  stepsDetail.appendChild(taskEl);
  state.el = taskEl; state.outEl = outEl;
  return state;
}
// Creates (once) the single "Thinking process" pill plus the timeline below
// it, used for both reasoning and tool calls; replaces the two separate
// pills (thinking-pill + tasks-pill "N tasks") that used to exist
// separately in each streaming function.
function ensureActivityPill(state, mountFn) {
  if (state.pill) return state;
  state.pill = document.createElement("button"); state.pill.className = "tasks-pill";
  state.pill.innerHTML = `<span class="thinking-segment-icon">${BOREAS_BRAIN_ICON}</span><span>Processo de pensamento</span><span class="tp-dots"><span></span><span></span><span></span></span><svg class="pill-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  const activityBrainIcon = state.pill.querySelector("span:first-child");
  if (activityBrainIcon) activityBrainIcon.innerHTML = BOREAS_BRAIN_ICON;
  state.detail = document.createElement("div"); state.detail.className = "tasks-detail";
  state.pill.addEventListener("click", () => {
    if (typeof isMobile !== "undefined" && isMobile) {
      openSheet(state.detail.textContent.trim() || "Nenhum detalhe adicional.");
      state.pill.classList.add("expanded");
      return;
    }
    state.pill.classList.toggle("expanded");
    state.detail.classList.toggle("visible");
  });
  mountFn(state.pill, state.detail);
  return state;
}
// Removes the "in progress" dots once the generation ends.
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

// Single icon for the thinking process. The markup below is reapplied
// after mounting to keep the same artwork across all flows.
const BOREAS_BRAIN_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5a3 3 0 1 0-5.997.125A4 4 0 0 0 3.5 9.75a4 4 0 0 0 1.03 6.79A4 4 0 0 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125A4 4 0 0 1 20.5 9.75a4 4 0 0 1-1.03 6.79A4 4 0 0 1 12 18Z"/><path d="M12 5v13"/><path d="M9 7.5a4 4 0 0 0 3 3.5"/><path d="M15 7.5a4 4 0 0 1-3 3.5"/><path d="M9 15a4 4 0 0 1 3-3.5"/><path d="M15 15a4 4 0 0 0-3-3.5"/></svg>`;

// Burst-based renderer: every "type" switch (reasoning <-> tool calls)
// closes the current segment and opens a new collapsible one, in the order
// it happened, instead of one single timeline accumulating everything from
// the whole response. `state` (the "activity") holds the list of closed
// segments (`state.segments`) and the currently open one (`state.cur`).
const TOOL_GROUP_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a2.1 2.1 0 0 0 3 3l6-6a4 4 0 0 0 5.4-5.4l-2.4 2.4-3-3Z"></path></svg>`;
function BOREAS_createSegmentShell(kind) {
  const pill = document.createElement("button");
  pill.className = "thinking-segment-pill" + (kind === "tool" ? " tool-segment-pill" : "");
  const icon = kind === "tool" ? TOOL_GROUP_ICON : BOREAS_BRAIN_ICON;
  const title = kind === "tool" ? "Ferramentas" : "Processo de pensamento";
  const initialStatus = kind === "tool" ? "Executando" : "Pensando";
  pill.innerHTML = `<span class="thinking-segment-icon">${icon}</span><span>${title}</span><span class="thinking-segment-status">${initialStatus}</span><svg class="thinking-segment-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  const detail = document.createElement("div"); detail.className = "thinking-segment-detail";
  const seg = { kind, pill, detail, stepCount: 0 };
  if (kind === "tool") {
    seg.itemsEl = document.createElement("div"); seg.itemsEl.className = "thinking-segment-items";
    detail.appendChild(seg.itemsEl);
  } else {
    seg.textEl = document.createElement("div"); seg.textEl.className = "thinking-segment-text";
    seg.text = "";
    detail.appendChild(seg.textEl);
  }
  pill.addEventListener("click", () => { pill.classList.toggle("expanded"); detail.classList.toggle("visible"); });
  return seg;
}
function BOREAS_finalizeSegment(seg) {
  if (!seg?.pill) return;
  seg.pill.classList.add("is-complete");
  const status = seg.pill.querySelector(".thinking-segment-status");
  if (!status) return;
  status.textContent = seg.kind === "tool" ? `${seg.stepCount || 0} ${seg.stepCount === 1 ? "passo" : "passos"}` : "Concluído";
}
// Returns the open segment of the requested kind; if the currently open
// segment is of a different kind, closes it and starts a new collapsible one.
function BOREAS_getSegment(state, kind, mountFn) {
  if (state.cur && state.cur.kind === kind) return state.cur;
  if (state.cur) BOREAS_finalizeSegment(state.cur);
  const seg = BOREAS_createSegmentShell(kind);
  mountFn(seg.pill, seg.detail);
  (state.segments ?? (state.segments = [])).push(seg);
  state.cur = seg;
  return seg;
}
function ensureThinkingSegment(state, mountFn) { return BOREAS_getSegment(state, "thinking", mountFn); }
function ensureToolSegment(state, mountFn) { return BOREAS_getSegment(state, "tool", mountFn); }
function appendThinkingSegment(state, delta) {
  const seg = state?.cur?.kind === "thinking" ? state.cur : null;
  if (!seg) return;
  seg.text += delta;
  seg.textEl.textContent = seg.text;
}
function finalizeThinkingSegment(state) {
  if (state?.cur) BOREAS_finalizeSegment(state.cur);
}
// Closes the open segment (if any) and resets the pointer, without opening
// a new one; used before standalone widgets (e.g. sub-agents) that don't
// belong to any "Thinking process"/"Tools" pill. Without this, reasoning
// that resumes after the widget would keep accumulating into the segment
// from before it.
function closeActivitySegment(state) {
  if (state?.cur) { BOREAS_finalizeSegment(state.cur); state.cur = null; }
}
// Legacy: kept only so old call sites that still call this before a "step"
// arrives don't break. Segment switching is now automatic (handled by
// ensureToolSegment/ensureThinkingSegment as the type changes).
function closeThinkingSegment() {}

// Standalone widget (outside any collapsible pill) for invoke-subagents:
// shows "Answered with N subagents" with one item per agent, each with a
// shimmer while running and a check when done. Updates live because
// step.id is the same call id from start to finish; only the innerHTML changes.
const SUBAGENTS_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><g fill="currentColor"><ellipse cx="12" cy="4.2" rx="2.1" ry="3.1"></ellipse><ellipse cx="12" cy="4.2" rx="2.1" ry="3.1" transform="rotate(60 12 12)"></ellipse><ellipse cx="12" cy="4.2" rx="2.1" ry="3.1" transform="rotate(120 12 12)"></ellipse><ellipse cx="12" cy="4.2" rx="2.1" ry="3.1" transform="rotate(180 12 12)"></ellipse><ellipse cx="12" cy="4.2" rx="2.1" ry="3.1" transform="rotate(240 12 12)"></ellipse><ellipse cx="12" cy="4.2" rx="2.1" ry="3.1" transform="rotate(300 12 12)"></ellipse></g></svg>`;
const SUBAGENT_CHECK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
function ensureSubagentsWidget(container, step) {
  if (!container || !step?.id) return null;
  let data;
  try { data = JSON.parse(step.value || "{}"); } catch { data = {}; }
  const agents = Array.isArray(data.agents) ? data.agents : [];
  if (!container._subagentWidgets) container._subagentWidgets = new Map();
  let widget = container._subagentWidgets.get(step.id);
  if (!widget) {
    widget = document.createElement("div"); widget.className = "subagents-widget";
    widget.innerHTML = `<button type="button" class="subagents-widget-header"><span class="subagents-widget-icon">${SUBAGENTS_ICON}</span><span class="subagents-widget-title"></span><svg class="subagents-widget-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button><div class="subagents-widget-list"></div>`;
    widget.querySelector(".subagents-widget-header").addEventListener("click", () => widget.classList.toggle("collapsed"));
    container._subagentWidgets.set(step.id, widget);
    container.appendChild(widget);
  }
  const total = agents.length;
  const doneCount = agents.filter(a => a?.status === "done").length;
  const allDone = total > 0 && doneCount === total;
  widget.classList.toggle("all-done", allDone);
  widget.classList.toggle("is-running", !allDone);
  const titleEl = widget.querySelector(".subagents-widget-title");
  titleEl.textContent = total
    ? `Answered with ${total} subagent${total === 1 ? "" : "s"}`
    : (data.error ? "Sub-agents failed" : "Starting subagents…");
  const list = widget.querySelector(".subagents-widget-list");
  list.innerHTML = "";
  agents.forEach(a => {
    const item = document.createElement("div");
    item.className = "subagent-row " + (a?.status === "done" ? "is-done" : "is-running");
    const label = document.createElement("span"); label.className = "subagent-row-label"; label.textContent = String(a?.label ?? "");
    const mark = document.createElement("span"); mark.className = "subagent-row-check";
    if (a?.status === "done") mark.innerHTML = SUBAGENT_CHECK_ICON;
    item.appendChild(label); item.appendChild(mark);
    list.appendChild(item);
  });
  return widget;
}

const TOOL_ACTIVITY_LABELS = {
  WEB_SEARCH: "Pesquisando na web", WEB_FETCH: "Lendo fonte", BASH: "Executando no sandbox",
  DELETE: "Removendo arquivo", STR_REPLACE: "Editando arquivo", SEND_FILE: "Preparando arquivo",
  CREATE_FILE: "Criando arquivo", MEMORY: "Atualizando memória", PREFERENCES: "Atualizando preferências",
  ASK_USER: "Aguardando sua resposta", CALCULATOR: "Calculando", GRAPH: "Criando gráfico",
  FORWARD_MESSAGE: "Escalando modelo", USE_PLUGIN: "Ativando recurso", IMAGE_SEARCH: "Buscando imagens",
  PRESENT_IMAGE: "Mostrando imagens", VIEW_CHATS: "Consultando conversas", CURRENCY: "Consultando câmbio",
  DEEP_RESEARCH: "Pesquisando profundamente", AGENTIC_LOOP: "Executando plano",
  USE_TOOL: "Carregando ferramenta",
  GENERATE_IMAGE: "Criando sua imagem",
  EDIT_IMAGE: "Editando imagem",
};
function toolActivityLabel(tool, value) {
  const label = TOOL_ACTIVITY_LABELS[tool] ?? "Usando ferramenta";
  const detail = String(value ?? "").trim();
  return { label, detail: detail.length > 110 ? `${detail.slice(0, 107)}…` : detail };
}
const TOOL_ACTIVITY_ICON_PATHS = {
  WEB_SEARCH: `<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>`,
  WEB_FETCH: `<circle cx="12" cy="12" r="9"></circle><ellipse cx="12" cy="12" rx="4" ry="9"></ellipse><path d="M3 12h18"></path><path d="M4.5 7.5h15"></path><path d="M4.5 16.5h15"></path>`,
  BASH: `<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>`,
  DELETE: `<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path><path d="M9 6V4h6v2"></path>`,
  STR_REPLACE: `<path d="m4 17 6-6"></path><path d="m14 7 6-4-4 6"></path><path d="M3 21h6"></path>`,
  SEND_FILE: `<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline>`,
  CREATE_FILE: `<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 12v6M9 15h6"></path>`,
  MEMORY: `<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"></path>`,
  PREFERENCES: `<circle cx="12" cy="12" r="3"></circle><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>`,
  CALCULATOR: `<rect x="5" y="2" width="14" height="20" rx="2"></rect><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"></path>`,
  IMAGE_SEARCH: `<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4M8 13l2-2 2 2 2-2 2 2"></path>`,
  ASK_USER: `<path d="M12 2a10 10 0 1 0 4.24 19.03L22 22l-1.29-4.24A10 10 0 0 0 12 2Z"></path><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2 1.75-2 3.5"></path><path d="M12 16.5h.01"></path>`,
  GRAPH: `<path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-4 4"></path>`,
  FORWARD_MESSAGE: `<path d="m10 17 5-5-5-5"></path><path d="M4 17V7a2 2 0 0 1 2-2h13"></path>`,
  USE_PLUGIN: `<path d="M12 2v4"></path><path d="M6 8h12l1 6a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6l1-6Z"></path><path d="M9 14v2M15 14v2"></path>`,
  PRESENT_IMAGE: `<rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="9" cy="10" r="1.5"></circle><path d="m4 18 5-5 4 4 3-3 4 4"></path>`,
  VIEW_CHATS: `<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>`,
  CURRENCY: `<circle cx="12" cy="12" r="9"></circle><path d="M15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 1-3 2.3 0 3.2 6 1.5 6 4.7 0 1.3-1.3 2.3-3 2.3a3 3 0 0 1-3-1.5"></path><path d="M12 6v2M12 16v2"></path>`,
  DEEP_RESEARCH: `<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path><path d="M11 8v3l2 2"></path>`,
  AGENTIC_LOOP: `<path d="M17 2.1l4 4-4 4"></path><path d="M3 12.7V9.6a4 4 0 0 1 4-4h13.4"></path><path d="M7 21.9l-4-4 4-4"></path><path d="M21 11.3v3.1a4 4 0 0 1-4 4H3.6"></path>`,
  USE_TOOL: `<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>`,
  GENERATE_IMAGE: `<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path>`,
  EDIT_IMAGE: `<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path>`,
};
function toolActivityIconSvg(tool) {
  const paths = TOOL_ACTIVITY_ICON_PATHS[tool] ?? TOOL_ACTIVITY_ICON_PATHS.PREFERENCES;
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
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
  // The rich widget (currency, chart, images...) appears directly in the
  // conversation via showInlineToolResult; here, inside the collapsed card,
  // only the raw output is shown, for anyone who wants to check what the
  // tool actually returned. A blank/whitespace-only output has nothing to
  // show, so has-details must stay false - otherwise the expand chevron
  // is clickable but reveals an empty box.
  const outputText = String(output ?? "").slice(0, 5000);
  const hasRealOutput = outputText.trim().length > 0;
  if (hasRealOutput) {
    const out = document.createElement("pre"); out.className = "tool-activity-output";
    out.textContent = outputText; body.appendChild(out);
  }
  card.classList.toggle("has-details", hasRealOutput);
}
const MAX_TOOL_ACTIVITY_CARDS = 256;
function pruneToolActivityCards(host) {
  const cards = host?._toolActivityCards;
  if (!cards) return;
  for (const [id, card] of cards) {
    if (!card.isConnected || card.classList.contains("is-done")) cards.delete(id);
  }
  while (cards.size > MAX_TOOL_ACTIVITY_CARDS) {
    const oldest = cards.keys().next().value;
    if (oldest === undefined) break;
    const card = cards.get(oldest);
    cards.delete(oldest);
    if (card?.isConnected && !card.classList.contains("is-done")) {
      card.classList.add("is-done");
      card.querySelector(".tool-activity-status").textContent = "Interrompido";
    }
  }
}
function ensureToolActivityCard(container, step, activityState, mountFn) {
  if (!container || !step) return null;
  if (step.tool === "INVOKE_SUBAGENTS") {
    // Standalone widget: not part of the "Tools" pill; closes any open
    // segment (without opening a new one) and renders directly in the
    // timeline, like the showInlineToolResult widgets.
    closeActivitySegment(activityState);
    return ensureSubagentsWidget(container, step);
  }
  const seg = ensureToolSegment(activityState ?? {}, mountFn ?? (() => {}));
  const host = seg?.itemsEl ?? container;
  const id = step.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (!host._toolActivityCards) host._toolActivityCards = new Map();
  pruneToolActivityCards(host);
  let card = host._toolActivityCards.get(id);
  if (!card) {
    card = document.createElement("div"); card.className = "tool-activity-card";
    card.innerHTML = `<button type="button" class="tool-activity-header"><span class="tool-activity-icon"></span><span class="tool-activity-copy"><span class="tool-activity-title"></span><span class="tool-activity-value"></span></span><span class="tool-activity-status">Executando</span><svg class="tool-activity-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>`;
    card._body = document.createElement("div"); card._body.className = "tool-activity-body"; card.appendChild(card._body);
    card.querySelector(".tool-activity-icon").innerHTML = toolActivityIconSvg(step.tool);
    card.querySelector(".tool-activity-header").addEventListener("click", () => {
      if (!card.classList.contains("has-details")) return;
      card.classList.toggle("expanded");
    });
    host._toolActivityCards.set(id, card); host.appendChild(card);
    if (seg) seg.stepCount = (seg.stepCount ?? 0) + 1;
  }
  updateToolActivityCard(card, step.tool, step.value, step.output);
  if (step.output !== undefined) {
    queueMicrotask(() => {
      if (host._toolActivityCards?.get(id) === card) host._toolActivityCards.delete(id);
    });
  }
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

  // On the first call, the model writes a concrete description per step
  // (based on the real goal); stored on the card so it survives future
  // updates that don't resend the plan.
  if (Array.isArray(chunk.plan) && chunk.plan.length) card._plan = chunk.plan;

  const percentEl = card.querySelector(".al-card-percent");
  if (percentEl && typeof chunk.percent === "number") percentEl.textContent = `${chunk.percent}%`;

  const activeStage = Math.max(0, Math.min(5, chunk.stage ?? 0));
  card.querySelectorAll(".dr-step").forEach(stepEl => {
    const n = Number(stepEl.dataset.step);
    const icon = stepEl.querySelector(".dr-step-icon");
    const textEl = stepEl.querySelector(".dr-step-text");
    const planLine = card._plan?.[n - 1];
    textEl.replaceChildren();
    const stageLabel = document.createElement("b");
    stageLabel.textContent = AL_STAGE_TITLES[n - 1] + (planLine ? ":" : "");
    textEl.appendChild(stageLabel);
    if (planLine) textEl.appendChild(document.createTextNode(` ${String(planLine).slice(0, 500)}`));
    stepEl.classList.remove("active", "done");
    if (n < activeStage || (chunk.done && chunk.converged !== false)) { stepEl.classList.add("done"); icon.innerHTML = DR_CHECK_ICON; }
    else if (n === activeStage && !chunk.done) { stepEl.classList.add("active"); icon.innerHTML = ""; }
    else { icon.innerHTML = ""; }
  });

  const currentEl = card.querySelector(".dr-card-current");
  if (chunk.done && chunk.converged === false) {
    currentEl.textContent = "Não convergiu a tempo - parou sem atingir 100%.";
    currentEl.className = "dr-card-current dr-card-done-msg";
    currentEl.style.color = "#e08a8a";
  } else if (chunk.done) {
    currentEl.textContent = "Objetivo alcançado";
    currentEl.className = "dr-card-current dr-card-done-msg";
    currentEl.style.color = "";
  } else if (chunk.summary) {
    currentEl.className = "dr-card-current";
    currentEl.style.color = "";
    currentEl.replaceChildren();
    const summaryLabel = document.createElement("b");
    summaryLabel.textContent = "Boreas:";
    currentEl.append(summaryLabel, document.createTextNode(` ${String(chunk.summary).slice(0, 2000)}`));
  }

  // Safety net: the card is the source of truth for "finished or not". If
  // the event arrived marked as done, makes sure the stop button reverts to
  // normal even if the original promise that opened this fetch got stuck on
  // a dropped connection (common in long-polling behind a proxy/tunnel).
  if (chunk.done) { loading = false; hideStopBtn(); }

  scrollToBottom();
}

const IMG_GEN_ERROR_ICON = `<svg class="img-gen-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12.01" y2="16.5"/></svg>`;
const IMG_GEN_EXPIRED_ICON = `<svg class="img-gen-expired-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const IMG_GEN_STATUS_LABELS = {
  improving_prompt: "Melhorando seu prompt",
  generating: "Criando sua imagem",
};

// Renders/updates the generation card for one image (keyed by chunk.image_id
// - a reply can generate more than one image, each gets its own card). See
// chat-stream.js's "image_generation" SSE event and db.js's generated_images
// table for the status machine this mirrors: improving_prompt -> generating
// -> ready | failed (a fifth state, "expired", is handled separately by
// markImageGenerationExpired below, applied when a chat with older generated
// images is reopened rather than as a live SSE state).
function renderImageGenerationCard(col, chunk) {
  if (!col || !chunk?.image_id) return null;
  const wrapId = `img-gen-${chunk.image_id}`;
  let wrap = col.querySelector(`#${wrapId}`);
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = wrapId;
    wrap.className = "img-gen-wrap";
    wrap.innerHTML = `
      <div class="img-gen-status">
        <span class="img-gen-status-text"></span>
        <span class="img-gen-dots"><span class="img-gen-dot"></span><span class="img-gen-dot"></span><span class="img-gen-dot"></span></span>
      </div>
      <div class="img-gen-card" data-ratio="1:1"></div>`;
    col.appendChild(wrap);
  }

  const card = wrap.querySelector(".img-gen-card");
  const statusText = wrap.querySelector(".img-gen-status-text");
  const dots = wrap.querySelector(".img-gen-dots");
  const ratio = chunk.aspect_ratio || card.dataset.ratio || "1:1";
  card.dataset.ratio = ratio;

  if (chunk.status === "improving_prompt" || chunk.status === "generating") {
    statusText.textContent = IMG_GEN_STATUS_LABELS[chunk.status] ?? "Criando sua imagem";
    if (dots) dots.style.display = "";
    scrollToBottom();
    return wrap;
  }

  if (chunk.status === "failed") {
    if (dots) dots.style.display = "none";
    statusText.textContent = "Falha na geração";
    card.classList.add("img-gen-error");
    card.innerHTML = `${IMG_GEN_ERROR_ICON}<span class="img-gen-error-text">Não foi possível gerar essa imagem. Pode pedir para eu tentar de novo.</span>`;
    scrollToBottom();
    return wrap;
  }

  if (chunk.status === "ready") {
    if (dots) dots.style.display = "none";
    statusText.textContent = "Imagem pronta";
    const img = document.createElement("img");
    img.alt = "Imagem gerada";
    img.decoding = "async";
    img.loading = "lazy";
    // The placeholder (dark card + sheen) stays visible - and the ::after
    // sheen keeps running - until the real image has actually finished
    // loading; only then does it crossfade in and the sheen stop, so
    // "ready" from the server never means an abrupt swap to a half-loaded
    // or broken image (Parte 34/35 of the spec).
    img.addEventListener("load", () => {
      card.classList.add("img-gen-loaded");
      requestAnimationFrame(() => img.classList.add("img-loaded"));
    }, { once: true });
    img.addEventListener("error", async () => {
      // Distinguishes "expired" (410, expected after 30 days) from a real
      // load failure - the <img> error event alone doesn't carry the HTTP
      // status, so a HEAD request is needed to tell them apart.
      let status = null;
      try {
        const headRes = await fetch(img.src, { method: "HEAD", credentials: "include" });
        status = headRes.status;
      } catch {}
      if (status === 410) { markImageGenerationExpired(col, chunk.image_id); return; }
      card.classList.add("img-gen-error");
      card.innerHTML = `${IMG_GEN_ERROR_ICON}<span class="img-gen-error-text">A imagem foi gerada, mas não carregou. Tente reabrir a conversa.</span>`;
    }, { once: true });
    img.src = `${BACKEND_URL}/generated-image/${encodeURIComponent(chunk.image_id)}`;
    card.appendChild(img);
    card.addEventListener("click", () => { if (typeof openLightbox === "function") openLightbox(img.src); }, { once: true });
    card.style.cursor = "zoom-in";
    scrollToBottom();
    return wrap;
  }

  return wrap;
}

// Applied when reopening a chat: a generated_image attachment whose expiry
// has passed (see db.js's generated_images.expires_at / Parte 30 of the
// spec) never gets its <img> requested at all - straight to the clear
// "expired" state instead of a broken-image icon or an infinite spinner.
function markImageGenerationExpired(col, imageId) {
  const wrap = col?.querySelector(`#img-gen-${imageId}`);
  if (!wrap) return;
  const card = wrap.querySelector(".img-gen-card");
  const statusText = wrap.querySelector(".img-gen-status-text");
  const dots = wrap.querySelector(".img-gen-dots");
  if (dots) dots.style.display = "none";
  if (statusText) statusText.textContent = "Imagem expirada";
  card.className = "img-gen-card img-gen-expired";
  card.innerHTML = `${IMG_GEN_EXPIRED_ICON}<span class="img-gen-expired-text">Essa imagem expirou após 30 dias. Você não pode mais baixá-la.</span>`;
}
