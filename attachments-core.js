// Attachment state, file normalization, and image compression.
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
