// Unified thinking/tools trace and replay.
// ── Unified thinking/tools trace ──────────────────────────────────────────
// These definitions intentionally keep the public function names used by the
// streaming and history modules above. The old segment implementation is
// retained for compatibility with older saved data, while this single trace
// shell is now the only live/replayed visual surface.
function BOREAS_traceIcon(tool) {
  const icons = {
    thinking: "ph-lightbulb",
    BASH: "ph-terminal-window",
    WEB_SEARCH: "ph-globe-hemisphere-west",
    MEMORY: "ph-pencil-simple",
    INVOKE_SUBAGENTS: "ph-share-network",
    WEB_FETCH: "ph-globe",
    STR_REPLACE: "ph-pencil-line",
    CREATE_FILE: "ph-file-plus",
    DELETE: "ph-trash",
    SEND_FILE: "ph-file-arrow-up",
    CALCULATOR: "ph-function",
    GRAPH: "ph-chart-line-up",
    ASK_USER: "ph-question",
  };
  return `<i class="ph ${icons[tool] ?? "ph-wrench"}" aria-hidden="true"></i>`;
}

function BOREAS_traceText(value, max = 150) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function BOREAS_traceEnsure(state, mountFn) {
  if (state.trace) return state.trace;
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "thinking-trace-toggle";
  pill.setAttribute("aria-expanded", "false");
  pill.innerHTML = `<span class="thinking-trace-current-dot is-running" aria-hidden="true"></span><span class="thinking-trace-preview"></span><span class="thinking-trace-chevron" aria-hidden="true">&gt;</span>`;
  const detail = document.createElement("div");
  detail.className = "thinking-trace-detail";
  const timeline = document.createElement("div");
  timeline.className = "thinking-trace-timeline";
  detail.appendChild(timeline);
  const trace = { pill, detail, timeline, items: [], toolMap: new Map(), running: true, expanded: false };
  pill.addEventListener("click", () => {
    trace.expanded = !trace.expanded;
    trace.pill.classList.toggle("is-expanded", trace.expanded);
    trace.detail.classList.toggle("visible", trace.expanded);
    trace.pill.setAttribute("aria-expanded", String(trace.expanded));
    trace.pill.querySelector(".thinking-trace-preview").classList.remove("is-shimmer");
    if (trace.expanded) trace.pill.querySelector(".thinking-trace-preview").textContent = "Etapas";
  });
  mountFn(pill, detail);
  state.trace = trace;
  return trace;
}

function BOREAS_traceSetPreview(state, text) {
  const trace = state?.trace;
  if (!trace || trace.expanded) return;
  const preview = trace.pill.querySelector(".thinking-trace-preview");
  preview.textContent = BOREAS_traceText(text, 128) || "Processando";
  if (trace.running) preview.classList.add("is-shimmer");
}

function BOREAS_traceNormalizeSummary(summary) {
  if (typeof summary === "string" && summary.trim()) {
    return { segments: [{ segmentIndex: 0, phases: [{ title: "Raciocínio", body: summary.trim() }] }] };
  }
  if (Array.isArray(summary)) {
    const phases = summary.filter(item => item && item.title && item.body);
    return { segments: phases.length ? [{ segmentIndex: 0, phases }] : [] };
  }
  if (!summary || !Array.isArray(summary.segments)) return { segments: [] };
  return {
    segments: summary.segments.map((segment, index) => ({
      segmentIndex: Number.isInteger(segment?.segmentIndex) ? segment.segmentIndex : index,
      phases: Array.isArray(segment?.phases)
        ? segment.phases.filter(item => item && item.title && item.body).slice(0, 4)
        : [],
    })).filter(segment => segment.phases.length),
  };
}

function BOREAS_tracePhasesForSegment(summary, segmentIndex) {
  const normalized = BOREAS_traceNormalizeSummary(summary);
  return normalized.segments.find(segment => segment.segmentIndex === segmentIndex)?.phases ?? [];
}

function BOREAS_traceBuildThinkingItem(phase, raw) {
  const item = document.createElement("div");
  item.className = "thinking-trace-item trace-thinking";
  item.innerHTML = `<span class="thinking-trace-item-icon">${BOREAS_traceIcon("thinking")}</span><div class="thinking-trace-item-main"><div class="thinking-trace-item-title"></div><div class="thinking-trace-item-summary"></div><button type="button" class="thinking-trace-raw-toggle">Ver raciocínio bruto</button><pre class="thinking-trace-raw"></pre></div>`;
  item.querySelector(".thinking-trace-item-title").textContent = String(phase?.title || "Analisando o raciocínio");
  item.querySelector(".thinking-trace-item-summary").textContent = String(phase?.body || "Resumo sendo preparado…");
  const rawEl = item.querySelector(".thinking-trace-raw");
  rawEl.textContent = raw || "";
  item.querySelector(".thinking-trace-raw-toggle").addEventListener("click", event => {
    event.stopPropagation();
    item.classList.toggle("raw-visible");
  });
  return { item, rawEl, summaryEl: item.querySelector(".thinking-trace-item-summary") };
}

function BOREAS_traceCreateThinking(state, summary, segmentIndex = 0) {
  const trace = state.trace;
  const phases = BOREAS_tracePhasesForSegment(summary, segmentIndex);
  const visiblePhases = phases.length ? phases : [{ title: "Analisando o raciocínio", body: "Resumo sendo preparado…" }];
  const built = visiblePhases.map(phase => BOREAS_traceBuildThinkingItem(phase, ""));
  trace.timeline.append(...built.map(part => part.item));
  const entry = {
    kind: "thinking",
    segmentIndex,
    items: built.map(part => part.item),
    raw: "",
    rawEls: built.map(part => part.rawEl),
    summaryEls: built.map(part => part.summaryEl),
  };
  trace.items.push(entry);
  const latestPhase = phases.at(-1);
  BOREAS_traceSetPreview(state, latestPhase?.title || "Pensando…");
  return entry;
}

function ensureThinkingSegment(state, mountFn) {
  BOREAS_traceEnsure(state, mountFn);
  if (state.trace.current?.kind === "thinking") return state.trace.current;
  const segmentIndex = state.trace.nextThinkingSegmentIndex ?? 0;
  state.trace.nextThinkingSegmentIndex = segmentIndex + 1;
  state.trace.current = BOREAS_traceCreateThinking(state, state.thinkingSummary, segmentIndex);
  return state.trace.current;
}

function appendThinkingSegment(state, delta, summary) {
  const entry = ensureThinkingSegment(state, () => {});
  if (summary && typeof summary !== "object" && entry.summaryEls?.length) entry.summaryEls[0].textContent = summary;
  entry.raw += String(delta ?? "");
  entry.rawEls?.forEach(rawEl => { rawEl.textContent = entry.raw; });
  // Never expose a raw reasoning excerpt in the collapsed preview.
  const phase = BOREAS_tracePhasesForSegment(state.thinkingSummary, entry.segmentIndex).at(-1);
  BOREAS_traceSetPreview(state, phase?.title || "Pensando…");
}

function finalizeThinkingSegment(state) {
  const trace = state?.trace;
  if (!trace) return;
  trace.running = false;
  trace.items.filter(item => item?.kind === "thinking").forEach(entry => {
    entry.summaryEls?.forEach(summaryEl => {
      if (summaryEl.textContent === "Resumo sendo preparado…") summaryEl.textContent = "Resumo indisponível.";
    });
  });
  trace.pill.classList.add("is-complete");
  trace.pill.querySelector(".thinking-trace-current-dot").classList.remove("is-running");
  const preview = trace.pill.querySelector(".thinking-trace-preview");
  preview.classList.remove("is-shimmer");
  if (!trace.expanded) preview.textContent = "Concluído";
  if (!trace.completedEl) {
    trace.completedEl = document.createElement("div");
    trace.completedEl.className = "thinking-trace-completed";
    trace.completedEl.innerHTML = `<i class="ph ph-check-circle" aria-hidden="true"></i><span>Concluído</span>`;
    trace.timeline.appendChild(trace.completedEl);
  }
}

function ensureToolSegment(state, mountFn) {
  BOREAS_traceEnsure(state, mountFn);
  state.trace.current = { kind: "tool", itemsEl: state.trace.timeline };
  return state.trace.current;
}

function BOREAS_traceToolTitle(tool, value) {
  if (tool === "BASH") return BOREAS_traceText(value, 220) || "Executando comando";
  if (tool === "WEB_SEARCH") return `Procurei por "${String(value ?? "").trim()}"`;
  return TOOL_ACTIVITY_LABELS[tool] ?? (BOREAS_traceText(value, 150) || "Usando ferramenta");
}

function BOREAS_traceOutput(item, output) {
  if (output === undefined || output === null || String(output).trim() === "") return;
  item.dataset.hasRaw = "true";
  item.querySelector(".thinking-trace-raw").textContent = String(output).slice(0, 12000);
  item.querySelector(".thinking-trace-raw-toggle").hidden = false;
}

function BOREAS_traceCreateTool(state, step) {
  const trace = state.trace;
  const tool = String(step.tool ?? "");
  const lineOnly = tool === "WEB_SEARCH" || tool === "MEMORY";
  const item = document.createElement("div");
  item.className = `thinking-trace-item trace-tool ${lineOnly ? "trace-line-only" : ""}`;
  item.innerHTML = `<span class="thinking-trace-item-icon">${BOREAS_traceIcon(tool)}</span><div class="thinking-trace-item-main"><div class="thinking-trace-item-title"></div><div class="thinking-trace-item-summary"></div><button type="button" class="thinking-trace-raw-toggle" hidden>Ver saída bruta</button><pre class="thinking-trace-raw"></pre></div>`;
  const title = item.querySelector(".thinking-trace-item-title");
  title.textContent = tool === "MEMORY" ? "Memória atualizada" : BOREAS_traceToolTitle(tool, step.value);
  if (tool === "WEB_SEARCH") item.querySelector(".thinking-trace-item-summary").remove();
  if (tool === "MEMORY") item.classList.add("trace-memory");
  const rawToggle = item.querySelector(".thinking-trace-raw-toggle");
  rawToggle.addEventListener("click", event => {
    event.stopPropagation();
    item.classList.toggle("raw-visible");
  });
  trace.timeline.appendChild(item);
  const entry = { kind: "tool", id: step.id, item };
  trace.items.push(entry);
  BOREAS_traceOutput(item, step.output);
  BOREAS_traceSetPreview(state, title.textContent);
  return entry;
}

function BOREAS_traceCreateSubagent(state, step) {
  let snapshot = {};
  try { snapshot = JSON.parse(step.value || "{}"); } catch {}
  let result = {};
  try { result = JSON.parse(step.output || "{}"); } catch {}
  const agents = Array.isArray(result.agents) && result.agents.length ? result.agents : (Array.isArray(snapshot.agents) ? snapshot.agents : []);
  let entry = state.trace.toolMap.get(step.id);
  if (!entry) {
    const item = document.createElement("div");
    item.className = "thinking-trace-item trace-subagent";
    item.innerHTML = `<span class="thinking-trace-item-icon">${BOREAS_traceIcon("INVOKE_SUBAGENTS")}</span><div class="thinking-trace-item-main"><div class="thinking-trace-item-title">Executando subagente</div><div class="subagent-trace-card"><div class="subagent-trace-agents"></div></div></div>`;
    state.trace.timeline.appendChild(item);
    entry = { kind: "subagent", id: step.id, item, agentsEl: item.querySelector(".subagent-trace-agents") };
    state.trace.items.push(entry);
    state.trace.toolMap.set(step.id, entry);
  }
  entry.agentsEl.replaceChildren();
  agents.forEach(agent => {
    const agentEl = document.createElement("div");
    agentEl.className = "subagent-trace-agent";
    const name = document.createElement("div");
    name.className = "subagent-trace-name";
    name.textContent = String(agent.name || agent.label || "Subagente");
    const output = document.createElement("div");
    output.className = "subagent-trace-output";
    output.textContent = String(agent.output || (agent.status === "done" ? agent.error || "Sem resposta." : "Executando…"));
    agentEl.append(name, output);
    entry.agentsEl.appendChild(agentEl);
  });
  BOREAS_traceSetPreview(state, agents.length ? `Executando ${agents.length} subagente${agents.length === 1 ? "" : "s"}` : "Executando subagente");
  return entry;
}

function ensureToolActivityCard(container, step, activityState, mountFn) {
  if (!container || !step) return null;
  BOREAS_traceEnsure(activityState, mountFn);
  if (step.tool === "INVOKE_SUBAGENTS") {
    const entry = BOREAS_traceCreateSubagent(activityState, step);
    activityState.trace.current = entry;
    return entry;
  }
  const id = step.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  let entry = activityState.trace.toolMap.get(id);
  if (!entry) {
    entry = BOREAS_traceCreateTool(activityState, { ...step, id });
    activityState.trace.toolMap.set(id, entry);
  } else {
    entry.item.querySelector(".thinking-trace-item-title").textContent = step.tool === "MEMORY" ? "Memória atualizada" : BOREAS_traceToolTitle(step.tool, step.value);
    BOREAS_traceOutput(entry.item, step.output);
  }
  activityState.trace.current = entry;
  return entry.item;
}

function closeActivitySegment(state) {
  if (state?.trace) state.trace.current = null;
}
