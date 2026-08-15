// Boreas — anexos, imagens, compressão, preview e IndexedDB.

const FILE_KIND_ICONS = {
  image:    `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>`,
  audio:    `<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>`,
  video:    `<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"></path><rect x="2" y="6" width="14" height="12" rx="2"></rect>`,
  document: `<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line>`,
  code:     `<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>`,
  other:    `<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline>`,
};

const FILE_KIND_META = {
  image:    { color: "#3ddc84", label: "Imagem" },
  audio:    { color: "#f5c518", label: "Áudio" },
  video:    { color: "#4da3ff", label: "Vídeo" },
  document: { color: "#ff5c5c", label: "Documento" },
  code:     { color: "#ffffff", label: "Código" },
  other:    { color: "#b07cff", label: "Arquivo" },
};

const IMAGE_EXTS = new Set(["jpg","jpeg","png","gif","webp","bmp","svg","heic","heif","avif","tiff"]);
const AUDIO_EXTS = new Set(["mp3","wav","ogg","flac","m4a","aac","wma","opus"]);
const VIDEO_EXTS = new Set(["mp4","mov","avi","mkv","webm","flv","wmv","m4v"]);
const CODE_EXTS  = new Set(["js","mjs","cjs","ts","tsx","jsx","py","rb","go","java","c","cpp","h","hpp","cs","php","rs","swift","kt","lua","pl","ex","exs","erl","hs","clj","lisp","dart","vue","astro","svelte","graphql","gql","proto","tf","sh","bash","zsh","fish","sql","r"]);
const DOC_EXTS   = new Set(["pdf","doc","docx","txt","md","markdown","csv","tsv","xls","xlsx","ppt","pptx","rtf","odt","odp","ods","epub","json","yaml","yml","toml","ini","env","html","htm","css","scss","sass","less","xml"]);

function classifyFile(name, mime) {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const m = mime || "";
  if (m.startsWith("image/") || IMAGE_EXTS.has(ext)) return "image";
  if (m.startsWith("audio/") || AUDIO_EXTS.has(ext)) return "audio";
  if (m.startsWith("video/") || VIDEO_EXTS.has(ext)) return "video";
  if (CODE_EXTS.has(ext)) return "code";
  if (DOC_EXTS.has(ext) || m === "application/pdf" || m.startsWith("text/")) return "document";
  return "other";
}

function fileIconSvg(kind) {
  const path = FILE_KIND_ICONS[kind] ?? FILE_KIND_ICONS.other;
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function createAttachCard({ name, mime, removable = false, onRemove = null, onClick = null } = {}) {
  const kind = classifyFile(name, mime);
  const meta = FILE_KIND_META[kind];

  const card = document.createElement("div");
  card.className = "attach-card";
  card.title = name;

  const iconWrap = document.createElement("div");
  iconWrap.className = "attach-card-icon";
  iconWrap.style.background = meta.color + "26";
  iconWrap.style.color = meta.color;
  iconWrap.innerHTML = fileIconSvg(kind);
  card.appendChild(iconWrap);

  if (removable) {
    const rm = document.createElement("div");
    rm.className = "attach-card-remove";
    rm.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    rm.title = "Remover";
    rm.addEventListener("click", e => { e.stopPropagation(); onRemove?.(); });
    card.appendChild(rm);
  }

  const info = document.createElement("div");
  const nameEl = document.createElement("div");
  nameEl.className = "attach-card-name";
  nameEl.textContent = name;
  const metaEl = document.createElement("div");
  metaEl.className = "attach-card-meta";
  metaEl.textContent = meta.label;
  info.appendChild(nameEl);
  info.appendChild(metaEl);
  card.appendChild(info);

  if (onClick) card.addEventListener("click", onClick);
  return card;
}

function createFileCard(name, b64, mime) {
  // Preserva acentos/Unicode e remove somente caracteres que quebrariam o
  // atributo download ou permitiriam transformar o nome em um caminho.
  const downloadName = String(name ?? "arquivo")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 180) || "arquivo";
  const card = createAttachCard({ name: downloadName, mime, removable: false });
  card.classList.add("file-download-card");
  card.title = "Baixar arquivo";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "file-download-btn";
  downloadBtn.setAttribute("aria-label", `Baixar ${downloadName}`);
  downloadBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M4 19h16"></path></svg>`;
  downloadBtn.addEventListener("click", event => {
    event.stopPropagation();
    // Converte o base64 em arquivo antes de iniciar o download. O Blob evita
    // que emojis, acentos e caracteres não latinos sejam perdidos em data URLs.
    try {
      const raw = String(b64 ?? "");
      const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error("[createFileCard] base64 corrompido:", e);
      alert("Não foi possível baixar o arquivo — os dados estão corrompidos.");
    }
  });
  card.appendChild(downloadBtn);
  return card;
}

const SVG_COPY  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar`;
const SVG_CHECK = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copiado`;

function copyText(text, btn) {
  function done() {
    btn.classList.add("copied"); btn.innerHTML = SVG_CHECK;
    setTimeout(() => { btn.classList.remove("copied"); btn.innerHTML = SVG_COPY; }, 2000);
  }
  function execFallback() {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;opacity:0;top:0;left:0;pointer-events:none";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); done(); } catch {}
    document.body.removeChild(ta);
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(execFallback);
  } else {
    execFallback();
  }
}
const IMG_DB_NAME = "boreas_images";
let _imgDb = null;

function openImgDb() {
  if (_imgDb) return Promise.resolve(_imgDb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(IMG_DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore("images");
    req.onsuccess = e => { _imgDb = e.target.result; res(_imgDb); };
    req.onerror   = e => rej(e.target.error);
  });
}
async function idbSetImage(key, b64) {
  const db = await openImgDb();
  return new Promise((res, rej) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put(b64, key);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  });
}
async function idbGetImage(key) {
  const db = await openImgDb();
  return new Promise((res, rej) => {
    const tx = db.transaction("images", "readonly");
    const req = tx.objectStore("images").get(key);
    req.onsuccess = () => res(req.result ?? null);
    req.onerror = e => rej(e.target.error);
  });
}
async function idbDeleteByPrefix(prefix) {
  const db = await openImgDb();
  // Antes: cursor.delete() seguido de cursor.continue() no mesmo onsuccess.
  // O delete() e o continue() são duas requests enfileiradas na mesma
  // transação, mas em alguns engines o continue() reposiciona o cursor
  // antes do delete() ser efetivado, pulando a entrada seguinte (fica
  // órfã no IndexedDB). Fix: primeiro coleta todas as chaves que batem
  // com o prefixo (só navegando o cursor, sem mutar nada), e só depois
  // dispara um store.delete(key) por chave - chaves não dependem mais
  // da posição do cursor, então nenhuma é pulada.
  const keys = await new Promise((res, rej) => {
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    const req = store.openCursor();
    const found = [];
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) { res(found); return; }
      if (String(cursor.key).startsWith(prefix)) found.push(cursor.key);
      cursor.continue();
    };
    req.onerror = e => rej(e.target.error);
  });
  if (!keys.length) return;
  return new Promise((res, rej) => {
    const tx = db.transaction("images", "readwrite");
    const store = tx.objectStore("images");
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  });
}

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    const cleanup = () => { clearTimeout(timer); URL.revokeObjectURL(url); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Não foi possível ler "${file.name}" — formato não suportado (tente JPG/PNG) ou arquivo corrompido.`));
    }, 10000);
    img.onload = () => {
      cleanup();
      const scale = Math.min(1, 600 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      cleanup();
      reject(new Error(`Não foi possível ler "${file.name}" — formato não suportado (tente JPG/PNG) ou arquivo corrompido.`));
    };
    img.src = url;
  });
}

const attachBtn    = document.getElementById("attach-btn");
const fileInput    = document.getElementById("file-input");
const anyFileInput = document.getElementById("any-file-input");
const previewWrap  = document.getElementById("image-preview-wrap");

const MAX_IMAGES = 5;

function renderPreviewThumbs() {
  previewWrap.querySelectorAll(".preview-thumb").forEach(el => el.remove());
  pendingImages.forEach((b64, i) => {
    const thumb = document.createElement("div");
    thumb.className = "preview-thumb";
    const img = document.createElement("img");
    img.src = b64;
    img.addEventListener("click", e => { e.stopPropagation(); openLightbox(b64); });
    const rm = document.createElement("div");
    rm.className = "thumb-remove";
    rm.textContent = "✕";
    rm.addEventListener("click", e => {
      e.stopPropagation();
      pendingImages.splice(i, 1);
      renderPreviewThumbs();
      sendBtn.disabled = !msgInput.value.trim() && !pendingImages.length && !pendingFile;
    });
    thumb.appendChild(img); thumb.appendChild(rm);
    previewWrap.appendChild(thumb);
  });
  previewWrap.classList.toggle("show", pendingImages.length > 0 || !!pendingFile);
}

// Serializa a adição de imagens para respeitar o limite por lote e manter o envio consistente.
let _addImagesChain = Promise.resolve();
function addPendingImages(files) {
  const run = _addImagesChain.then(() => addPendingImagesLocked(files));
  // Nunca deixa uma rejeição travar a fila pra sempre.
  _addImagesChain = run.catch(() => {});
  return run;
}
async function addPendingImagesLocked(files) {
  try {
    const room = MAX_IMAGES - pendingImages.length;
    if (room <= 0) { alert(`Você só pode enviar até ${MAX_IMAGES} fotos por vez.`); return; }
    const toAdd = Array.from(files).slice(0, room);
    if (files.length > toAdd.length) alert(`Você só pode enviar até ${MAX_IMAGES} fotos por vez. Só as ${toAdd.length} primeiras foram adicionadas.`);
    pendingFile = null;
    for (const file of toAdd) {
      // Revalida a cada iteração: outra chamada só entra depois que esta
      // terminar (fila acima), mas isso também protege contra o próprio
      // loop empurrar além do limite se `room` tiver sido otimista.
      if (pendingImages.length >= MAX_IMAGES) break;
      const b64 = await compressImage(file);
      pendingImages.push(b64);
    }
    previewWrap.querySelector("#file-name-label")?.remove();
    renderPreviewThumbs();
  } catch (err) {
    console.error("[addPendingImages]", err);
    alert("Não foi possível adicionar a imagem: " + (err?.message || err));
  }
}

const attachSheet         = document.getElementById("attach-sheet");
const attachSheetBackdrop = document.getElementById("attach-sheet-backdrop");
const cameraInput         = document.getElementById("camera-input");
const asheetSearchToggle  = document.getElementById("asheet-websearch-toggle");

function openAttachSheet() {
  attachSheet.classList.add("open");
  attachSheetBackdrop.classList.add("show");
  syncWebSearchToggle();
}
function closeAttachSheet() {
  attachSheet.classList.remove("open");
  attachSheetBackdrop.classList.remove("show");
}
attachBtn.addEventListener("click", e => { e.stopPropagation(); openAttachSheet(); });
document.getElementById("asheet-close").addEventListener("click", closeAttachSheet);
attachSheetBackdrop.addEventListener("click", closeAttachSheet);

function tryOpenImagePicker(input) {
  if (NO_VISION_TIERS.includes(currentTier)) {
    closeAttachSheet();
    alert(`Boreas ${NO_VISION_LABEL[currentTier] ?? currentTier} não suporta imagens. Troque de modelo pra enviar imagens.`);
    return;
  }
  closeAttachSheet();
  input.click();
}
document.getElementById("asheet-camera").addEventListener("click", () => tryOpenImagePicker(cameraInput));
document.getElementById("asheet-photos").addEventListener("click", () => tryOpenImagePicker(fileInput));
document.getElementById("asheet-files").addEventListener("click", () => { closeAttachSheet(); anyFileInput.click(); });

async function handleImagePickerChange(input) {

  const files = Array.from(input.files); input.value = "";
  if (!files.length) return;
  try {
    await addPendingImages(files);
  } catch (err) {
    console.error("[imagePicker change]", err);
    alert("Erro ao adicionar imagem: " + (err?.message || err));
  }
}
fileInput.addEventListener("change", () => handleImagePickerChange(fileInput));
cameraInput.addEventListener("change", () => handleImagePickerChange(cameraInput));

let webSearchCapCache = true;
async function syncWebSearchToggle() {
  const sessionId = localStorage.getItem("boreas_session_id");
  if (!sessionId) { asheetSearchToggle.classList.toggle("on", webSearchCapCache); return; }
  try {
    const r = await fetch(BACKEND_URL + "/capabilities", { headers: { "x-session-id": sessionId } });
    if (r.ok) webSearchCapCache = (await r.json()).capabilities?.webSearch !== false;
  } catch {}
  asheetSearchToggle.classList.toggle("on", webSearchCapCache);
}
asheetSearchToggle.addEventListener("click", async e => {
  e.stopPropagation();
  webSearchCapCache = !asheetSearchToggle.classList.contains("on");
  asheetSearchToggle.classList.toggle("on", webSearchCapCache);
  const sessionId = localStorage.getItem("boreas_session_id");
  if (!sessionId) return;
  try {
    await fetch(BACKEND_URL + "/capabilities", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-session-id": sessionId },
      body: JSON.stringify({ webSearch: webSearchCapCache }),
    });
  } catch {}
});
anyFileInput.addEventListener("change", async () => {
  const file = anyFileInput.files[0]; if (!file) return; anyFileInput.value = "";
  if (file.type.startsWith("image/")) {

    if (NO_VISION_TIERS.includes(currentTier)) {
      alert(`Boreas ${NO_VISION_LABEL[currentTier] ?? currentTier} não suporta imagens. Troque de modelo pra enviar imagens.`);
      return;
    }
    await addPendingImages([file]);
  } else {
    if (file.size > 30 * 1024 * 1024) { alert("Arquivo muito grande. Limite: 30 MB."); return; }

    const TEXT_EXTS = [
      ".txt",".md",".markdown",".js",".mjs",".cjs",".ts",".tsx",".jsx",
      ".py",".rb",".go",".java",".c",".cpp",".h",".hpp",".cs",".php",
      ".css",".scss",".sass",".less",".html",".htm",".xml",".svg",
      ".json",".yaml",".yml",".toml",".ini",".env",".csv",".tsv",
      ".sh",".bash",".zsh",".fish",".sql",".r",".swift",".kt",".rs",
      ".lua",".pl",".ex",".exs",".erl",".hs",".clj",".lisp",".dart",
      ".vue",".astro",".svelte",".graphql",".gql",".proto",".tf",
    ];
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    const isText = file.type.startsWith("text/")
      || file.type === "application/json"
      || file.type === "application/javascript"
      || file.type === "application/xml"
      || TEXT_EXTS.includes(ext);
    if (!isText) {
      alert(`"${file.name}" não é suportado.\n\nSomente arquivos de texto e código são aceitos (js, py, txt, json, html, csv, etc.).\n\nPara imagens, use o botão "Imagem".`);
      return;
    }
    try {
      const content = await file.text();
      pendingImages = [];
      pendingFile = { name: file.name, content, type: file.type };
      renderPreviewThumbs();
      previewWrap.querySelector("#file-name-label")?.remove();
      const card = createAttachCard({
        name: file.name,
        mime: file.type,
        removable: true,
        onRemove: () => {
          pendingFile = null;
          card.remove();
          renderPreviewThumbs();
          sendBtn.disabled = !msgInput.value.trim() && !pendingImages.length && !pendingFile;
        },
      });
      card.id = "file-name-label";
      previewWrap.appendChild(card);
      sendBtn.disabled = false;
    } catch { alert("Não foi possível ler este arquivo."); }
  }
});

const lightboxOverlay = document.getElementById("lightbox-overlay");
const lightboxImg     = document.getElementById("lightbox-img");
function openLightbox(src) {
  lightboxImg.src = src;
  lightboxOverlay.classList.add("show");
}
function closeLightbox() {
  lightboxOverlay.classList.remove("show");
  lightboxImg.src = "";
}
document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
lightboxOverlay.addEventListener("click", e => {
  if (e.target === lightboxOverlay) closeLightbox();
});

document.querySelectorAll("img").forEach(img => {
  img.addEventListener("contextmenu", e => e.preventDefault());
});

document.addEventListener("contextmenu", e => {
  if (e.target.tagName === "IMG") e.preventDefault();
});
