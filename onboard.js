// Boreas — loading screen, onboarding e autenticação.

(function() {
  var PHRASES = [
    "Criado para resolver problemas",
    "Feito para você",
    "Sua criatividade, sem limites",
    "Construa o que você quiser",
    "Boreas, onde o controle é totalmente seu",
    "Continue pensando, criando, e agindo",
    "Transforme ideias em realidade",
    "Crie sem barreiras",
    "Onde suas ideias ganham vida",
    "Imagine. Crie. Evolua.",
    "Do conceito à criação",
    "Construa o impossível",
    "Faça acontecer",
    "Onde a liberdade não tem limites",
    "Pense mais, faça mais",
    "Seu tempo, seu ritmo",
    "Simples assim",
    "Onde o impossível vira rotina",
    "Onde cada ideia tem espaço",
    "Onde o futuro começa agora",
    "Sua imaginação, amplificada",
    "Seu próximo passo começa aqui",
    "Criar é humano. Evoluir, também",
    "Menos obstáculos, mais criação"
  ];
  var lastIdx = -1;
  var el = document.getElementById('ob-typing-text');
  if (!el) return;

  var cursorSpan = el.querySelector('.ob-cursor');
  var textNode = document.createTextNode('');
  el.insertBefore(textNode, cursorSpan);

  var TYPE_MS  = (60 * 1000) / (175 * 5);
  var ERASE_MS = (60 * 1000) / (375 * 5);
  var SLEEP_MS = 2800;

  function render(text) { textNode.nodeValue = text; }
  function setCursorBlink(on) {
    cursorSpan.classList.toggle('blinking', on);
  }

  function nextPhrase() {
    var idx;
    do { idx = Math.floor(Math.random() * PHRASES.length); } while (idx === lastIdx);
    lastIdx = idx;
    return PHRASES[idx] + '. ';
  }

  function typePhrase() {
    setCursorBlink(false);
    var phrase = nextPhrase();
    var i = 0;
    render('');
    var write = setInterval(function() {
      i++;
      render(phrase.slice(0, i));
      if (i >= phrase.length) {
        clearInterval(write);
        setCursorBlink(true);
        setTimeout(function() {
          setCursorBlink(false);
          erasePhrase(phrase);
        }, SLEEP_MS);
      }
    }, TYPE_MS);
  }

  function erasePhrase(phrase) {
    var j = phrase.length;
    var erase = setInterval(function() {
      j--;
      render(j > 0 ? phrase.slice(0, j) : '');
      if (j <= 0) {
        clearInterval(erase);
        setTimeout(typePhrase, 120);
      }
    }, ERASE_MS);
  }

  typePhrase();

  var openBtn  = document.getElementById('ob-open-form');
  var formSheet = document.getElementById('ob-form-sheet');
  if (openBtn && formSheet) {
    openBtn.addEventListener('click', function() {
      formSheet.classList.add('open');
      setTimeout(function() {
        var first = document.getElementById('ob-name');
        if (first) first.focus();
      }, 350);
    });
    formSheet.addEventListener('click', function(e) { e.stopPropagation(); });
    document.getElementById('onboard-screen').addEventListener('click', function() {
      formSheet.classList.remove('open');
    });
  }
})();
(function() {
  function initAuth() {
  var ASSET_URL = 'https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/loginback.png';
  var loadingEl = document.getElementById('loading-screen');
  var onboardEl = document.getElementById('onboard-screen');
  var chatEl    = document.getElementById('chat-screen');
  var barEl     = document.getElementById('loading-bar');

  function showChat() {
    loadingEl.style.display = 'none';
    onboardEl.style.display = 'none';
    chatEl.style.display    = 'flex';
  }
  function showOnboard() {
    loadingEl.style.display = 'none';
    onboardEl.style.display = 'flex';
    chatEl.style.display    = 'none';
  }

  var wasOnboarded = localStorage.getItem('boreas_onboarded') === 'true';
  var hasName      = !!localStorage.getItem('boreas_name');
  if (wasOnboarded && !hasName) { localStorage.removeItem('boreas_onboarded'); wasOnboarded = false; }

  if (wasOnboarded) { showChat(); return; }

  var IMAGES = [
    'https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/loginback.png',
    'https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/boreas.png',
    'https://raw.githubusercontent.com/VggxYT-i-use-arch-btw/chatly/main/cooleffect.png',
  ];

  var progress = 0;
  var ticker = setInterval(function() {
    if (progress < 70) { progress = Math.min(progress + Math.random() * 8, 70); if (barEl) barEl.style.width = progress + '%'; }
  }, 150);

  var settled = false;
  function proceed() {
    if (settled) return; settled = true; clearInterval(ticker);
    if (barEl) barEl.style.width = '100%';
    setTimeout(showOnboard, 280);
  }

  var total = IMAGES.length, done = 0;
  IMAGES.forEach(function(src) {
    var i = new Image();
    i.onload = i.onerror = function() {
      done++; progress = Math.min(70 + (done / total) * 30, 99);
      if (barEl) barEl.style.width = progress + '%';
      if (done >= total) proceed();
    };
    i.src = src;
  });
  setTimeout(proceed, 8000);

  var cb = document.getElementById('ob-checkbox');
  if (cb) cb.addEventListener('click', function() { cb.classList.toggle('checked'); });

  var submitBtn = document.getElementById('ob-submit');
  if (submitBtn) submitBtn.addEventListener('click', function() {
    var name  = document.getElementById('ob-name').value.trim();
    var use   = document.getElementById('ob-use').value.trim();
    var email = document.getElementById('ob-email').value.trim();
    var pass  = document.getElementById('ob-pass').value;
    var pass2 = document.getElementById('ob-pass2').value;
    var errEl = document.getElementById('ob-error');

    errEl.textContent = '';
    if (!name)  return (errEl.textContent = 'Digite como quer ser chamado.');
    if (!email) return (errEl.textContent = 'Digite seu e-mail.');
    var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRe.test(email)) return (errEl.textContent = 'E-mail inválido. Ex: nome@email.com');
    if (!pass)             return (errEl.textContent = 'Digite uma senha.');
    if (pass.length < 8)   return (errEl.textContent = 'Senha precisa ter ao menos 8 caracteres.');
    var numCount = (pass.match(/\d/g) || []).length;
    if (numCount < 2)      return (errEl.textContent = 'Senha precisa ter ao menos 2 números.');
    if (pass !== pass2)    return (errEl.textContent = 'As senhas não coincidem.');

    submitBtn.disabled = true; submitBtn.textContent = 'Entrando...';

    var bUrl = (typeof BACKEND_URL !== 'undefined') ? BACKEND_URL : '';
    function goChat() {
      if (typeof setGreeting === 'function') setGreeting();
      var chatEl2 = document.getElementById('chat-screen');
      if (chatEl2) chatEl2.style.display = 'flex';
      var lEl = document.getElementById('loading-screen');
      var oEl = document.getElementById('onboard-screen');
      if (lEl) lEl.style.display = 'none';
      if (oEl) oEl.style.display = 'none';
    }
    function persistAndGo(sessionId, resolvedName) {
      localStorage.setItem('boreas_onboarded', 'true');
      localStorage.setItem('boreas_name', resolvedName || name);
      localStorage.setItem('boreas_use', use);
      localStorage.setItem('boreas_email', email);
      // Guarda o session id real devolvido pelo servidor - é ele que vai
      // no header x-session-id de toda chamada autenticada do app.
      localStorage.setItem('boreas_session_id', sessionId);

      localStorage.removeItem('boreas_active_chat_v2');

      if (typeof _chatsMeta !== 'undefined') {
        for (var k in _chatsMeta) delete _chatsMeta[k];
      }
      goChat();
    }
    function tryLogin() {
      submitBtn.textContent = 'Entrando na conta...';
      fetch(bUrl + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass })
      })
      .then(async lr => {
        const ldata = await lr.json();
        if (!lr.ok || !ldata.sessionId) {
          errEl.textContent = 'Conta já existe — ' + (ldata.error ?? 'senha incorreta.');
          submitBtn.disabled = false; submitBtn.textContent = 'Entrar / Criar conta';
          return;
        }
        persistAndGo(ldata.sessionId, ldata.name);
      })
      .catch(() => {
        errEl.textContent = 'Sem conexão com o servidor.';
        submitBtn.disabled = false; submitBtn.textContent = 'Entrar / Criar conta';
      });
    }
    if (bUrl) {
      fetch(bUrl + '/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, use, email, password: pass })
      })
      .then(async r => {
        const data = await r.json();

        if (r.status === 409) { tryLogin(); return; }
        if (!r.ok || !data.sessionId) {
          errEl.textContent = data.error ?? 'Erro ao criar conta.';
          submitBtn.disabled = false; submitBtn.textContent = 'Entrar / Criar conta';
          return;
        }
        persistAndGo(data.sessionId, data.name);
      })
      .catch(() => {
        errEl.textContent = 'Sem conexão com o servidor.';
        submitBtn.disabled = false; submitBtn.textContent = 'Entrar / Criar conta';
      });
    } else {
      goChat();
    }
  });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth, { once: true });
  } else {
    initAuth();
  }
})();
