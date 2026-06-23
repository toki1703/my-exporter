// =============================================================
// Options page — settings + bulk export
// =============================================================

const STORAGE_KEYS = ["exportFormat", "exportDest", "obsidianApiKey", "obsidianVaultPath", "obsidianBaseUrl"];

let selectedFormat = "markdown";
let selectedDest = "download";

// --- Startup: load stored settings ---

chrome.storage.local.get(STORAGE_KEYS, (s) => {
  if (s.exportFormat) {
    selectedFormat = s.exportFormat;
    syncSegmented("format-toggle", "format", selectedFormat);
  }
  if (s.exportDest) {
    selectedDest = s.exportDest;
    syncSegmented("dest-toggle", "dest", selectedDest);
    document.getElementById("obsidian-settings").classList.toggle("hidden", selectedDest !== "obsidian");
  }
  if (s.obsidianApiKey)  document.getElementById("inp-api-key").value  = s.obsidianApiKey;
  if (s.obsidianBaseUrl) document.getElementById("inp-base-url").value = s.obsidianBaseUrl;
  if (selectedDest === "obsidian") {
    loadVaultFolders();
  }
});

function syncSegmented(groupId, dataKey, value) {
  document.querySelectorAll(`#${groupId} .seg`).forEach((b) => {
    b.classList.toggle("active", b.dataset[dataKey] === value);
  });
}

// --- UI helpers ---

function showMessage(text, type = "info") {
  const el = document.getElementById("message");
  el.textContent = text;
  el.className = `message ${type}`;
}

function hideMessage() {
  document.getElementById("message").className = "message hidden";
}

// --- Job management ---

const JOB_META = {
  chatgpt:    { name: "ChatGPT",    icon: `<img src="../images/OpenAI-black-monoblossom.svg" alt="ChatGPT">` },
  claude:     { name: "Claude",     icon: `<img src="../images/Claude_AI_symbol.svg" alt="Claude">` },
  perplexity: { name: "Perplexity", icon: `<img src="../images/perplexity.svg" alt="Perplexity">` },
  gemini:     { name: "Gemini",     icon: `<img src="../images/Google_Gemini_icon_2025.svg" alt="Gemini">` },
};

const _jobs = new Map();

function _escHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function createJobCard(jobId, service) {
  const meta = JOB_META[service] || { name: service, icon: "📤" };
  const div = document.createElement("div");
  div.className = "job-card";
  div.innerHTML =
    `<div class="job-card__header">` +
      `<span class="job-card__icon">${meta.icon}</span>` +
      `<div class="job-card__text">` +
        `<span class="job-card__name">${meta.name}</span>` +
        `<span class="job-card__label" id="jlbl-${jobId}">リスト取得中...</span>` +
      `</div>` +
      `<span class="job-card__count" id="jcnt-${jobId}"></span>` +
    `</div>` +
    `<div class="job-card__bar">` +
      `<div class="progress-track"><div class="progress-fill" id="jfil-${jobId}" style="width:5%"></div></div>` +
    `</div>` +
    `<details class="chat-list-details hidden" id="jdet-${jobId}">` +
      `<summary class="chat-list-summary">` +
        `<span class="chat-list-summary__arrow">▶</span>` +
        `<span class="chat-list-summary__label">チャット一覧</span>` +
        `<span class="chat-list-summary__count" id="jclc-${jobId}"></span>` +
      `</summary>` +
      `<ul class="chat-list" id="jcl-${jobId}"></ul>` +
    `</details>`;
  document.getElementById("jobs-list").appendChild(div);
  document.getElementById("jobs-section").classList.remove("hidden");
  _jobs.set(jobId, { clItems: [] });
}

function updateJobProgress(jobId, { phase, done = 0, total = 0, currentTitle = "", newTitles, currentIndex, prevIndex, prevOk }) {
  if (!_jobs.has(jobId)) return;
  const lbl = document.getElementById(`jlbl-${jobId}`);
  const cnt = document.getElementById(`jcnt-${jobId}`);
  const fil = document.getElementById(`jfil-${jobId}`);

  cnt.textContent = (phase !== "listing" && total > 0) ? `${done} / ${total}` : "";

  if (phase === "listing") {
    lbl.textContent = "リスト取得中...";
    fil.style.width = total > 0 ? `${(done / total) * 20}%` : "5%";
    if (newTitles?.length) _jobAddItems(jobId, newTitles);
  } else if (phase === "exporting") {
    const short = currentTitle ? `「${currentTitle.slice(0, 24)}」` : "";
    lbl.textContent = short ? `${short} をエクスポート中` : "エクスポート中...";
    fil.style.width = total > 0 ? `${20 + (done / total) * 80}%` : "20%";
    if (typeof prevIndex === "number" && prevIndex >= 0) _jobSetStatus(jobId, prevIndex, prevOk === false ? "error" : "ok");
    if (typeof currentIndex === "number" && currentIndex >= 0) _jobSetStatus(jobId, currentIndex, "active");
    _jobUpdateCount(jobId);
  } else if (phase === "done") {
    lbl.textContent = "完了";
    fil.style.width = "100%";
    if (typeof prevIndex === "number" && prevIndex >= 0) _jobSetStatus(jobId, prevIndex, prevOk === false ? "error" : "ok");
    _jobUpdateCount(jobId);
  }
}

function _jobAddItems(jobId, titles) {
  const job = _jobs.get(jobId);
  if (!job) return;
  const ul = document.getElementById(`jcl-${jobId}`);
  for (const title of titles) {
    const li = document.createElement("li");
    li.className = "chat-list__item";
    li.innerHTML =
      `<span class="chat-item-status chat-item-status--pending">–</span>` +
      `<span class="chat-item-title" title="${_escHtml(title)}">${_escHtml(title)}</span>`;
    ul.appendChild(li);
    job.clItems.push({ el: li });
  }
  if (job.clItems.length > 0) {
    document.getElementById(`jdet-${jobId}`)?.classList.remove("hidden");
    _jobUpdateCount(jobId);
  }
}

function _jobSetStatus(jobId, idx, status) {
  const item = _jobs.get(jobId)?.clItems[idx];
  if (!item) return;
  const statusEl = item.el.querySelector(".chat-item-status");
  statusEl.className = `chat-item-status chat-item-status--${status}`;
  statusEl.textContent = { pending: "–", active: "⟳", ok: "✓", error: "✗" }[status] ?? "–";
  item.el.classList.toggle("chat-list__item--active", status === "active");
  if (status === "active" && document.getElementById(`jdet-${jobId}`)?.open) {
    item.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function _jobUpdateCount(jobId) {
  const job = _jobs.get(jobId);
  if (!job) return;
  const total = job.clItems.length;
  const done  = job.clItems.filter((i) => i.el.querySelector(".chat-item-status--ok, .chat-item-status--error")).length;
  const el = document.getElementById(`jclc-${jobId}`);
  if (el) el.textContent = total > 0 ? (done > 0 ? `${done} / ${total} 件` : `${total} 件`) : "";
}

// --- Format toggle ---

document.getElementById("format-toggle").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg");
  if (!btn) return;
  selectedFormat = btn.dataset.format;
  syncSegmented("format-toggle", "format", selectedFormat);
  chrome.storage.local.set({ exportFormat: selectedFormat });
});

// --- Destination toggle ---

document.getElementById("dest-toggle").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg");
  if (!btn) return;
  selectedDest = btn.dataset.dest;
  syncSegmented("dest-toggle", "dest", selectedDest);
  document.getElementById("obsidian-settings").classList.toggle("hidden", selectedDest !== "obsidian");
  chrome.storage.local.set({ exportDest: selectedDest });
  if (selectedDest === "obsidian") {
    loadVaultFolders();
  }
});

// --- Obsidian settings: save on change ---

document.getElementById("inp-api-key").addEventListener("change", (e) => {
  chrome.storage.local.set({ obsidianApiKey: e.target.value.trim() });
});
document.getElementById("inp-vault-path").addEventListener("change", (e) => {
  chrome.storage.local.set({ obsidianVaultPath: e.target.value });
});
document.getElementById("inp-base-url").addEventListener("change", (e) => {
  chrome.storage.local.set({ obsidianBaseUrl: e.target.value.trim() });
});
document.getElementById("btn-refresh-folders").addEventListener("click", () => {
  loadVaultFolders();
});

// --- Vault folder list loader ---

async function loadVaultFolders() {
  const select = document.getElementById("inp-vault-path");
  const btn = document.getElementById("btn-refresh-folders");

  btn.disabled = true;
  btn.textContent = "…";

  select.innerHTML = "";
  const loadingOpt = document.createElement("option");
  loadingOpt.textContent = "取得中...";
  loadingOpt.disabled = true;
  select.appendChild(loadingOpt);

  try {
    const s = await chrome.storage.local.get(["obsidianApiKey", "obsidianBaseUrl", "obsidianVaultPath"]);
    const baseUrl = (s.obsidianBaseUrl || "http://127.0.0.1:27123").replace(/\/$/, "");
    const headers = s.obsidianApiKey ? { Authorization: `Bearer ${s.obsidianApiKey}` } : {};

    const folders = await fetchFoldersRecursive(baseUrl, headers);
    const current = s.obsidianVaultPath || "";

    select.innerHTML = "";
    const rootOpt = document.createElement("option");
    rootOpt.value = "";
    rootOpt.textContent = "（Vault ルート）";
    select.appendChild(rootOpt);

    for (const folderPath of folders) {
      const depth = folderPath.split("/").length - 1;
      const label = "  ".repeat(depth) + folderPath.split("/").pop();
      const opt = document.createElement("option");
      opt.value = folderPath;
      opt.textContent = label;
      select.appendChild(opt);
    }

    if (current && !folders.includes(current)) {
      const opt = document.createElement("option");
      opt.value = current;
      opt.textContent = current;
      select.appendChild(opt);
    }

    select.value = current;
  } catch (err) {
    select.innerHTML = "";
    const errOpt = document.createElement("option");
    errOpt.value = "";
    errOpt.textContent = `取得失敗 (${err.message})`;
    select.appendChild(errOpt);
  } finally {
    btn.disabled = false;
    btn.textContent = "↻";
  }
}

async function fetchFoldersRecursive(baseUrl, headers, folderPath = "", depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];

  const segments = folderPath ? folderPath.split("/").map(encodeURIComponent) : [];
  const url = `${baseUrl}/vault/${segments.join("/")}${segments.length ? "/" : ""}`;

  const resp = await fetch(url, { headers });
  if (!resp.ok) return [];

  const json = await resp.json();
  const subFolderNames = (json.files || [])
    .filter((f) => f.endsWith("/"))
    .map((f) => f.slice(0, -1));

  const results = await Promise.all(
    subFolderNames.map(async (name) => {
      const childPath = folderPath ? `${folderPath}/${name}` : name;
      const children = await fetchFoldersRecursive(baseUrl, headers, childPath, depth + 1, maxDepth);
      return [childPath, ...children];
    })
  );

  return results.flat();
}

// --- Bulk export: progress relay from injected scripts ---

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "EXPORT_ALL_PROGRESS") return;
  updateJobProgress(msg.jobId, msg);
});

// Find an open tab matching one of the given hosts.
async function findServiceTab(hosts) {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => {
    if (!t.url) return false;
    let host;
    try { host = new URL(t.url).hostname; } catch { return false; }
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  });
}

async function _runExport({ hosts, openHint, func, service }) {
  let jobId = null;
  try {
    const tab = await findServiceTab(hosts);
    if (!tab) throw new Error(`${openHint} のタブを開いてから実行してください`);
    jobId = `${service}-${Date.now()}`;
    createJobCard(jobId, service);
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func,
      args: [selectedFormat, selectedDest, jobId],
    });
    const result = results?.[0]?.result;
    if (result?.error) throw new Error(result.error);
    return result;
  } catch (err) {
    if (jobId) {
      const lbl = document.getElementById(`jlbl-${jobId}`);
      if (lbl) lbl.textContent = `エラー: ${err.message}`;
    }
    return { error: err.message };
  }
}

async function runBulkExport({ btn, hosts, openHint, func, service }) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "実行中…";
  hideMessage();

  const result = await _runExport({ hosts, openHint, func, service });

  if (!result?.error) {
    const errNote = (result?.errors ?? 0) > 0 ? `（エラー: ${result.errors} 件）` : "";
    const destNote = selectedDest === "obsidian" ? "Obsidian" : "Downloads/my-exporter/";
    showMessage(`${result?.done} 件エクスポート完了！${errNote} → ${destNote}`, "success");
  } else {
    showMessage(result.error, "error");
  }

  btn.disabled = false;
  btn.textContent = "実行";
}

document.getElementById("btn-chatgpt-all").addEventListener("click", (e) => {
  runBulkExport({
    btn: e.currentTarget,
    hosts: ["chatgpt.com", "chat.openai.com"],
    openHint: "ChatGPT",
    func: doExportAll,
    service: "chatgpt",
  });
});

document.getElementById("btn-claude-all").addEventListener("click", (e) => {
  runBulkExport({
    btn: e.currentTarget,
    hosts: ["claude.ai"],
    openHint: "Claude",
    func: doExportAllClaude,
    service: "claude",
  });
});

document.getElementById("btn-perplexity-all").addEventListener("click", (e) => {
  runBulkExport({
    btn: e.currentTarget,
    hosts: ["www.perplexity.ai", "perplexity.ai"],
    openHint: "Perplexity",
    func: doExportAllPerplexity,
    service: "perplexity",
  });
});

document.getElementById("btn-gemini-all").addEventListener("click", (e) => {
  runBulkExport({
    btn: e.currentTarget,
    hosts: ["gemini.google.com"],
    openHint: "Gemini",
    func: doExportAllGemini,
    service: "gemini",
  });
});

document.getElementById("btn-all").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;

  const individualIds = ["btn-chatgpt-all", "btn-claude-all", "btn-perplexity-all", "btn-gemini-all"];
  btn.disabled = true;
  btn.textContent = "実行中…";
  individualIds.forEach((id) => { document.getElementById(id).disabled = true; });
  hideMessage();

  await Promise.all([
    _runExport({ hosts: ["chatgpt.com", "chat.openai.com"],          openHint: "ChatGPT",    func: doExportAll,            service: "chatgpt" }),
    _runExport({ hosts: ["claude.ai"],                               openHint: "Claude",      func: doExportAllClaude,      service: "claude" }),
    _runExport({ hosts: ["www.perplexity.ai", "perplexity.ai"],      openHint: "Perplexity", func: doExportAllPerplexity,  service: "perplexity" }),
    _runExport({ hosts: ["gemini.google.com"],                       openHint: "Gemini",      func: doExportAllGemini,      service: "gemini" }),
  ]);

  btn.disabled = false;
  btn.textContent = "全プロバイダーを一括エクスポート";
  individualIds.forEach((id) => { document.getElementById(id).disabled = false; });
});

// =============================================================
// Self-contained functions injected into the page via executeScript
// (No closure access — all external values must come via args)
// =============================================================

async function doExportAll(format, dest, jobId) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const sendProgress = (data) => {
    try { chrome.runtime.sendMessage({ type: "EXPORT_ALL_PROGRESS", jobId, ...data }); } catch (_) {}
  };

  // Auth token
  const sessionResp = await fetch("/api/auth/session", { credentials: "include" });
  const session = sessionResp.ok ? await sessionResp.json() : {};
  const token = session?.accessToken;
  const headers = {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  function inferMimeType(value, fallback) {
    if (fallback && /^data:([^;,]+)[;,]/i.test(fallback)) {
      return fallback.match(/^data:([^;,]+)[;,]/i)?.[1] || fallback;
    }
    if (typeof value === "string" && /^data:([^;,]+)[;,]/i.test(value)) {
      return value.match(/^data:([^;,]+)[;,]/i)?.[1] || "application/octet-stream";
    }
    return fallback || "application/octet-stream";
  }

  async function fetchAttachmentData(url, mimeType) {
    if (!url) return null;
    if (url.startsWith("data:")) return url;

    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) return null;
      const blob = await response.blob();
      const type = blob.type || mimeType || "application/octet-stream";
      const buffer = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return `data:${type};base64,${btoa(binary)}`;
    } catch (_) {
      return null;
    }
  }

  function extractFileIdFromAssetPointer(assetPointer) {
    if (!assetPointer || typeof assetPointer !== "string") return null;
    const match = assetPointer.match(/(?:^|:)file_([a-zA-Z0-9]+)/);
    if (match) return `file_${match[1]}`;
    if (assetPointer.startsWith("sediment://file_")) {
      return assetPointer.replace(/^sediment:\/\//, "");
    }
    return assetPointer;
  }

  function buildFileIdCandidates(part, message) {
    const candidates = new Set();
    const messageAttachments = Array.isArray(message?.metadata?.attachments)
      ? message.metadata.attachments
      : [];

    for (const att of messageAttachments) {
      if (att?.id) candidates.add(att.id);
    }
    if (part?.asset_pointer) candidates.add(extractFileIdFromAssetPointer(part.asset_pointer));
    if (part?.assetPointer) candidates.add(extractFileIdFromAssetPointer(part.assetPointer));
    if (part?.file_id) candidates.add(part.file_id);
    if (part?.id) candidates.add(part.id);
    if (part?.name) candidates.add(part.name);
    return [...candidates].filter(Boolean);
  }

  async function fetchDownloadUrlForFileId(fileId) {
    if (!fileId) return null;

    const downloadEndpoints = [
      `/backend-api/files/download/${encodeURIComponent(fileId)}?post_id=&inline=false&download_intent=false`,
      `/backend-api/files/download/${encodeURIComponent(fileId)}?inline=false&download_intent=false`,
    ];

    for (const endpoint of downloadEndpoints) {
      try {
        const response = await fetch(endpoint, {
          credentials: "include",
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!response.ok) continue;
        const payload = await response.json().catch(() => null);
        const downloadUrl =
          payload?.download_url ||
          payload?.url ||
          payload?.data?.download_url ||
          payload?.data?.url;
        if (downloadUrl) return downloadUrl;
      } catch (_) {}
    }
    return null;
  }

  async function fetchFileIdAsDataUrl(fileId, mimeType) {
    if (!fileId) return null;
    const directDownloadUrl = await fetchDownloadUrlForFileId(fileId);
    if (directDownloadUrl) {
      const dataUrl = await fetchAttachmentData(
        directDownloadUrl.startsWith("/")
          ? `${window.location.origin}${directDownloadUrl}`
          : directDownloadUrl,
        mimeType
      );
      if (dataUrl) return dataUrl;
    }
    return null;
  }

  async function extractAttachment(part, message) {
    if (!part || typeof part !== "object") return null;

    const messageAttachments = Array.isArray(message?.metadata?.attachments)
      ? message.metadata.attachments
      : [];
    const attachmentMeta =
      messageAttachments.find((a) => a?.id === extractFileIdFromAssetPointer(part?.asset_pointer)) ||
      messageAttachments.find((a) => a?.id === part?.asset_pointer) ||
      messageAttachments.find((a) => a?.name === part?.filename);

    const imageFile = part.image_file || part.file_data || part.image || part.file;
    const fileIdCandidates = buildFileIdCandidates(part, message);
    const rawData =
      imageFile?.file_data ||
      imageFile?.data ||
      imageFile?.url ||
      imageFile?.image_url ||
      part?.file_data ||
      part?.image_url ||
      part?.url ||
      part?.file_url;

    const assetPointer = part?.asset_pointer || part?.assetPointer;
    const fileId = extractFileIdFromAssetPointer(assetPointer) || fileIdCandidates[0] || null;

    if (!rawData && !assetPointer && !part?.image_url && !part?.url && !part?.file_url && !fileId) {
      return null;
    }

    const mimeType =
      imageFile?.mime_type ||
      attachmentMeta?.mime_type ||
      part?.mime_type ||
      (typeof rawData === "string" ? inferMimeType(rawData) : null) ||
      (assetPointer ? "application/octet-stream" : null);

    const attachment = {
      type: part?.type || part?.content_type || (mimeType?.startsWith("image/") ? "image" : "file"),
      mimeType,
      filename:
        imageFile?.filename ||
        attachmentMeta?.name ||
        part?.filename ||
        part?.name ||
        (fileId || assetPointer || "attachment"),
      assetPointer: assetPointer || null,
      sizeBytes: imageFile?.size_bytes || attachmentMeta?.size || part?.size_bytes || null,
    };

    if (typeof rawData === "string") {
      if (rawData.startsWith("data:")) {
        attachment.dataUrl = rawData;
      } else if (/^(https?:|\/)/i.test(rawData)) {
        attachment.url = rawData;
        attachment.dataUrl = await fetchAttachmentData(rawData, mimeType);
      } else if (rawData) {
        attachment.dataUrl = `data:${mimeType};base64,${rawData}`;
      }
    } else if (part?.image_url || part?.url || part?.file_url) {
      const directUrl = part.image_url || part.url || part.file_url;
      attachment.url = directUrl;
      attachment.dataUrl = await fetchAttachmentData(directUrl, mimeType);
    }

    if (!attachment.dataUrl && fileIdCandidates.length > 0) {
      for (const candidate of fileIdCandidates) {
        const maybe = await fetchFileIdAsDataUrl(candidate, mimeType);
        if (maybe) {
          attachment.dataUrl = maybe;
          break;
        }
      }
    }



    if (part?.thumbnail_url) attachment.thumbnailUrl = part.thumbnail_url;
    return attachment;
  }

  async function extractTextAndAttachments(parts, message) {
    const texts = [];
    const attachments = [];

    for (const part of parts ?? []) {
      if (typeof part === "string") {
        if (part.trim()) texts.push(part.trim());
        continue;
      }
      if (part && typeof part === "object") {
        if (typeof part.text === "string" && part.text.trim()) {
          texts.push(part.text.trim());
        } else if (typeof part.content === "string" && part.content.trim()) {
          texts.push(part.content.trim());
        }
        const attachment = await extractAttachment(part, message);
        if (attachment) attachments.push(attachment);
      }
    }

    return {
      text: texts.join("\n").trim(),
      attachments,
    };
  }

  // Paginate conversation list
  const items = [];
  let offset = 0;
  while (true) {
    const r = await fetch(
      `/backend-api/conversations?offset=${offset}&limit=100&order=updated`,
      { credentials: "include", headers }
    );
    if (!r.ok) return { error: `会話リスト取得エラー: ${r.status}` };
    const page = await r.json();
    items.push(...page.items);
    // page.total is unreliable (can under-report), so rely on the page size:
    // a short page means we've reached the end.
    sendProgress({ phase: "listing", done: items.length, total: page.total, newTitles: page.items.map((i) => i.title || "Untitled") });
    if (page.items.length < 100) break;
    offset += 100;
    await sleep(300);
  }

  const total = items.length;
  // folder is used for file downloads only (Obsidian handles its own path)
  const folder = `chatgpt_${new Date().toISOString().slice(0, 10)}`;
  let done = 0;
  let errors = 0;

  let prevIdx = -1;
  let prevOk = null;
  for (const [i, item] of items.entries()) {
    sendProgress({ phase: "exporting", done, total, currentTitle: item.title, currentIndex: i, prevIndex: prevIdx, prevOk });
    prevIdx = i;

    try {
      const r = await fetch(`/backend-api/conversation/${item.id}`, {
        credentials: "include",
        headers,
      });
      if (!r.ok) throw new Error(r.status);
      const json = await r.json();

      const mapping = json.mapping ?? {};
      const rootId = Object.keys(mapping).find((id) => mapping[id].parent === null);
      const messages = [];
      let cur = rootId;
      while (cur) {
        const node = mapping[cur];
        const msg = node?.message;
        if (msg && msg.author?.role !== "system") {
          const parts = msg.content?.parts ?? [];
          const { text, attachments } = await extractTextAndAttachments(parts, msg);
          if (text || attachments.length > 0) {
            const timestamp = msg.create_time
              ? new Date(msg.create_time * 1000).toISOString()
              : undefined;
            const entry = {
              role: msg.author.role === "user" ? "user" : "assistant",
              content: text || (attachments.length > 0 ? `[画像ファイル ${attachments.length} 件]` : ""),
              timestamp,
            };
            if (attachments.length > 0) {
              entry.attachments = attachments;
            }
            messages.push(entry);
          }
        }
        const ch = node?.children ?? [];
        cur = ch.length ? ch[ch.length - 1] : null;
      }

      const result = await chrome.runtime.sendMessage({
        type: "EXPORT",
        service: "chatgpt",
        format,
        dest,
        folder,
        data: {
          service: "chatgpt",
          title: json.title || item.title || "Untitled",
          exportedAt: new Date().toISOString(),
          chatTime: json.create_time ? new Date(json.create_time * 1000).toISOString() : undefined,
          url: `https://chatgpt.com/c/${item.id}`,
          messages,
        },
      });

      if (result?.ok) { done++; prevOk = true; }
      else { errors++; prevOk = false; }
    } catch (_) {
      errors++;
      prevOk = false;
    }

    await sleep(300);
  }

  sendProgress({ phase: "done", done, errors, total, prevIndex: prevIdx, prevOk });
  return { done, errors, total };
}

async function doExportAllClaude(format, dest, jobId) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const sendProgress = (data) => {
    try { chrome.runtime.sendMessage({ type: "EXPORT_ALL_PROGRESS", jobId, ...data }); } catch (_) {}
  };

  const orgMatch = document.cookie.match(/lastActiveOrg=([0-9a-f-]+)/i);
  if (!orgMatch) return { error: "組織IDが取得できません。Claude にログインしていることを確認してください。" };
  const orgId = orgMatch[1];

  const conversations = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const r = await fetch(
      `/api/organizations/${orgId}/chat_conversations_v2?limit=${limit}&offset=${offset}&consistency=eventual`,
      { headers: { "content-type": "application/json" } }
    );
    if (!r.ok) return { error: `会話リスト取得エラー: ${r.status}` };
    const data = await r.json();
    const page = data.data ?? [];
    conversations.push(...page);
    sendProgress({ phase: "listing", done: conversations.length, total: conversations.length, newTitles: page.map((c) => c.name || "Claude Export") });
    if (!data.has_more) break;
    offset += limit;
    await sleep(300);
  }

  const total = conversations.length;
  const folder = `claude_${new Date().toISOString().slice(0, 10)}`;
  let done = 0;
  let errors = 0;

  function extractText(contentBlocks) {
    if (!Array.isArray(contentBlocks)) return "";
    return contentBlocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }

  let prevIdx = -1;
  let prevOk = null;
  for (const [i, conv] of conversations.entries()) {
    const convId = conv.uuid;
    const convTitle = conv.name || "Claude Export";
    sendProgress({ phase: "exporting", done, total, currentTitle: convTitle, currentIndex: i, prevIndex: prevIdx, prevOk });
    prevIdx = i;

    try {
      const r = await fetch(
        `/api/organizations/${orgId}/chat_conversations/${convId}?tree=True&rendering_mode=messages&render_all_tools=true&consistency=strong`,
        { headers: { "content-type": "application/json" } }
      );
      if (!r.ok) throw new Error(`${r.status}`);
      const json = await r.json();

      const messages = [];
      for (const msg of json.chat_messages ?? []) {
        const role = msg.sender === "human" ? "user" : "assistant";
        const content = extractText(msg.content);
        if (content) messages.push({ role, content });
      }

      const result = await chrome.runtime.sendMessage({
        type: "EXPORT",
        service: "claude",
        format,
        dest,
        folder,
        data: {
          service: "claude",
          title: convTitle,
          exportedAt: new Date().toISOString(),
          chatTime: conv.created_at,
          url: `https://claude.ai/chat/${convId}`,
          messages,
        },
      });

      if (result?.ok) { done++; prevOk = true; }
      else { errors++; prevOk = false; }
    } catch (_) {
      errors++;
      prevOk = false;
    }

    await sleep(300);
  }

  sendProgress({ phase: "done", done, errors, total, prevIndex: prevIdx, prevOk });
  return { done, errors, total };
}

// Injected into a Perplexity tab. No closure — all logic is self-contained.
async function doExportAllPerplexity(format, dest, jobId) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const sendProgress = (data) => {
    try { chrome.runtime.sendMessage({ type: "EXPORT_ALL_PROGRESS", jobId, ...data }); } catch (_) {}
  };

  const BLOCK_TYPES = [
    "answer_modes", "media_items", "knowledge_cards", "inline_entity_cards",
    "place_widgets", "finance_widgets", "sports_widgets", "flight_status_widgets",
    "shopping_widgets", "jobs_widgets", "search_result_widgets",
    "clarification_responses", "inline_images", "inline_assets",
    "placeholder_cards", "diff_blocks", "inline_knowledge_cards",
    "entity_group_v2", "refinement_filters", "canvas_mode", "maps_preview",
    "answer_tabs", "price_comparison_widgets",
  ];

  const THREAD_HEADERS = {
    Accept: "*/*",
    "Content-Type": "application/json",
    "x-app-apiclient": "default",
    "x-app-apiversion": "2.18",
  };

  // ── List all threads (via service worker to carry SameSite cookies) ────────
  // Endpoint: POST /rest/thread/list_ask_threads?version=2.18&source=default
  // Response: array of thread objects directly (no wrapper).
  //   Each item has: uuid, slug, title, last_query_datetime, total_threads, ...
  //   total_threads is the grand total embedded in every item.
  const threads = [];
  let offset = 0;
  const limit = 50;
  let totalThreads = 0;

  while (true) {
    const listResp = await chrome.runtime.sendMessage({
      type: "PERPLEXITY_LIST_FETCH",
      offset,
      limit,
    });

    if (!listResp?.ok) {
      return { error: listResp?.error || "スレッドリストの取得に失敗しました。" };
    }

    const raw = listResp.data;
    // The API returns a plain array
    const page = Array.isArray(raw) ? raw : (raw?.threads ?? []);
    if (page.length === 0) break;

    threads.push(...page);

    // total_threads is embedded in each item
    if (totalThreads === 0 && page[0]?.total_threads) {
      totalThreads = page[0].total_threads;
    }
    sendProgress({ phase: "listing", done: threads.length, total: totalThreads, newTitles: page.map((t) => t.title || t.query_str || "Perplexity Export") });

    if (threads.length >= (totalThreads || Infinity) || page.length < limit) break;
    offset += limit;
    await sleep(300);
  }

  if (threads.length === 0) {
    return { error: "スレッドが見つかりませんでした。Perplexity にログインしていることを確認してください。" };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function replaceCitations(text, webResults) {
    return text.replace(/\[(\d+)\]/g, (match, num) => {
      const r = webResults[parseInt(num, 10) - 1];
      if (!r?.url) return match;
      let domain = r.meta_data?.citation_domain_name || r.meta_data?.domain_name;
      if (!domain) {
        try { domain = new URL(r.url).hostname.replace(/^www\./, "").split(".")[0]; } catch (_) {}
      }
      return domain ? `[[${parseInt(num, 10) - 1}]](${r.url})` : match;
    });
  }

  function extractAssistantContent(blocks) {
    const webResults = [];
    for (const block of blocks) {
      if (block.intended_usage === "web_results") {
        webResults.push(...(block.web_result_block?.web_results ?? []));
      }
    }
    const parts = [];
    for (const block of blocks) {
      if (block.intended_usage === "media_items") {
        for (const item of block.media_block?.media_items ?? []) {
          if (item.medium === "image" && item.image) parts.push(`![image](${item.image})`);
        }
      } else if (block.intended_usage === "ask_text") {
        const answer = block.markdown_block?.answer;
        if (answer?.trim()) parts.push(replaceCitations(answer.trim(), webResults));
        for (const item of block.markdown_block?.media_items ?? []) {
          if (item.medium === "image" && item.image) parts.push(`![image](${item.image})`);
        }
      }
    }
    return parts.join("\n\n");
  }

  // ── Export each thread ─────────────────────────────────────────────────────

  const total = threads.length;
  const folder = `perplexity_${new Date().toISOString().slice(0, 10)}`;
  let done = 0;
  let errors = 0;

  let prevIdx = -1;
  let prevOk = null;
  for (const [i, thread] of threads.entries()) {
    // uuid == slug in the list response
    const threadId = thread.uuid || thread.slug;
    const threadTitle = thread.title || thread.query_str || "Perplexity Export";
    const threadTs = thread.last_query_datetime || undefined;

    sendProgress({ phase: "exporting", done, total, currentTitle: threadTitle, currentIndex: i, prevIndex: prevIdx, prevOk });
    prevIdx = i;

    try {
      if (!threadId) throw new Error("thread ID なし");

      const params = new URLSearchParams({
        with_parent_info: "true",
        with_schematized_response: "true",
        version: "2.18",
        source: "default",
        limit: "10",
        offset: "0",
        from_first: "true",
      });
      BLOCK_TYPES.forEach((t) => params.append("supported_block_use_cases", t));

      const r = await fetch(
        `https://www.perplexity.ai/rest/thread/${threadId}?${params}`,
        { method: "GET", credentials: "include", headers: THREAD_HEADERS }
      );
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();

      const messages = [];
      for (const entry of data?.entries ?? []) {
        const ts = entry.entry_updated_datetime || entry.updated_datetime || undefined;
        if (entry.query_str?.trim()) {
          messages.push({ role: "user", content: entry.query_str.trim(), timestamp: ts });
        }
        const content = extractAssistantContent(entry.blocks ?? []);
        if (content) messages.push({ role: "assistant", content, timestamp: ts });
      }

      const sources = [];
      const seenUrls = new Set();
      for (const entry of data?.entries ?? []) {
        for (const block of entry.blocks ?? []) {
          if (block.intended_usage === "web_results") {
            for (const wr of block.web_result_block?.web_results ?? []) {
              if (wr.url && !seenUrls.has(wr.url)) {
                seenUrls.add(wr.url);
                sources.push({ title: wr.name || wr.url, url: wr.url });
              }
            }
          }
        }
      }

      const title =
        data?.entries?.find((e) => e.thread_title)?.thread_title || threadTitle;

      const result = await chrome.runtime.sendMessage({
        type: "EXPORT",
        format,
        dest,
        folder,
        data: {
          service: "perplexity",
          title,
          exportedAt: new Date().toISOString(),
          chatTime: messages.find((m) => m.timestamp)?.timestamp || threadTs,
          url: `https://www.perplexity.ai/search/${threadId}`,
          messages,
          sources,
        },
      });

      if (result?.ok) { done++; prevOk = true; }
      else { errors++; prevOk = false; }
    } catch (_) {
      errors++;
      prevOk = false;
    }

    await sleep(400);
  }

  sendProgress({ phase: "done", done, errors, total, prevIndex: prevIdx, prevOk });
  return { done, errors, total };
}

async function doExportAllGemini(format, dest, jobId) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const sendProgress = (data) => {
    try { chrome.runtime.sendMessage({ type: "EXPORT_ALL_PROGRESS", jobId, ...data }); } catch (_) {}
  };

  const wiz = readWizData();
  const at  = wiz?.SNlM0e;
  const sid = wiz?.FdrFJe;
  const bl  = wiz?.cfb2h;

  if (!at || !bl) {
    return { error: "認証トークンが見つかりません。ページをリロードしてから再試行してください。" };
  }

  const uPrefix = location.pathname.match(/^(\/u\/\d+)/)?.[1] ?? "";

  sendProgress({ phase: "listing", done: 0, total: 0 });

  const recentResp = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: "GEMINI_LIST_FETCH",
      at, sid, bl, uPrefix, isPinned: false,
      hl: navigator.language || "ja"
    }, resolve);
  });

  const pinnedResp = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: "GEMINI_LIST_FETCH",
      at, sid, bl, uPrefix, isPinned: true,
      hl: navigator.language || "ja"
    }, resolve);
  });

  const chatsMap = new Map();
  if (pinnedResp?.ok && pinnedResp.text) {
    const items = parseListResponse(pinnedResp.text);
    for (const item of items) chatsMap.set(item.id, item);
  }
  if (recentResp?.ok && recentResp.text) {
    const items = parseListResponse(recentResp.text);
    for (const item of items) {
      if (!chatsMap.has(item.id)) chatsMap.set(item.id, item);
    }
  }
  const items = Array.from(chatsMap.values());

  sendProgress({ phase: "listing", done: items.length, total: items.length, newTitles: items.map((i) => i.title) });
  if (items.length === 0) {
    return { error: "会話が見つかりませんでした。" };
  }

  const total = items.length;
  const folder = `gemini_${new Date().toISOString().slice(0, 10)}`;
  let done = 0;
  let errors = 0;
  let prevIdx = -1;
  let prevOk = null;

  for (const [i, item] of items.entries()) {
    const convId = item.id.replace(/^c_/, "");
    sendProgress({ phase: "exporting", done, total, currentTitle: item.title, currentIndex: i, prevIndex: prevIdx, prevOk });
    prevIdx = i;

    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: "GEMINI_FETCH",
          convId,
          at, sid, bl, uPrefix,
          hl: navigator.language || "ja"
        }, resolve);
      });

      if (!resp?.ok) throw new Error(resp?.error || "Fetch failed");

      const messages = parseResponse(resp.text);

      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: "EXPORT",
          service: "gemini",
          format,
          dest,
          folder,
          data: {
            service: "gemini",
            title: item.title,
            exportedAt: new Date().toISOString(),
            chatTime: item.timestamp || messages.find(m => m.timestamp)?.timestamp,
            url: `https://gemini.google.com${uPrefix}/app/${convId}`,
            messages,
          }
        }, resolve);
      });

      if (result?.ok) { done++; prevOk = true; }
      else { errors++; prevOk = false; }
    } catch (_) {
      errors++;
      prevOk = false;
    }

    await sleep(300);
  }

  sendProgress({ phase: "done", done, errors, total, prevIndex: prevIdx, prevOk });
  return { done, errors, total };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function readWizData() {
    for (const script of document.querySelectorAll("script:not([src])")) {
      const text = script.textContent;
      const idx = text.indexOf("WIZ_global_data");
      if (idx === -1) continue;
      const eqIdx = text.indexOf("=", idx);
      if (eqIdx === -1) continue;
      const braceIdx = text.indexOf("{", eqIdx);
      if (braceIdx === -1) continue;
      const jsonStr = sliceBalanced(text, braceIdx);
      if (!jsonStr) continue;
      try { return JSON.parse(jsonStr); } catch (_) { continue; }
    }
    return null;
  }

  function parseListResponse(text) {
    const start = text.indexOf("[");
    if (start === -1) return [];

    const envStr = sliceBalanced(text, start);
    if (!envStr) return [];

    let envelope;
    try { envelope = JSON.parse(envStr); }
    catch (_) { return []; }

    const entry = envelope.find(e => Array.isArray(e) && e[0] === "wrb.fr" && e[1] === "MaZiqc");
    if (!entry) return [];

    let data;
    try { data = JSON.parse(entry[2]); }
    catch (_) { return []; }

    const chatList = data?.[2];
    if (!Array.isArray(chatList)) return [];

    const items = [];
    for (const chatData of chatList) {
      if (Array.isArray(chatData) && chatData.length > 1) {
        const cid = chatData[0];
        const title = chatData[1];
        const timestampData = chatData[5];
        let timestamp = undefined;
        if (Array.isArray(timestampData) && typeof timestampData[0] === "number") {
          timestamp = new Date(timestampData[0] * 1000).toISOString();
        }
        if (cid && typeof cid === "string") {
          items.push({ id: cid, title: title || "Untitled", timestamp });
        }
      }
    }
    return items;
  }

  function parseResponse(text) {
    const start = text.indexOf("[");
    if (start === -1) throw new Error("API レスポンスのパースに失敗しました。");

    const envStr = sliceBalanced(text, start);
    if (!envStr) throw new Error("API レスポンスのパースに失敗しました。");

    let envelope;
    try { envelope = JSON.parse(envStr); }
    catch (_) { throw new Error("API レスポンスのパースに失敗しました。"); }

    const entry = envelope.find(e => Array.isArray(e) && e[0] === "wrb.fr" && e[1] === "hNvQHb");
    if (!entry) throw new Error("会話データが見つかりませんでした。");

    let data;
    try { data = JSON.parse(entry[2]); }
    catch (_) { throw new Error("会話データのパースに失敗しました。"); }

    const rawTurns = data?.[0];
    if (!Array.isArray(rawTurns)) return [];

    const turns = rawTurns
      .map((turn) => {
        const tsArr = turn?.[turn.length - 1];
        const tsSec = Array.isArray(tsArr) && typeof tsArr[0] === "number" ? tsArr[0] : null;
        return { turn, tsSec };
      })
      .sort((a, b) => (a.tsSec ?? 0) - (b.tsSec ?? 0));

    const messages = [];
    for (const { turn, tsSec } of turns) {
      const timestamp = tsSec ? new Date(tsSec * 1000).toISOString() : undefined;
      const userText  = turn?.[2]?.[0]?.[0];
      const modelParts = turn?.[3]?.[0]?.[0]?.[1];
      const modelText = Array.isArray(modelParts)
        ? modelParts.filter(s => typeof s === "string").join("")
        : (typeof modelParts === "string" ? modelParts : null);

      const thinkingParts = turn?.[3]?.[0]?.[0]?.[37]?.[0]?.[0];
      const thinkingText = Array.isArray(thinkingParts)
        ? thinkingParts.filter(s => typeof s === "string").join("").trim()
        : null;

      if (typeof userText === "string" && userText.trim())
        messages.push({ role: "user", content: userText.trim(), timestamp });

      if (modelText?.trim()) {
        const cleaned = removeCitations(modelText.trim());
        const content = thinkingText
          ? `<details><summary>Thinking</summary>\n\n${thinkingText}\n\n</details>\n\n${cleaned}`
          : cleaned;
        messages.push({ role: "assistant", content, timestamp });
      }
    }

    return messages;
  }

  function removeCitations(text) {
    if (!text.includes("[cite_start]") && !text.includes("[cite:")) return text;
    return text
      .replace(/\[cite_start\]/g, "")
      .replace(/\[cite:\s*[^\]]+\]/g, "");
  }

  function sliceBalanced(text, pos) {
    const OPEN = text[pos];
    if (OPEN !== "[" && OPEN !== "{") return null;
    const CLOSE = OPEN === "[" ? "]" : "}";
    let depth = 0, inStr = false;
    for (let i = pos; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
      } else if (c === OPEN) {
        depth++;
      } else if (c === CLOSE && --depth === 0) {
        return text.slice(pos, i + 1);
      }
    }
    return null;
  }
}
