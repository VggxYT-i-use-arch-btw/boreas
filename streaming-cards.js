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
      console.warn("[aup] safety timeout - resolvendo sem resposta");
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

// Ícone único do processo de pensamento. O markup abaixo é reaplicado depois
// da montagem para manter o mesmo desenho em todos os fluxos.
const BOREAS_BRAIN_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5a3 3 0 1 0-5.997.125A4 4 0 0 0 3.5 9.75a4 4 0 0 0 1.03 6.79A4 4 0 0 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125A4 4 0 0 1 20.5 9.75a4 4 0 0 1-1.03 6.79A4 4 0 0 1 12 18Z"/><path d="M12 5v13"/><path d="M9 7.5a4 4 0 0 0 3 3.5"/><path d="M15 7.5a4 4 0 0 1-3 3.5"/><path d="M9 15a4 4 0 0 1 3-3.5"/><path d="M15 15a4 4 0 0 0-3-3.5"/></svg>`;

// Renderer por rajada: cada troca de "tipo" (raciocínio <-> tool calls)
// fecha o segmento atual e abre um novo colapsável, na ordem em que
// aconteceu - em vez de uma única timeline acumulando tudo o que rolou
// na resposta inteira. `state` (o "activity") guarda a lista de segmentos
// já fechados (`state.segments`) e o segmento em aberto (`state.cur`).
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
// Retorna o segmento aberto do tipo pedido - se o segmento aberto atual é de
// outro tipo, fecha ele e monta um novo colapsável (nova rajada).
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
// Fecha o segmento aberto (se houver) e reseta o ponteiro, sem abrir um novo -
// usado antes de widgets standalone (ex. sub-agentes) que não pertencem a
// nenhuma pill "Processo de pensamento"/"Ferramentas". Sem isso, um raciocínio
// que retoma depois do widget continuaria acumulando no segmento de ANTES dele.
function closeActivitySegment(state) {
  if (state?.cur) { BOREAS_finalizeSegment(state.cur); state.cur = null; }
}
// Legado: mantido só pra não quebrar call sites antigos que ainda chamam
// isso antes de um "step" chegar. A troca de segmento agora é automática
// (feita por ensureToolSegment/ensureThinkingSegment conforme o tipo muda).
function closeThinkingSegment() {}

// Widget standalone (fora de qualquer pill colapsável) pro invoke-subagents:
// mostra "Answered with N subagents" com um item por agente, cada um com
// shimmer enquanto roda e um check quando termina. Atualiza ao vivo porque
// step.id é o mesmo call id do começo ao fim - só troca o innerHTML.
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
};
function toolActivityLabel(tool, value) {
  const label = TOOL_ACTIVITY_LABELS[tool] ?? "Usando ferramenta";
  const detail = String(value ?? "").trim();
  return { label, detail: detail.length > 110 ? `${detail.slice(0, 107)}…` : detail };
}
const TOOL_ACTIVITY_ICON_PATHS = {
  WEB_SEARCH: `<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>`,
  WEB_FETCH: `<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3a14 14 0 0 1 0 18"></path>`,
  BASH: `<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>`,
  DELETE: `<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path><path d="M9 6V4h6v2"></path>`,
  STR_REPLACE: `<path d="m4 17 6-6"></path><path d="m14 7 6-4-4 6"></path><path d="M3 21h6"></path>`,
  SEND_FILE: `<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline>`,
  CREATE_FILE: `<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M12 12v6M9 15h6"></path>`,
  MEMORY: `<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"></path>`,
  PREFERENCES: `<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.1h-2.5v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4.5v-2.5h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4.5h2.5v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1V13h-.1a1.7 1.7 0 0 0-1.5 1z"></path>`,
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
  // O widget rico (câmbio, gráfico, imagens...) aparece direto na conversa
  // via showInlineToolResult - aqui, dentro do card colapsado, fica só o
  // output cru, pra quem quiser conferir o que a tool devolveu.
  const out = document.createElement("pre"); out.className = "tool-activity-output";
  out.textContent = String(output ?? "").slice(0, 5000); body.appendChild(out);
  card.classList.toggle("has-details", !!body.childNodes.length);
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
    // Widget standalone: não faz parte da pill "Ferramentas" - fecha
    // qualquer segmento aberto (sem abrir um novo) e renderiza direto na
    // timeline, como os widgets de showInlineToolResult.
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
    card.querySelector(".tool-activity-header").addEventListener("click", () => card.classList.toggle("expanded"));
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

  // Segurança: o card é a fonte de verdade de "terminou ou não" - se o
  // evento chegou marcado como done, garante que o botão de stop volte ao
  // normal mesmo que a promise original que abriu esse fetch tenha ficado
  // presa numa conexão que caiu (comum em long-poll atrás de proxy/túnel).
  if (chunk.done) { loading = false; hideStopBtn(); }

  scrollToBottom();
}
