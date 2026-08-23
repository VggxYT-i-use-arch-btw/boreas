// Pequenas interações da camada visual nova. Não substitui os módulos de chat.

// Theme is currently fixed by the application shell, but old/local data can
// still contain arbitrary values. Keep that state constrained before any
// future theme consumer reads it.
(function validateStoredTheme() {
  const allowed = new Set(["dark", "light", "system"]);
  try {
    const value = localStorage.getItem("boreas_theme");
    if (value !== null && !allowed.has(value)) localStorage.removeItem("boreas_theme");
  } catch {}
})();

(function () {
  const input = document.getElementById("msg-input");
  document.querySelectorAll("#starter-chips [data-starter]").forEach(chip => {
    chip.addEventListener("click", () => {
      if (!input) return;
      input.value = chip.dataset.starter || "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });
  });

  const search = document.getElementById("sidebar-search-input");
  if (search) {
    let searchTimer = null;
    let searchRequest = 0;
    window.__boreasSearchQuery = "";
    window.__boreasSearchResults = [];
    window.__boreasSearchPending = false;

    search.addEventListener("input", () => {
      const query = search.value.trim();
      clearTimeout(searchTimer);
      searchRequest += 1;
      const requestId = searchRequest;
      window.__boreasSearchQuery = query.length >= 2 ? query : "";
      window.__boreasSearchResults = [];
      window.__boreasSearchPending = query.length >= 2;
      renderSidebar();
      if (query.length < 2) return;

      searchTimer = setTimeout(async () => {
        const matches = await BoreasSync.chats.search(query);
        if (requestId !== searchRequest) return;
        window.__boreasSearchResults = matches;
        window.__boreasSearchPending = false;
        renderSidebar();
      }, 220);
    });
  }
})();
