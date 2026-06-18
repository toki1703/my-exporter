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

function showProgress() {
  document.getElementById("progress-section").classList.remove("hidden");
}

function hideProgress() {
  document.getElementById("progress-section").classList.add("hidden");
}

function updateProgress({ phase, done = 0, total = 0, currentTitle = "" }) {
  const label = document.getElementById("progress-label");
  const count = document.getElementById("progress-count");
  const fill  = document.getElementById("progress-fill");

  count.textContent = total > 0 ? `${done} / ${total}` : "";

  if (phase === "listing") {
    label.textContent = "会話リストを取得中...";
    fill.style.width = total > 0 ? `${(done / total) * 20}%` : "5%";
  } else if (phase === "exporting") {
    const short = currentTitle ? `「${currentTitle.slice(0, 24)}」` : "";
    label.textContent = short ? `${short} をエクスポート中` : "エクスポート中...";
    fill.style.width = total > 0 ? `${20 + (done / total) * 80}%` : "20%";
  } else if (phase === "done") {
    label.textContent = "完了";
    fill.style.width = "100%";
  }
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
  updateProgress(msg);
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

async function runBulkExport({ btn, label, hosts, openHint, func }) {
  if (btn.disabled) return;

  btn.disabled = true;
  btn.textContent = "実行中…";
  showProgress();
  hideMessage();
  updateProgress({ phase: "listing", done: 0, total: 0 });

  try {
    const tab = await findServiceTab(hosts);
    if (!tab) throw new Error(`${openHint} のタブを開いてから実行してください`);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func,
      args: [selectedFormat, selectedDest],
    });

    const result = results?.[0]?.result;
    if (result?.error) throw new Error(result.error);

    const errNote = result?.errors > 0 ? `（エラー: ${result.errors} 件）` : "";
    const destNote = selectedDest === "obsidian" ? "Obsidian" : "Downloads/my-exporter/";
    showMessage(`${result?.done} 件エクスポート完了！${errNote} → ${destNote}`, "success");
  } catch (err) {
    showMessage(err.message, "error");
    hideProgress();
  } finally {
    btn.disabled = false;
    btn.textContent = "実行";
  }
}

document.getElementById("btn-chatgpt-all").addEventListener("click", (e) => {
  runBulkExport({
    btn: e.currentTarget,
    hosts: ["chatgpt.com", "chat.openai.com"],
    openHint: "ChatGPT",
    func: doExportAll,
  });
});

document.getElementById("btn-claude-all").addEventListener("click", (e) => {
  runBulkExport({
    btn: e.currentTarget,
    hosts: ["claude.ai"],
    openHint: "Claude",
    func: doExportAllClaude,
  });
});

// =============================================================
// Self-contained functions injected into the page via executeScript
// (No closure access — all external values must come via args)
// =============================================================

async function doExportAll(format, dest) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const sendProgress = (data) => {
    try { chrome.runtime.sendMessage({ type: "EXPORT_ALL_PROGRESS", ...data }); } catch (_) {}
  };

  // Auth token
  const sessionResp = await fetch("/api/auth/session", { credentials: "include" });
  const session = sessionResp.ok ? await sessionResp.json() : {};
  const token = session?.accessToken;
  const headers = {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

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
    sendProgress({ phase: "listing", done: items.length, total: page.total });
    if (page.items.length < 100) break;
    offset += 100;
    await sleep(300);
  }

  const total = items.length;
  // folder is used for file downloads only (Obsidian handles its own path)
  const folder = `chatgpt_${new Date().toISOString().slice(0, 10)}`;
  let done = 0;
  let errors = 0;

  for (const item of items) {
    sendProgress({ phase: "exporting", done, total, currentTitle: item.title });

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
          const text = (msg.content?.parts ?? [])
            .filter((p) => typeof p === "string")
            .join("\n")
            .trim();
          if (text) {
            const timestamp = msg.create_time
              ? new Date(msg.create_time * 1000).toISOString()
              : undefined;
            messages.push({
              role: msg.author.role === "user" ? "user" : "assistant",
              content: text,
              timestamp,
            });
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

      if (result?.ok) done++;
      else errors++;
    } catch (_) {
      errors++;
    }

    await sleep(300);
  }

  sendProgress({ phase: "done", done, errors, total });
  return { done, errors, total };
}

async function doExportAllClaude(format, dest) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const sendProgress = (data) => {
    try { chrome.runtime.sendMessage({ type: "EXPORT_ALL_PROGRESS", ...data }); } catch (_) {}
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
    sendProgress({ phase: "listing", done: conversations.length, total: conversations.length });
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

  for (const conv of conversations) {
    const convId = conv.uuid;
    const convTitle = conv.name || "Claude Export";
    sendProgress({ phase: "exporting", done, total, currentTitle: convTitle });

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

      if (result?.ok) done++;
      else errors++;
    } catch (_) {
      errors++;
    }

    await sleep(300);
  }

  sendProgress({ phase: "done", done, errors, total });
  return { done, errors, total };
}
