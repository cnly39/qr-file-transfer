const $ = (id) => document.getElementById(id);

const state = {
  file: null,
  transfer: null,
  currentFrame: 0,
  playPos: 0,
  playlist: null,
  errorLevel: "M",
  sendTimer: null,
  qrCache: new Map(),
  qrInFlight: new Map(),
  qrCanvas: null,
  qrCtx: null,
  receive: null,
  stream: null,
  scanTimer: null,
  lastScan: "",
};

const PREFETCH_FRAMES = 12;
const MAX_CACHED_FRAMES = 20000;
const MAX_PREFETCH_IN_FLIGHT = 4;
const QR_QUIET_ZONE = 4;
const MAX_CHUNK_FOR_EC = { L: 1900, M: 1500, Q: 1000, H: 750 };

const senderEls = {
  tab: $("senderTab"),
  panel: $("senderPanel"),
  fileInput: $("fileInput"),
  chunkSize: $("chunkSize"),
  frameDelay: $("frameDelay"),
  ecLevel: $("ecLevel"),
  loopFrames: $("loopFrames"),
  frameFilter: $("frameFilter"),
  qrBox: $("qrBox"),
  start: $("startSend"),
  pause: $("pauseSend"),
  prev: $("prevFrame"),
  next: $("nextFrame"),
  name: $("sendFileName"),
  size: $("sendFileSize"),
  total: $("sendTotal"),
  current: $("sendCurrent"),
  eta: $("sendEta"),
  progress: $("sendProgressBar"),
};

const receiverEls = {
  tab: $("receiverTab"),
  panel: $("receiverPanel"),
  startCamera: $("startCamera"),
  stopCamera: $("stopCamera"),
  imageInput: $("imageInput"),
  video: $("video"),
  canvas: $("scanCanvas"),
  hint: $("cameraHint"),
  name: $("recvFileName"),
  size: $("recvFileSize"),
  count: $("recvCount"),
  missing: $("recvMissing"),
  status: $("recvStatus"),
  progress: $("recvProgressBar"),
  download: $("downloadFile"),
  reset: $("resetReceive"),
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function base64UrlFromBytes(bytes) {
  let binary = "";
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + block));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromBase64Url(value) {
  let padded = value.split("-").join("+").split("_").join("/");
  while (padded.length % 4) {
    padded += "=";
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function makeTransferId(file) {
  return `${Date.now().toString(36)}-${file.size.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function switchMode(mode) {
  const sender = mode === "sender";
  senderEls.tab.classList.toggle("active", sender);
  receiverEls.tab.classList.toggle("active", !sender);
  senderEls.panel.classList.toggle("active", sender);
  receiverEls.panel.classList.toggle("active", !sender);
}

async function prepareTransfer(file) {
  const maxChunk = MAX_CHUNK_FOR_EC[state.errorLevel] || 1500;
  const chunkSize = Math.max(400, Math.min(maxChunk, Number(senderEls.chunkSize.value) || 1400));
  senderEls.chunkSize.value = chunkSize;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    id: makeTransferId(file),
    bytes,
    chunkSize,
    total: Math.max(1, Math.ceil(bytes.length / chunkSize)),
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
  };
}

function totalFrames() {
  return state.transfer ? state.transfer.total : 0;
}

function getPlaylist() {
  return state.playlist && state.playlist.length ? state.playlist : null;
}

function playlistLength() {
  const list = getPlaylist();
  return list ? list.length : totalFrames();
}

function frameAtPos(pos) {
  const len = playlistLength();
  if (!len) return 0;
  const normalized = ((pos % len) + len) % len;
  const list = getPlaylist();
  return list ? list[normalized] : normalized;
}

function normalizePos(pos) {
  const len = playlistLength();
  if (!len) return 0;
  return ((pos % len) + len) % len;
}

function parseFrameFilter(input, total) {
  if (!input || !total) return null;
  const out = [];
  const seen = new Set();
  const tokens = input.split(/[\s,，、]+/).filter(Boolean);
  for (const token of tokens) {
    const m = token.match(/^(\d+)\s*(?:[-–~]\s*(\d+))?$/);
    if (!m) continue;
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    for (let i = a; i <= b; i += 1) {
      const idx = i - 1;
      if (idx >= 0 && idx < total && !seen.has(idx)) {
        seen.add(idx);
        out.push(idx);
      }
    }
  }
  return out.length ? out : null;
}

function getFramePayload(index) {
  const t = state.transfer;
  if (!t) return null;
  const start = index * t.chunkSize;
  const chunk = t.bytes.subarray(start, Math.min(start + t.chunkSize, t.bytes.length));
  return JSON.stringify({
    v: 1,
    t: "IFT",
    id: t.id,
    i: index,
    n: t.total,
    name: t.name,
    size: t.size,
    mime: t.mime,
    data: base64UrlFromBytes(chunk),
  });
}

function ensureQrCanvas() {
  if (state.qrCanvas && state.qrCanvas.parentElement === senderEls.qrBox) {
    return state.qrCanvas;
  }
  senderEls.qrBox.textContent = "";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "传输二维码");
  senderEls.qrBox.append(canvas);
  state.qrCanvas = canvas;
  state.qrCtx = canvas.getContext("2d");
  return canvas;
}

function drawModulesToCanvas(entry) {
  const canvas = ensureQrCanvas();
  const ctx = state.qrCtx;
  const { size, bits } = entry;
  const total = size + QR_QUIET_ZONE * 2;
  if (canvas.width !== total || canvas.height !== total) {
    canvas.width = total;
    canvas.height = total;
  }
  const image = ctx.createImageData(total, total);
  const buf = image.data;
  buf.fill(255);
  for (let y = 0; y < size; y += 1) {
    const row = (y + QR_QUIET_ZONE) * total;
    const bitRow = y * size;
    for (let x = 0; x < size; x += 1) {
      const bitIndex = bitRow + x;
      if ((bits[bitIndex >> 3] >> (bitIndex & 7)) & 1) {
        const pi = (row + x + QR_QUIET_ZONE) * 4;
        buf[pi] = 0;
        buf[pi + 1] = 0;
        buf[pi + 2] = 0;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

async function renderFrame(pos) {
  if (!playlistLength()) return;
  state.playPos = normalizePos(pos);
  state.currentFrame = frameAtPos(state.playPos);
  const entry = await getQrModules(state.currentFrame);

  senderEls.qrBox.classList.remove("empty");
  drawModulesToCanvas(entry);
  updateSendStatus();
  prefetchFrames(state.playPos);
}

async function getQrModules(index) {
  if (state.qrCache.has(index)) {
    return state.qrCache.get(index);
  }

  if (state.qrInFlight.has(index)) {
    return state.qrInFlight.get(index);
  }

  const promise = requestQrModules(index).finally(() => {
    state.qrInFlight.delete(index);
  });
  state.qrInFlight.set(index, promise);
  return promise;
}

async function requestQrModules(index) {
  const payload = getFramePayload(index);
  const response = await fetch("/api/qr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload, errorCorrectionLevel: state.errorLevel }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "二维码生成失败");

  const binary = atob(result.modules);
  const bits = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bits[i] = binary.charCodeAt(i);
  const entry = { size: result.size, bits };
  state.qrCache.set(index, entry);
  trimQrCache(index);
  return entry;
}

function prefetchFrames(fromPos) {
  const len = playlistLength();
  if (!len) return;
  const looping = senderEls.loopFrames.checked;
  const limit = Math.min(PREFETCH_FRAMES, len - 1);
  for (let offset = 1; offset <= limit; offset += 1) {
    const rawPos = fromPos + offset;
    if (!looping && rawPos >= len) break;
    const pos = ((rawPos % len) + len) % len;
    const frameIndex = frameAtPos(pos);
    if (state.qrCache.has(frameIndex) || state.qrInFlight.has(frameIndex)) continue;
    if (state.qrInFlight.size >= MAX_PREFETCH_IN_FLIGHT) break;
    getQrModules(frameIndex).catch(() => {});
  }
}

function trimQrCache(centerIndex) {
  if (state.qrCache.size <= MAX_CACHED_FRAMES) return;
  const total = totalFrames();
  const entries = Array.from(state.qrCache.keys()).map((index) => ({
    index,
    distance: (index - centerIndex + total) % total,
  }));
  entries.sort((a, b) => b.distance - a.distance);
  while (state.qrCache.size > MAX_CACHED_FRAMES && entries.length) {
    state.qrCache.delete(entries.shift().index);
  }
}

function clearQrCache() {
  state.qrCache.clear();
  state.qrInFlight.clear();
}

function updateSendStatus() {
  const total = totalFrames();
  const len = playlistLength();
  const list = getPlaylist();
  senderEls.name.textContent = state.file ? state.file.name : "-";
  senderEls.size.textContent = state.file ? formatBytes(state.file.size) : "-";
  senderEls.total.textContent = total ? (list ? `${total}（列表 ${len}）` : `${total}`) : "-";
  if (total && len) {
    senderEls.current.textContent = list
      ? `${state.currentFrame + 1} / ${total}（第 ${state.playPos + 1} / ${len}）`
      : `${state.currentFrame + 1} / ${total}`;
  } else {
    senderEls.current.textContent = "-";
  }
  const delay = Math.max(120, Number(senderEls.frameDelay.value) || 450);
  senderEls.eta.textContent = len ? `${Math.ceil(len * delay / 1000)} 秒 / 轮` : "-";
  senderEls.progress.style.width = len ? `${((state.playPos + 1) / len) * 100}%` : "0%";
}

async function nextFrame(step = 1) {
  const len = playlistLength();
  if (!len) return;
  const next = state.playPos + step;
  if (next >= len && !senderEls.loopFrames.checked) {
    pauseSend();
    return;
  }
  await renderFrame(next);
}

function pauseSend() {
  clearTimeout(state.sendTimer);
  state.sendTimer = null;
  senderEls.start.disabled = !playlistLength();
  senderEls.pause.disabled = true;
}

function startSend() {
  if (!playlistLength() || state.sendTimer) return;
  const delay = Math.max(120, Number(senderEls.frameDelay.value) || 450);
  senderEls.start.disabled = true;
  senderEls.pause.disabled = false;
  const tick = async () => {
    try {
      await nextFrame(1);
      if (state.sendTimer) {
        state.sendTimer = setTimeout(tick, delay);
      }
    } catch (error) {
      pauseSend();
      alert(error.message);
    }
  };
  state.sendTimer = setTimeout(tick, delay);
}

async function handleFileChange() {
  const file = senderEls.fileInput.files[0];
  if (!file) return;
  pauseSend();
  state.file = file;
  state.transfer = null;
  state.playlist = null;
  state.playPos = 0;
  clearQrCache();
  state.qrCanvas = null;
  state.qrCtx = null;
  state.currentFrame = 0;
  senderEls.qrBox.classList.add("empty");
  senderEls.qrBox.textContent = "正在读取文件...";
  updateSendStatus();

  state.transfer = await prepareTransfer(file);
  state.playlist = parseFrameFilter(senderEls.frameFilter.value, state.transfer.total);
  senderEls.start.disabled = false;
  senderEls.prev.disabled = false;
  senderEls.next.disabled = false;
  await renderFrame(0);
}

function clampChunkInput() {
  const maxChunk = MAX_CHUNK_FOR_EC[state.errorLevel] || 1500;
  const current = Number(senderEls.chunkSize.value) || 1400;
  if (current > maxChunk) senderEls.chunkSize.value = maxChunk;
}

function handleEcLevelChange() {
  state.errorLevel = senderEls.ecLevel.value || "M";
  clampChunkInput();
  clearQrCache();
  if (totalFrames()) {
    renderFrame(state.playPos).catch((error) => alert(error.message));
  }
}

function handleFrameFilterChange() {
  const total = totalFrames();
  state.playlist = parseFrameFilter(senderEls.frameFilter.value, total);
  state.playPos = 0;
  if (!total) {
    updateSendStatus();
    return;
  }
  renderFrame(0).catch((error) => alert(error.message));
}

function ensureReceive(frame) {
  if (!state.receive || state.receive.id !== frame.id) {
    state.receive = {
      id: frame.id,
      name: frame.name || "received.bin",
      size: Number(frame.size) || 0,
      mime: frame.mime || "application/octet-stream",
      total: Number(frame.n),
      chunks: new Map(),
      doneUrl: "",
    };
  }
}

function acceptFrame(text) {
  let frame;
  try {
    frame = JSON.parse(text);
  } catch {
    return false;
  }

  if (frame.t !== "IFT" || frame.v !== 1) return false;
  if (!Number.isInteger(frame.i) || !Number.isInteger(frame.n) || frame.i < 0 || frame.i >= frame.n) return false;
  if (typeof frame.data !== "string") return false;

  ensureReceive(frame);
  if (state.receive.id !== frame.id) return false;
  if (!state.receive.chunks.has(frame.i)) {
    state.receive.chunks.set(frame.i, frame.data);
  }
  updateReceiveStatus();
  return true;
}

function updateReceiveStatus() {
  const receive = state.receive;
  if (!receive) {
    receiverEls.name.textContent = "-";
    receiverEls.size.textContent = "-";
    receiverEls.count.textContent = "0 / 0";
    receiverEls.missing.textContent = "-";
    receiverEls.status.textContent = "等待扫描";
    receiverEls.progress.style.width = "0%";
    receiverEls.download.disabled = true;
    return;
  }

  const count = receive.chunks.size;
  const total = receive.total;
  const missing = [];
  for (let i = 0; i < total && missing.length < 12; i += 1) {
    if (!receive.chunks.has(i)) missing.push(i + 1);
  }

  receiverEls.name.textContent = receive.name;
  receiverEls.size.textContent = formatBytes(receive.size);
  receiverEls.count.textContent = `${count} / ${total}`;
  receiverEls.missing.textContent = count === total ? "无" : `${missing.join(", ")}${missing.length >= 12 ? " ..." : ""}`;
  receiverEls.progress.style.width = `${(count / total) * 100}%`;
  receiverEls.status.textContent = count === total ? "已接收完成" : "正在接收";
  receiverEls.download.disabled = count !== total;
}

function downloadReceived() {
  const receive = state.receive;
  if (!receive || receive.chunks.size !== receive.total) return;

  const parts = [];
  for (let i = 0; i < receive.total; i += 1) {
    parts.push(bytesFromBase64Url(receive.chunks.get(i)));
  }

  const blob = new Blob(parts, { type: receive.mime });
  if (receive.doneUrl) URL.revokeObjectURL(receive.doneUrl);
  receive.doneUrl = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = receive.doneUrl;
  link.download = receive.name;
  document.body.append(link);
  link.click();
  link.remove();
}

function resetReceive() {
  if (state.receive && state.receive.doneUrl) URL.revokeObjectURL(state.receive.doneUrl);
  state.receive = null;
  state.lastScan = "";
  updateReceiveStatus();
}

function getCameraStream(constraints) {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  const legacyGetUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  if (legacyGetUserMedia) {
    return new Promise((resolve, reject) => {
      legacyGetUserMedia.call(navigator, constraints, resolve, reject);
    });
  }

  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const reason = location.protocol !== "https:" && !isLocalhost
    ? "手机浏览器通常不允许 HTTP 局域网页面打开摄像头。请改用 HTTPS，或在接收设备本机运行后用 127.0.0.1 打开。"
    : "这个浏览器没有提供摄像头 API，请换 Chrome、Edge 或 Safari 新版本。";
  return Promise.reject(new Error(reason));
}

async function startCamera() {
  state.stream = await getCameraStream({
    video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  receiverEls.video.srcObject = state.stream;
  await receiverEls.video.play();
  receiverEls.hint.style.display = "none";
  receiverEls.startCamera.disabled = true;
  receiverEls.stopCamera.disabled = false;
  scanLoop();
}

function stopCamera() {
  clearTimeout(state.scanTimer);
  state.scanTimer = null;
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  state.stream = null;
  receiverEls.video.srcObject = null;
  receiverEls.hint.style.display = "";
  receiverEls.startCamera.disabled = false;
  receiverEls.stopCamera.disabled = true;
}

function scanLoop() {
  const video = receiverEls.video;
  if (!state.stream || video.readyState < 2) {
    state.scanTimer = setTimeout(scanLoop, 80);
    return;
  }

  const canvas = receiverEls.canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });

  if (code && code.data && code.data !== state.lastScan) {
    state.lastScan = code.data;
    acceptFrame(code.data);
  }

  state.scanTimer = setTimeout(scanLoop, 60);
}

function loadImageFile(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file);
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    image.src = url;
  });
}

async function scanImageFile(file) {
  const bitmap = await loadImageFile(file);
  const canvas = receiverEls.canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = bitmap.width || bitmap.naturalWidth;
  canvas.height = bitmap.height || bitmap.naturalHeight;
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
  if (bitmap.close) bitmap.close();
  if (code && code.data) {
    acceptFrame(code.data);
  }
}

senderEls.tab.addEventListener("click", () => switchMode("sender"));
receiverEls.tab.addEventListener("click", () => switchMode("receiver"));
senderEls.fileInput.addEventListener("change", () => handleFileChange().catch((error) => alert(error.message)));
senderEls.start.addEventListener("click", startSend);
senderEls.pause.addEventListener("click", pauseSend);
senderEls.prev.addEventListener("click", () => nextFrame(-1).catch((error) => alert(error.message)));
senderEls.next.addEventListener("click", () => nextFrame(1).catch((error) => alert(error.message)));
senderEls.frameDelay.addEventListener("change", updateSendStatus);
senderEls.ecLevel.addEventListener("change", handleEcLevelChange);
senderEls.frameFilter.addEventListener("change", handleFrameFilterChange);
state.errorLevel = senderEls.ecLevel.value || "M";
receiverEls.startCamera.addEventListener("click", () => startCamera().catch((error) => alert(error.message)));
receiverEls.stopCamera.addEventListener("click", stopCamera);
receiverEls.download.addEventListener("click", downloadReceived);
receiverEls.reset.addEventListener("click", resetReceive);
receiverEls.imageInput.addEventListener("change", async () => {
  for (const file of receiverEls.imageInput.files) {
    await scanImageFile(file);
  }
});
