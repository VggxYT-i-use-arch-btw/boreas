// Boreas frontend module: sources, Markdown, math, highlighting, and tool result visuals.
// Loaded as a classic script in the exact order declared by index.html.

function safeExternalUrl(raw) {
  try {
    const parsed = new URL(String(raw ?? ""), location.href);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

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
    const sourceUrl = safeExternalUrl(s?.url);
    if (!sourceUrl) return;
    const a = document.createElement("a");
    a.className = "sources-link"; a.href = sourceUrl; a.target = "_blank"; a.rel = "noopener noreferrer";
    try {
      const ico = document.createElement("img");
      ico.src = safeExternalUrl(s.favicon) ?? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(sourceUrl).hostname)}&sz=32`;
      ico.onerror = () => { ico.style.display = "none"; };
      a.appendChild(ico);
    } catch {}
    const lbl = document.createElement("span"); lbl.textContent = s.title || sourceUrl;
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
    if (String(node.tagName ?? '').toUpperCase() === 'A' && node.hasAttribute('target')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

if (typeof marked !== 'undefined') {
  const renderer = new marked.Renderer();
  const _origLink = renderer.link.bind(renderer);
  renderer.link = (href, title, text) => {
    const html = _origLink(safeExternalUrl(href) ?? "", title, text);
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

const _markdownRenderState = new WeakMap();
const _mathMarkerRe = /\$\$|\$[^$\n]+\$|\\\(|\\\[/;
const MARKDOWN_RENDER_INTERVAL_MS = 33;

function renderMarkdownNow(el, text) {
  if (!el || el._renderedMarkdownText === text) return;
  el._renderedMarkdownText = text;
  try {
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      const rawHtml = marked.parse(text);
      // marked sempre devolve um "\n" sobrando no final do HTML. Isso vira um
      // nó de texto solto depois da última tag, e como .bubble.user usa
      // white-space:pre-wrap, esse \n é renderizado como uma linha em branco
      // de verdade no final de TODA mensagem - por isso a bolha sempre
      // parecia maior/mais alta do que o texto digitado precisava
      // (confirmado: b.textContent vinha com "\n" no final no console).
      el.innerHTML = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target', 'rel'] }).trim();
    } else {

      el.innerHTML = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      return;
    }
    // KaTeX walks the whole bubble. Most messages contain no math, so avoid
    // paying that cost unless a math delimiter is actually present.
    if (typeof renderMathInElement !== 'undefined' && _mathMarkerRe.test(text)) {
      renderMathInElement(el, {
        delimiters: [
          {left:"$$",right:"$$",display:true},
          {left:"$",right:"$",display:false},
          {left:"\\(",right:"\\)",display:false},
          {left:"\\[",right:"\\]",display:true}
        ],
        throwOnError: false
      });
    }
  } catch(e) {

    el.textContent = text;
  }
}

function renderMarkdown(el, text) {
  const pending = _markdownRenderState.get(el);
  if (pending) {
    clearTimeout(pending.timer);
    _markdownRenderState.delete(el);
  }
  renderMarkdownNow(el, text);
}

// Limit expensive Markdown/highlight/math work during live streaming while
// keeping the final answer exact and immediately available to the user.
function scheduleMarkdownRender(el, text) {
  if (!el) return;
  const pending = _markdownRenderState.get(el);
  if (pending) {
    pending.text = text;
    return;
  }
  const state = { text, timer: 0 };
  state.timer = setTimeout(() => {
    _markdownRenderState.delete(el);
    if (el.isConnected) renderMarkdownNow(el, state.text);
  }, MARKDOWN_RENDER_INTERVAL_MS);
  _markdownRenderState.set(el, state);
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
      const serialized = String(output ?? "");
      if (serialized.length > 1_000_000) return null;
      const spec = JSON.parse(serialized);
      const imgs = (Array.isArray(spec.images) ? spec.images : []).slice(0, 20);
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
      for (const im of imgs) {
        const imageUrl = safeExternalUrl(im?.url);
        const sourceUrl = safeExternalUrl(im?.source_url || im?.url);
        if (!imageUrl || !sourceUrl) continue;
        const card = document.createElement("a");
        card.href = sourceUrl;
        card.target = "_blank";
        card.rel = "noopener noreferrer";
        card.title = im.description || im.domain || "";
        card.style.cssText = "position:relative;flex:0 0 auto;width:200px;height:150px;border-radius:14px;overflow:hidden;display:block;background:var(--surface);border:1px solid var(--border)";
        const img = document.createElement("img");
        img.src = imageUrl; img.loading = "lazy"; img.alt = im.description || im.domain || "";
        img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
        const pill = document.createElement("span");
        pill.style.cssText = "position:absolute;left:8px;bottom:8px;display:flex;align-items:center;gap:5px;background:rgba(20,20,20,.92);color:#fff;font-size:11px;padding:5px 9px;border-radius:999px;max-width:calc(100% - 16px);overflow:hidden";
        if (im.domain) {
          const fav = document.createElement("img");
          try { fav.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(sourceUrl).hostname)}&sz=32`; } catch { fav.remove(); }
          fav.style.cssText = "width:12px;height:12px;border-radius:2px;flex-shrink:0";
          pill.appendChild(fav);
        }
        const domainSpan = document.createElement("span");
        domainSpan.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        domainSpan.textContent = im.domain || "imagem";
        pill.appendChild(domainSpan);
        card.appendChild(img); card.appendChild(pill);
        gallery.appendChild(card);
      }
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
