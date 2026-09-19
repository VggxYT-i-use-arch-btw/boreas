// Attachment controls, previews, and image lightbox.
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
