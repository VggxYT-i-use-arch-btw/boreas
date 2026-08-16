// Boreas: loading screen, onboarding e autenticação.

(function () {
  var PHRASES = [
    "Criado para resolver problemas",
    "Feito para você",
    "Sua criatividade, sem limites",
    "Construa o que você quiser",
    "Continue pensando, criando e agindo",
    "Transforme ideias em realidade",
    "Crie sem barreiras",
    "Onde suas ideias ganham vida",
    "Imagine. Crie. Evolua.",
    "Do conceito à criação",
    "Pense mais, faça mais",
    "Seu tempo, seu ritmo",
    "Onde cada ideia tem espaço",
    "Sua imaginação, amplificada",
    "Seu próximo passo começa aqui",
  ];

  var phraseEl = document.getElementById("ob-typing-text");
  if (!phraseEl) return;
  var cursor = phraseEl.querySelector(".ob-cursor");
  var textNode = document.createTextNode("");
  phraseEl.insertBefore(textNode, cursor);
  var lastIndex = -1;

  function setCursorBlink(enabled) { cursor.classList.toggle("blinking", enabled); }
  function nextPhrase() {
    var index;
    do { index = Math.floor(Math.random() * PHRASES.length); } while (index === lastIndex);
    lastIndex = index;
    return PHRASES[index] + ". ";
  }
  function typePhrase() {
    var phrase = nextPhrase();
    var index = 0;
    setCursorBlink(false);
    textNode.nodeValue = "";
    var timer = setInterval(function () {
      textNode.nodeValue = phrase.slice(0, ++index);
      if (index >= phrase.length) {
        clearInterval(timer);
        setCursorBlink(true);
        setTimeout(function () { erasePhrase(phrase); }, 2800);
      }
    }, 42);
  }
  function erasePhrase(phrase) {
    var index = phrase.length;
    setCursorBlink(false);
    var timer = setInterval(function () {
      textNode.nodeValue = phrase.slice(0, --index);
      if (index <= 0) {
        clearInterval(timer);
        setTimeout(typePhrase, 120);
      }
    }, 18);
  }
  typePhrase();
})();

(function () {
  function initAuth() {
    var loadingEl = document.getElementById("loading-screen");
    var onboardEl = document.getElementById("onboard-screen");
    var chatEl = document.getElementById("chat-screen");
    var barEl = document.getElementById("loading-bar");
    var formSheet = document.getElementById("ob-form-sheet");
    var formTitle = document.getElementById("ob-form-title");
    var formSubtitle = document.getElementById("ob-form-subtitle");
    var formStep = document.getElementById("ob-form-step");
    var submitBtn = document.getElementById("ob-submit");
    var switchBtn = document.getElementById("ob-switch-mode");
    var errorEl = document.getElementById("ob-error");
    var currentMode = "login";

    function showChat() {
      if (loadingEl) loadingEl.style.display = "none";
      if (onboardEl) onboardEl.style.display = "none";
      if (chatEl) chatEl.style.display = "flex";
    }
    function showOnboard() {
      if (loadingEl) loadingEl.style.display = "none";
      if (onboardEl) onboardEl.style.display = "flex";
      if (chatEl) chatEl.style.display = "none";
    }
    function setError(message) { if (errorEl) errorEl.textContent = message || ""; }
    function setMode(mode) {
      currentMode = mode === "register" ? "register" : "login";
      var isRegister = currentMode === "register";
      document.querySelectorAll(".ob-register-fields").forEach(function (el) {
        el.classList.toggle("is-hidden", !isRegister);
      });
      formTitle.textContent = isRegister ? "Crie sua conta" : "Entrar na sua conta";
      formSubtitle.textContent = isRegister
        ? "Personalize sua experiência no Boreas desde o início."
        : "Continue de onde você parou.";
      formStep.textContent = isRegister ? "02" : "01";
      submitBtn.textContent = isRegister ? "Criar conta" : "Fazer login";
      switchBtn.textContent = isRegister ? "Já tenho uma conta" : "Ainda não tenho uma conta";
      document.getElementById("ob-pass").setAttribute("autocomplete", isRegister ? "new-password" : "current-password");
      setError("");
    }
    function openForm(mode) {
      setMode(mode);
      formSheet.classList.add("open");
      setTimeout(function () {
        var first = document.getElementById(currentMode === "register" ? "ob-name" : "ob-email");
        if (first) first.focus();
      }, 250);
    }
    function closeForm() { formSheet.classList.remove("open"); }

    var wasOnboarded = localStorage.getItem("boreas_onboarded") === "true";
    var hasName = !!localStorage.getItem("boreas_name");
    if (wasOnboarded && !hasName) {
      localStorage.removeItem("boreas_onboarded");
      wasOnboarded = false;
    }
    if (wasOnboarded) { showChat(); return; }

    setMode("login");
    document.getElementById("ob-login-btn").addEventListener("click", function () { openForm("login"); });
    document.getElementById("ob-register-btn").addEventListener("click", function () { openForm("register"); });
    document.getElementById("ob-form-back").addEventListener("click", closeForm);
    switchBtn.addEventListener("click", function () { setMode(currentMode === "login" ? "register" : "login"); });
    document.getElementById("ob-checkbox").addEventListener("click", function () {
      this.classList.toggle("checked");
      this.setAttribute("aria-checked", this.classList.contains("checked") ? "true" : "false");
    });
    onboardEl.addEventListener("click", function (event) {
      if (event.target === onboardEl) closeForm();
    });
    formSheet.addEventListener("click", function (event) { event.stopPropagation(); });

    function persistAndGo(sessionId, resolvedName, use) {
      var email = document.getElementById("ob-email").value.trim();
      var savedName = resolvedName || localStorage.getItem("boreas_name") || email.split("@")[0];
      localStorage.setItem("boreas_onboarded", "true");
      localStorage.setItem("boreas_name", savedName);
      localStorage.setItem("boreas_use", use || localStorage.getItem("boreas_use") || "");
      localStorage.setItem("boreas_email", email);
      localStorage.setItem("boreas_session_id", sessionId);
      localStorage.removeItem("boreas_active_chat_v2");
      if (typeof _chatsMeta !== "undefined") {
        for (var key in _chatsMeta) delete _chatsMeta[key];
      }
      if (typeof setGreeting === "function") setGreeting();
      showChat();
    }

    function submitAuth() {
      var name = document.getElementById("ob-name").value.trim();
      var use = document.getElementById("ob-use").value.trim();
      var email = document.getElementById("ob-email").value.trim();
      var password = document.getElementById("ob-pass").value;
      var password2 = document.getElementById("ob-pass2").value;
      var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      setError("");

      if (!email) return setError("Digite seu e-mail.");
      if (!emailRe.test(email)) return setError("Digite um e-mail válido.");
      if (!password) return setError("Digite sua senha.");
      if (currentMode === "register") {
        if (!name) return setError("Digite como quer ser chamado.");
        if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
        if ((password.match(/\d/g) || []).length < 2) return setError("A senha precisa ter pelo menos 2 números.");
        if (password !== password2) return setError("As senhas não coincidem.");
        if (!document.getElementById("ob-checkbox").classList.contains("checked")) return setError("Aceite os termos para criar sua conta.");
      }

      submitBtn.disabled = true;
      submitBtn.textContent = currentMode === "register" ? "Criando conta..." : "Entrando...";
      var backend = globalThis.BOREAS_BACKEND_URL || ((typeof BACKEND_URL !== "undefined") ? BACKEND_URL : "");
      if (!backend) {
        setError("Servidor indisponível no momento.");
        submitBtn.disabled = false;
        setMode(currentMode);
        return;
      }

      var endpoint = currentMode === "register" ? "/register" : "/login";
      var payload = currentMode === "register"
        ? { name: name, use: use, email: email, password: password }
        : { email: email, password: password };
      fetch(backend + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async function (response) {
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok || !data.sessionId) {
          if (response.status === 409) {
            setMode("login");
            setError("Essa conta já existe. Entre com sua senha.");
          } else {
            setError(data.error || (currentMode === "register" ? "Não foi possível criar sua conta." : "E-mail ou senha incorretos."));
          }
          submitBtn.disabled = false;
          return;
        }
        persistAndGo(data.sessionId, data.name, data.use || use);
      }).catch(function () {
        setError("Sem conexão com o servidor. Tente novamente.");
        submitBtn.disabled = false;
        submitBtn.textContent = currentMode === "register" ? "Criar conta" : "Fazer login";
      });
    }

    submitBtn.addEventListener("click", submitAuth);
    ["ob-email", "ob-pass", "ob-pass2", "ob-name"].forEach(function (id) {
      document.getElementById(id).addEventListener("keydown", function (event) {
        if (event.key === "Enter") submitAuth();
      });
    });

    var images = [
      "https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/loginback.png",
      "https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png",
      "https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/cooleffect.png",
    ];
    var progress = 0;
    var ticker = setInterval(function () {
      if (progress < 72) {
        progress = Math.min(progress + Math.random() * 8, 72);
        if (barEl) barEl.style.width = progress + "%";
      }
    }, 150);
    var loaded = 0;
    var settled = false;
    function proceed() {
      if (settled) return;
      settled = true;
      clearInterval(ticker);
      if (barEl) barEl.style.width = "100%";
      setTimeout(showOnboard, 260);
    }
    images.forEach(function (src) {
      var image = new Image();
      image.onload = image.onerror = function () {
        loaded++;
        if (barEl) barEl.style.width = Math.min(72 + loaded / images.length * 28, 99) + "%";
        if (loaded >= images.length) proceed();
      };
      image.src = src;
    });
    setTimeout(proceed, 8000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAuth, { once: true });
  else initAuth();
})();
