// Boreas: attachments, images, compression, preview, and IndexedDB.

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

const IMAGE_EXTS = new Set(["jpg","jpeg","png","gif","webp","bmp","heic","heif","avif","tiff"]);
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
  // Preserves accents/Unicode and only strips characters that would break
  // the download attribute or allow the name to be turned into a path.
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
    // Converts the base64 into a file before starting the download. The
      // Blob avoids emojis, accents, and non-Latin characters getting lost in data URLs.
      try {
      const raw = String(b64 ?? "");
      if (raw.length > 24 * 1024 * 1024) throw new Error("arquivo grande demais");
      const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
      // Defense in depth for #18 (mojibake on download): if a text MIME
      // type ever arrives without a charset, add utf-8 here too instead of
      // trusting the browser to guess correctly.
      let blobType = mime || "application/octet-stream";
      if (/^text\//i.test(blobType) && !/charset=/i.test(blobType)) blobType += "; charset=utf-8";
      const url = URL.createObjectURL(new Blob([bytes], { type: blobType }));
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
      alert("Não foi possível baixar o arquivo - os dados estão corrompidos.");
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
const IMG_DB_VERSION = 3;
const ATTACHMENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
let _imgDb = null;

async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted?.())) {
      await navigator.storage.persist();
    }
  } catch {}
}

// The browser can evict IndexedDB under storage pressure. Persistence is
// requested early, and again after an explicit attach action.
requestPersistentStorage();

function openImgDb() {
  if (_imgDb) return Promise.resolve(_imgDb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(IMG_DB_NAME, IMG_DB_VERSION);
    req.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains("images")) e.target.result.createObjectStore("images");
    };
    req.onsuccess = e => {
      _imgDb = e.target.result;
      cleanupExpiredImages().catch(() => {});
      res(_imgDb);
    };
    req.onerror   = e => rej(e.target.error);
  });
}
async function idbSetImage(key, b64) {
  const db = await openImgDb();
  return new Promise((res, rej) => {
    const tx = db.transaction("images", "readwrite");
    const store = tx.objectStore("images");
    const get = store.get(key);
    get.onsuccess = () => {
      const previous = get.result;
      const createdAt = typeof previous === "object" && previous?.createdAt
        ? previous.createdAt
        : Date.now();
      store.put({ data: b64, createdAt, updatedAt: Date.now() }, key);
    };
    get.onerror = e => rej(e.target.error);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  });
}
async function idbGetImage(key) {
  const db = await openImgDb();
  return new Promise((res, rej) => {
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    const req = store.get(key);
    req.onsuccess = () => {
      const value = req.result;
      const data = typeof value === "string" ? value : value?.data;
      res(data ?? null);
    };
    req.onerror = e => rej(e.target.error);
  });
}
async function idbGetImages(keys) {
  const db = await openImgDb();
  const uniqueKeys = [...new Set(keys)];
  return new Promise((res, rej) => {
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    const values = new Map();
    for (const key of uniqueKeys) {
      const req = store.get(key);
      req.onsuccess = () => {
        const value = req.result;
        values.set(key, typeof value === "string" ? value : value?.data ?? null);
      };
      req.onerror = e => rej(e.target.error);
    }
    tx.oncomplete = () => res(values);
    tx.onabort = e => rej(e.target.error ?? new Error("IndexedDB transaction aborted"));
  });
}
async function cleanupExpiredImages() {
  const db = _imgDb;
  if (!db) return;
  const cutoff = Date.now() - ATTACHMENT_RETENTION_MS;
  const expired = await new Promise((res, rej) => {
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    const req = store.openCursor();
    const keys = [];
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) return res(keys);
      const value = cursor.value;
      if (value && typeof value === "object" && value.updatedAt && value.updatedAt < cutoff) keys.push(cursor.key);
      cursor.continue();
    };
    req.onerror = e => rej(e.target.error);
  });
  if (!expired.length) return;
  await new Promise((res, rej) => {
    const tx = db.transaction("images", "readwrite");
    const store = tx.objectStore("images");
    expired.forEach(key => store.delete(key));
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  });
}
setInterval(() => cleanupExpiredImages().catch(() => {}), 6 * 60 * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) cleanupExpiredImages().catch(() => {});
});
async function idbDeleteByPrefix(prefix) {
  const db = await openImgDb();
  // delete() and continue() are two requests queued in the same
  // transaction, but on some engines continue() repositions the cursor
  // before delete() takes effect, skipping the next entry (leaving it
  // orphaned in IndexedDB). Collects every matching key first (cursor
  // read-only, no mutation), then fires one store.delete(key) per key;
  // keys no longer depend on cursor position, so none get skipped.
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

async function idbDeleteWhere(predicate) {
  const db = await openImgDb();
  const keys = await new Promise((res, rej) => {
    const tx = db.transaction("images", "readonly");
    const req = tx.objectStore("images").openCursor();
    const found = [];
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) { res(found); return; }
      if (predicate(cursor.key, cursor.value)) found.push(cursor.key);
      cursor.continue();
    };
    req.onerror = e => rej(e.target.error);
  });
  if (!keys.length) return;
  await new Promise((res, rej) => {
    const tx = db.transaction("images", "readwrite");
    const store = tx.objectStore("images");
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  });
}

async function clearImagesForScope(scope) {
  const normalized = String(scope ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/i.test(normalized)) return;
  await idbDeleteByPrefix(normalized + ":");
}

globalThis.BoreasClearImageStore = clearImagesForScope;
// Account switches and expired sessions don't have a trustworthy prior
// identity to select by in IndexedDB. In those cases, wipe all local
// images; keeping old keys around would just leave a pocket of another
// account's data behind.
globalThis.BoreasClearAllImageStore = () => idbDeleteWhere(() => true);
// Removes references created before the per-session opaque scope. They
// used email as part of the key and can't be safely reassigned.
globalThis.BoreasClearLegacyImageStore = () => idbDeleteWhere(key => {
  const value = String(key ?? "");
  return !/^[a-f0-9]{32}:[A-Za-z0-9_-]{1,80}:\d+:\d+$/i.test(value);
});

// #14: apesar do nome, esta função nunca redimensionava nem reencodava nada
// — só lia o arquivo original via FileReader e devolvia os bytes intactos.
// Em produção (GPU limitada, Termux) isso significa decodificar/renderizar
// fotos de câmera em resolução nativa (ex: 4000x3000) só para caber numa
// bolha de chat de ~260px. GIFs ficam de fora do resize (perderiam a
// animação num canvas estático) e continuam indo como antes.
const MAX_IMAGE_DIM = 1600; // teto de lado maior; suficiente para o modelo ler texto/detalhe em imagem
const IMAGE_JPEG_QUALITY = 0.85;

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    const cleanup = () => { clearTimeout(timer); URL.revokeObjectURL(url); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Não foi possível ler "${file.name}" - formato não suportado (tente JPG/PNG) ou arquivo corrompido.`));
    }, 10000);
    img.onload = () => {
      cleanup();
      if (!Number.isFinite(img.width) || !Number.isFinite(img.height) || img.width < 1 || img.height < 1 || img.width * img.height > 25_000_000) {
        reject(new Error("Imagem muito grande para processar com segurança."));
        return;
      }

      const readOriginal = () => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`Não foi possível ler "${file.name}" - formato não suportado (tente JPG/PNG) ou arquivo corrompido.`));
        reader.readAsDataURL(file);
      };

      // GIF preserva o arquivo original (canvas perderia a animação).
      // Se já está dentro do teto, não vale reencodar - reencode com
      // qualidade 0.85 pode aumentar o tamanho de PNGs já pequenos/simples.
      const isGif = /^image\/gif$/i.test(file.type || "");
      const withinBounds = img.width <= MAX_IMAGE_DIM && img.height <= MAX_IMAGE_DIM;
      if (isGif || withinBounds) {
        readOriginal();
        return;
      }

      try {
        const scale = MAX_IMAGE_DIM / Math.max(img.width, img.height);
        const targetW = Math.max(1, Math.round(img.width * scale));
        const targetH = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) { readOriginal(); return; }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const dataUrl = canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY);
        // Canvas tainted (CORS) ou toDataURL falhou silenciosamente -> cai
        // pro arquivo original em vez de mandar um data URL vazio/quebrado.
        if (!dataUrl || dataUrl === "data:,") { readOriginal(); return; }
        resolve(dataUrl);
      } catch (e) {
        // SecurityError (canvas tainted) ou qualquer outro erro de canvas:
        // não trava o envio, só perde a otimização desta imagem específica.
        readOriginal();
      }
    };
    img.onerror = () => {
      cleanup();
      reject(new Error(`Não foi possível ler "${file.name}" - formato não suportado (tente JPG/PNG) ou arquivo corrompido.`));
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

// Serializes image additions to respect the per-batch limit and keep sends consistent.
let _addImagesChain = Promise.resolve();
function addPendingImages(files) {
  const run = _addImagesChain.then(() => addPendingImagesLocked(files));
  // Never lets a rejection stall the queue forever.
  _addImagesChain = run.catch(() => {});
  return run;
}
async function addPendingImagesLocked(files) {
  try {
    const room = MAX_IMAGES - pendingImages.length;
    if (room <= 0) { alert(`Você só pode enviar até ${MAX_IMAGES} fotos por vez.`); return; }
    const toAdd = Array.from(files).slice(0, room);
    if (files.length > toAdd.length) alert(`Você só pode enviar até ${MAX_IMAGES} fotos por vez. Só as ${toAdd.length} primeiras foram adicionadas.`);
    for (const file of toAdd) {
      // Rechecks on every iteration: another call only enters after this one
      // finishes (queue above), but this also guards against this very
      // loop pushing past the limit if `room` was optimistic.
      if (pendingImages.length >= MAX_IMAGES) break;
      if (file.size > 15 * 1024 * 1024 || !/^image\/(?:jpeg|png|gif|webp|bmp|avif)$/i.test(file.type || "")) {
        throw new Error("Formato de imagem não permitido ou arquivo muito grande.");
      }
      const b64 = await compressImage(file);
      pendingImages.push(b64);
    }
    // #16: removia o card de arquivo aqui incondicionalmente, mesmo que
    // pendingFile continuasse setado - anexar uma imagem depois de já ter
    // anexado um arquivo (ou vice-versa) fazia o card do arquivo sumir do
    // preview visualmente, enquanto pendingFile seguia sendo enviado por
    // baixo dos panos. Essa remoção só faz sentido quando NÃO há mais
    // arquivo pendente para mostrar.
    if (!pendingFile) previewWrap.querySelector("#file-name-label")?.remove();
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
  // #17: re-tenta a disponibilidade do plugin "Gerar imagem" toda vez que o
  // menu abre, em vez de confiar só na tentativa única do load do script -
  // ver comentário em syncImageGenerationPluginAvailability (composer-input.js).
  globalThis.syncImageGenerationPluginAvailability?.();
}
function closeAttachSheet() {
  attachSheet.classList.remove("open");
  attachSheetBackdrop.classList.remove("show");
}
attachBtn.addEventListener("click", e => { e.stopPropagation(); requestPersistentStorage(); openAttachSheet(); });
document.getElementById("asheet-close").addEventListener("click", closeAttachSheet);
attachSheetBackdrop.addEventListener("click", closeAttachSheet);

function tryOpenImagePicker(input) {
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
  if (!BoreasSync.isAuthed()) { asheetSearchToggle.classList.toggle("on", webSearchCapCache); return; }
  try {
    const r = await fetch(BACKEND_URL + "/capabilities", { headers: BoreasSessionHeaders(), credentials: "include" });
    if (r.ok) webSearchCapCache = (await r.json()).capabilities?.webSearch !== false;
  } catch {}
  asheetSearchToggle.classList.toggle("on", webSearchCapCache);
}
asheetSearchToggle.addEventListener("click", async e => {
  e.stopPropagation();
  const previous = webSearchCapCache;
  webSearchCapCache = !asheetSearchToggle.classList.contains("on");
  asheetSearchToggle.classList.toggle("on", webSearchCapCache);
  if (!BoreasSync.isAuthed()) return;
  try {
    const response = await fetch(BACKEND_URL + "/capabilities", {
      method: "PUT",
        headers: BoreasSessionHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify({ webSearch: webSearchCapCache }),
    });
    if (!response.ok) throw await boreasHttpError(response);
  } catch (error) {
    webSearchCapCache = previous;
    asheetSearchToggle.classList.toggle("on", previous);
    showToast(error?.message || "Não foi possível atualizar a busca na web.");
  }
});
anyFileInput.addEventListener("change", async () => {
  const file = anyFileInput.files[0]; if (!file) return; anyFileInput.value = "";
  if (file.type.startsWith("image/")) {
    await addPendingImages([file]);
  } else {
    if (file.size > 5 * 1024 * 1024) { alert("Arquivo muito grande. Limite: 5 MB."); return; }

    const TEXT_EXTS = [
      ".txt",".md",".markdown",".js",".mjs",".cjs",".ts",".tsx",".jsx",
      ".py",".rb",".go",".java",".c",".cpp",".h",".hpp",".cs",".php",
      ".css",".scss",".sass",".less",".html",".htm",".xml",
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

const lightboxOverlay  = document.getElementById("lightbox-overlay");
const lightboxViewport = document.getElementById("lightbox-viewport");
const lightboxImg      = document.getElementById("lightbox-img");
const lightboxShareBtn = document.getElementById("lightbox-share-btn");
const lightboxDlBtn    = document.getElementById("lightbox-download-btn");

// Zoom/pan state for the lightbox. Kept intentionally simple (no library):
// scale clamped to [1, 4], pan clamped so the image can't be dragged
// entirely off-screen, wheel + pinch (via two-pointer distance) +
// double-click/double-tap-to-reset all funnel into the same applyTransform.
let lbScale = 1, lbX = 0, lbY = 0;
let lbPointers = new Map(); // pointerId -> {x,y}, for pinch-to-zoom
let lbPinchStartDist = 0, lbPinchStartScale = 1;
let lbPanStart = null; // {x,y,lbX,lbY} at drag start

function applyLightboxTransform(snap = false) {
  lightboxImg.classList.toggle("lightbox-snap", snap);
  lightboxImg.style.transform = `translate(${lbX}px, ${lbY}px) scale(${lbScale})`;
}

function clampLightboxPan() {
  if (!lightboxImg.naturalWidth || !lightboxViewport) return;
  const vpRect = lightboxViewport.getBoundingClientRect();
  const imgRect = lightboxImg.getBoundingClientRect();
  // getBoundingClientRect already reflects the current transform, so the
  // max allowed pan is just how far the (already-scaled) image overhangs
  // the viewport on each axis - this stays correct across every aspect
  // ratio without needing to know the image's native dimensions here.
  const overflowX = Math.max(0, (imgRect.width - vpRect.width) / 2);
  const overflowY = Math.max(0, (imgRect.height - vpRect.height) / 2);
  lbX = Math.min(overflowX, Math.max(-overflowX, lbX));
  lbY = Math.min(overflowY, Math.max(-overflowY, lbY));
}

function resetLightboxZoom() {
  lbScale = 1; lbX = 0; lbY = 0;
  applyLightboxTransform(true);
}

function openLightbox(src) {
  lightboxImg.src = src;
  lightboxOverlay.classList.add("show");
  resetLightboxZoom();
  if (lightboxDlBtn) lightboxDlBtn.disabled = false;
  if (lightboxShareBtn) lightboxShareBtn.disabled = false;
}
function closeLightbox() {
  lightboxOverlay.classList.remove("show");
  lightboxImg.src = "";
  resetLightboxZoom();
}
document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
lightboxOverlay.addEventListener("click", e => {
  if (e.target === lightboxOverlay) closeLightbox();
});

// Wheel = desktop zoom, centered roughly on the cursor.
lightboxViewport.addEventListener("wheel", e => {
  e.preventDefault();
  const prevScale = lbScale;
  lbScale = Math.min(4, Math.max(1, lbScale - e.deltaY * 0.0018 * lbScale));
  // Re-centers the zoom on where the cursor actually is, not just the
  // image center, so zooming in on a corner keeps that corner in view.
  const rect = lightboxViewport.getBoundingClientRect();
  const cx = e.clientX - rect.left - rect.width / 2;
  const cy = e.clientY - rect.top - rect.height / 2;
  const scaleDelta = lbScale / prevScale - 1;
  lbX -= cx * scaleDelta / prevScale;
  lbY -= cy * scaleDelta / prevScale;
  if (lbScale === 1) { lbX = 0; lbY = 0; }
  clampLightboxPan();
  applyLightboxTransform(false);
}, { passive: false });

// Double-click (desktop) / double-tap (mobile, via two quick pointerup) to
// toggle between 1x and 2x, matching common photo-viewer conventions.
let lbLastTapTime = 0;
lightboxViewport.addEventListener("pointerup", e => {
  if (lbPointers.size > 0) return; // was a pinch/pan gesture ending, not a tap
  const now = Date.now();
  if (now - lbLastTapTime < 300) {
    lbScale = lbScale > 1 ? 1 : 2;
    lbX = 0; lbY = 0;
    clampLightboxPan();
    applyLightboxTransform(true);
  }
  lbLastTapTime = now;
});

// Unified pointer handling covers both mouse-drag-to-pan and touch
// pinch-to-zoom/pan with the same code path (Pointer Events already
// normalize mouse vs touch vs pen).
lightboxViewport.addEventListener("pointerdown", e => {
  lightboxViewport.setPointerCapture(e.pointerId);
  lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (lbPointers.size === 2) {
    const [p1, p2] = [...lbPointers.values()];
    lbPinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    lbPinchStartScale = lbScale;
    lbPanStart = null;
  } else if (lbPointers.size === 1 && lbScale > 1) {
    lbPanStart = { x: e.clientX, y: e.clientY, lbX, lbY };
    lightboxViewport.classList.add("panning");
  }
});
lightboxViewport.addEventListener("pointermove", e => {
  if (!lbPointers.has(e.pointerId)) return;
  lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (lbPointers.size === 2) {
    const [p1, p2] = [...lbPointers.values()];
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (lbPinchStartDist > 0) {
      lbScale = Math.min(4, Math.max(1, lbPinchStartScale * (dist / lbPinchStartDist)));
      clampLightboxPan();
      applyLightboxTransform(false);
    }
  } else if (lbPanStart && lbScale > 1) {
    lbX = lbPanStart.lbX + (e.clientX - lbPanStart.x);
    lbY = lbPanStart.lbY + (e.clientY - lbPanStart.y);
    clampLightboxPan();
    applyLightboxTransform(false);
  }
});
function lbEndPointer(e) {
  lbPointers.delete(e.pointerId);
  lightboxViewport.classList.remove("panning");
  if (lbPointers.size < 2) lbPinchStartDist = 0;
  if (lbPointers.size === 0) lbPanStart = null;
  if (lbScale === 1) { lbX = 0; lbY = 0; applyLightboxTransform(true); }
}
lightboxViewport.addEventListener("pointerup", lbEndPointer);
lightboxViewport.addEventListener("pointercancel", lbEndPointer);
lightboxViewport.addEventListener("pointerleave", e => { if (lbPointers.has(e.pointerId)) lbEndPointer(e); });

// Share/download both fetch the actual image bytes (never the possibly
// low-res <img> src alone assumed sufficient) so a full-resolution file is
// what's shared/saved, per "never download a thumbnail/preview".
async function lightboxFetchBlob() {
  const src = lightboxImg.src;
  if (!src) return null;
  const response = await fetch(src, { credentials: "include" });
  if (!response.ok) return null;
  return response.blob();
}
function lightboxSuggestedFileName(blob) {
  const ext = (blob?.type || "image/png").split("/")[1]?.split("+")[0] || "png";
  return `boreas-${Date.now()}.${ext}`;
}
if (lightboxShareBtn) {
  lightboxShareBtn.addEventListener("click", async () => {
    lightboxShareBtn.disabled = true;
    try {
      const blob = await lightboxFetchBlob();
      if (!blob) throw new Error("no image");
      const fileName = lightboxSuggestedFileName(blob);
      const file = new File([blob], fileName, { type: blob.type || "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else if (navigator.share) {
        // Some platforms support share() without file support - falls back
        // to sharing the page/link rather than silently doing nothing.
        await navigator.share({ url: lightboxImg.src });
      } else {
        // No Web Share API at all (most desktop browsers): fall back to a
        // normal download instead of a dead button.
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    } catch (err) {
      if (err?.name !== "AbortError") console.warn("[lightbox share]", err);
    } finally {
      lightboxShareBtn.disabled = false;
    }
  });
}
if (lightboxDlBtn) {
  lightboxDlBtn.addEventListener("click", async () => {
    lightboxDlBtn.disabled = true;
    try {
      const blob = await lightboxFetchBlob();
      if (!blob) throw new Error("no image");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = lightboxSuggestedFileName(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (err) {
      console.warn("[lightbox download]", err);
    } finally {
      lightboxDlBtn.disabled = false;
    }
  });
}

document.querySelectorAll("img").forEach(img => {
  img.addEventListener("contextmenu", e => e.preventDefault());
});

document.addEventListener("contextmenu", e => {
  if (e.target.tagName === "IMG") e.preventDefault();
});
