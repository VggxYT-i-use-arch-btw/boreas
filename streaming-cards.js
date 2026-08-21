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
      console.warn("[aup] safety timeout - resolvendo sem resposta");
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

// Novo renderer: reasoning e tools são segmentos independentes. A pill de
// pensamento nunca recebe task-items; cada tool fica em um cartão inline.
function ensureThinkingSegment(state, mountFn) {
  if (state.pill) return state;
  state.pill = document.createElement("button");
  state.pill.innerHTML = `<span class="thinking-segment-icon">${BOREAS_BRAIN_ICON}</span><span>Processo de pensamento</span><span class="thinking-segment-status">Pensando</span><svg class="thinking-segment-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  state.pill.className = "thinking-segment-pill";
  const brainIcon = state.pill.querySelector(".thinking-segment-icon");
  if (brainIcon) brainIcon.innerHTML = BOREAS_BRAIN_ICON;
  state.detail = document.createElement("div"); state.detail.className = "thinking-segment-detail";
  state.textEl = document.createElement("div"); state.textEl.className = "thinking-segment-text";
  state.itemsEl = document.createElement("div"); state.itemsEl.className = "thinking-segment-items";
  state.detail.appendChild(state.textEl);
  state.detail.appendChild(state.itemsEl);
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
  if (status) status.textContent = state.toolCount ? `${state.toolCount} passos` : "Concluído";
}
function closeThinkingSegment(state) {
  // Mantém uma única timeline por resposta. Antes cada rodada de tool fechava
  // o segmento e criava outro cartão, o que deixava a interface fragmentada.
  // O resumo só é finalizado quando o stream inteiro termina.
  if (state) state.hasTool = true;
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
  const activityState = arguments[2] ?? null;
  const host = activityState?.itemsEl ?? container;
  const id = step.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (!host._toolActivityCards) host._toolActivityCards = new Map();
  let card = host._toolActivityCards.get(id);
  if (!card) {
    card = document.createElement("div"); card.className = "tool-activity-card";
    card.innerHTML = `<button type="button" class="tool-activity-header"><span class="tool-activity-icon"></span><span class="tool-activity-copy"><span class="tool-activity-title"></span><span class="tool-activity-value"></span></span><span class="tool-activity-status">Executando</span><svg class="tool-activity-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>`;
    card._body = document.createElement("div"); card._body.className = "tool-activity-body"; card.appendChild(card._body);
    card.querySelector(".tool-activity-icon").innerHTML = toolActivityIconSvg(step.tool);
    card.querySelector(".tool-activity-header").addEventListener("click", () => card.classList.toggle("expanded"));
    host._toolActivityCards.set(id, card); host.appendChild(card);
    if (activityState) activityState.toolCount = (activityState.toolCount ?? 0) + 1;
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
    currentEl.innerHTML = `<span class="dr-card-done-msg" style="color:#e08a8a">Não convergiu a tempo - parou sem atingir 100%.</span>`;
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

