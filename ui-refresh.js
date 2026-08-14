// Pequenas interações da camada visual nova. Não substitui os módulos de chat.

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
    search.addEventListener("input", () => {
      const query = search.value.trim().toLocaleLowerCase();
      document.querySelectorAll("#sidebar-chat-list .sidebar-chat-item").forEach(item => {
        item.hidden = !!query && !item.textContent.toLocaleLowerCase().includes(query);
      });
    });
  }
})();
