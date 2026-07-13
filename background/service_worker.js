import { toJson } from "../exporters/json_exporter.js";
import { toMarkdown } from "../exporters/markdown_exporter.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "SET_BADGE") return false;

  const count = message.count ?? 0;
  const text = count > 0 ? String(count) : "";
  const tabId = sender.tab?.id;
  const opts = tabId !== undefined ? { tabId } : {};

  chrome.action.setBadgeText({ text, ...opts });
  if (text) {
    chrome.action.setBadgeBackgroundColor({ color: message.color || "#666666", ...opts });
  }
  sendResponse({ ok: true });
  return false;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "EXPORT") return false;

  handleExport(message).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });

  return true;
});

// Gemini's batchexecute endpoint must be fetched here (not from the content
// script, where it fails with "Failed to fetch"). We have the gemini.google.com
// host permission, so this request carries the user's cookies and bypasses the
// CORS/context restrictions that block the content script.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GEMINI_FETCH") return false;

  fetchGeminiTurns(message).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });

  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GEMINI_LIST_FETCH") return false;

  fetchGeminiList(message).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });

  return true;
});

// Perplexity thread-list fetch — must run from the service worker because
// the /rest/user/threads endpoint sets SameSite=Strict cookies that a content
// script context cannot include in cross-origin requests from the extension.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "PERPLEXITY_LIST_FETCH") return false;

  fetchPerplexityThreadList(message).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });

  return true;
});

// Generic image fetch — image CDNs (lh3.googleusercontent.com,
// pplx-res.cloudinary.com) reject cross-origin fetches from content scripts.
// The service worker has host permissions for them, so it can fetch with the
// user's cookies and return the image as a base64 data URL.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "FETCH_IMAGE") return false;

  fetchImageAsDataUrl(message.url).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });

  return true;
});

async function fetchImageAsDataUrl(url) {
  const resp = await fetch(url, { credentials: "include" });
  if (!resp.ok) {
    return { ok: false, error: `画像取得エラー: ${resp.status}` };
  }
  const blob = await resp.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const type = blob.type || "image/png";
  return { ok: true, dataUrl: `data:${type};base64,${btoa(binary)}`, mimeType: type };
}

// Google AI Mode — AimThreadsService/ListThreads fetch.
// Called by the google_ai_mode content script to obtain the thread creation
// timestamp for the current conversation, which is used as chatTime.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "AIM_LIST_THREADS") {
    fetchAimThreadList(message).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
  if (message.type === "AIM_GET_THREAD") {
    fetchAimThread(message).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
  if (message.type === "AIM_FETCH_THREAD_CONTENT") {
    fetchAimThreadContent(message).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
  return false;
});

// Open a background tab for the given Google AI Mode thread URL, wait for the
// page to render, extract the conversation content, then close the tab.
async function fetchAimThreadContent({ title, threadId }) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", title);
  url.searchParams.set("udm", "50");
  if (threadId) url.searchParams.set("mtid", threadId);

  const tab = await chrome.tabs.create({ url: url.toString(), active: false });
  const tabId = tab.id;

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdate);
        reject(new Error("ページ読み込みタイムアウト"));
      }, 20000);

      function onUpdate(id, info) {
        if (id === tabId && info.status === "complete") {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdate);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdate);
    });

    // Wait for the AI content to be rendered by JavaScript.
    await new Promise((r) => setTimeout(r, 5000));

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractAimModeContent,
    });

    const data = results?.[0]?.result;
    if (!data) return { ok: false, error: "コンテンツを取得できませんでした" };
    return { ok: true, data };
  } finally {
    chrome.tabs.remove(tabId).catch(() => {});
  }
}

// Self-contained extractor injected into the Google AI Mode tab.
// Uses the same selectors as content_scripts/google_ai_mode.js.
function extractAimModeContent() {
  function getTurnRoots() {
    const containers = Array.from(document.querySelectorAll('[data-subtree="aimc"]'));
    if (containers.length) {
      const roots = containers.map(findTurnRoot).filter(Boolean);
      const unique = Array.from(new Set(roots));
      if (unique.length) return unique;
    }
    return Array.from(document.querySelectorAll(".CKgc1d"));
  }

  function findTurnRoot(el) {
    let n = el;
    for (let i = 0; i < 10 && n; i++) {
      if (n.querySelector(".iMqumd")) return n;
      n = n.parentElement;
    }
    return null;
  }

  function clean(el) {
    return el?.innerText?.replace(/\n{3,}/g, "\n\n").trim() ?? "";
  }

  function removeNoise(el) {
    Array.from(new Set(
      Array.from(el.querySelectorAll("button[aria-label]"))
        .map((b) => b.parentElement).filter((p) => p && p !== el)
    )).forEach((p) => p.remove());
    el.querySelectorAll(
      "button,style,script,noscript,svg,[hidden],[style*='display:none'],[style*='display: none']"
    ).forEach((n) => n.remove());
  }

  function userText(root) {
    const q = root.querySelector(".iMqumd");
    if (!q) return "";
    const p = q.parentElement;
    if (!p) return clean(q);
    const c = p.cloneNode(true);
    c.querySelector(".iMqumd")?.remove();
    removeNoise(c);
    return (c.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function assistantText(root) {
    const cols = Array.from(root.querySelectorAll('[data-container-id="main-col"]'));
    if (cols.length) {
      return cols.map((col) => {
        const c = col.cloneNode(true);
        removeNoise(c);
        return clean(c);
      }).filter(Boolean).join("\n\n");
    }
    const u = userText(root);
    const full = clean(root);
    return u ? full.replace(u, "").replace(/^\s+/, "") : full;
  }

  function extractSources(root) {
    const seen = new Map();
    Array.from(root.querySelectorAll("ul.bTFeG li a[href]")).forEach((a) => {
      let href = a.getAttribute("href") || "";
      try {
        const u = new URL(href, location.origin);
        href = (u.pathname === "/url" && u.searchParams.get("url")) || u.href;
      } catch { return; }
      if (!href || seen.has(href)) return;
      const label = (a.getAttribute("aria-label") || "")
        .replace(/\.?\s*Opens in a new tab\.?\s*$/i, "").trim();
      const domain = (() => { try { return new URL(href).hostname.replace(/^www\./, ""); } catch { return href; } })();
      seen.set(href, { title: (label || a.textContent || href).replace(/\s+/g, " ").trim(), url: href, domain });
    });
    return Array.from(seen.values());
  }

  const params = new URLSearchParams(location.search);
  const query = params.get("q")?.trim() ?? "";
  const roots = getTurnRoots();
  const turns = roots
    .map((r) => ({ u: userText(r), a: assistantText(r), s: extractSources(r) }))
    .filter((t) => t.u || t.a || t.s.length);

  const messages = [];
  for (const t of turns) {
    if (t.u) messages.push({ role: "user", content: t.u });
    if (t.a) messages.push({ role: "assistant", content: t.a });
  }
  if (messages.length && messages[0].role !== "user" && query) {
    messages.unshift({ role: "user", content: query });
  }

  const seenUrls = new Set();
  const sources = turns.flatMap((t) => t.s).filter((s) => {
    if (!s.url || seenUrls.has(s.url)) return false;
    seenUrls.add(s.url);
    return true;
  });

  const t = document.title.trim();
  const parts = t.split(" - ").map((p) => p.trim()).filter(Boolean);
  const title = parts.length > 1 ? parts.slice(0, -1).join(" - ") : t;

  return { messages, sources, title: title || `Google AI: ${query}` };
}

async function fetchGeminiTurns({ convId, at, sid, bl, uPrefix, hl }) {
  const prefix = uPrefix || "";

  const params = new URLSearchParams({
    rpcids: "hNvQHb",
    "source-path": `${prefix}/app/${convId}`,
    bl,
    "f.sid": sid || "",
    hl: hl || "ja",
    rt: "c",
  });

  // Payload: ["c_CONV_ID", numTurns, null, 1, [0], [4], null, 1]
  // numTurns=1000 requests the full history in one call.
  const fReq = JSON.stringify([[
    ["hNvQHb", JSON.stringify([`c_${convId}`, 1000, null, 1, [0], [4], null, 1]), null, "generic"],
  ]]);

  const body = new URLSearchParams({ "f.req": fReq, at });

  const resp = await fetch(
    `https://gemini.google.com${prefix}/_/BardChatUi/data/batchexecute?${params}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-same-domain": "1",
      },
      body: body.toString(),
    }
  );

  if (!resp.ok) {
    return { ok: false, error: `Gemini API エラー: ${resp.status}` };
  }

  return { ok: true, text: await resp.text() };
}

async function fetchGeminiList({ at, sid, bl, uPrefix, hl, isPinned }) {
  const prefix = uPrefix || "";

  const params = new URLSearchParams({
    rpcids: "MaZiqc",
    "source-path": `${prefix}/`,
    bl,
    "f.sid": sid || "",
    hl: hl || "ja",
    rt: "c",
  });

  const flag = isPinned ? 1 : 0;
  const fReq = JSON.stringify([[
    ["MaZiqc", JSON.stringify([150, null, [flag, null, 1]]), null, "generic"],
  ]]);

  const body = new URLSearchParams({ "f.req": fReq, at });

  const resp = await fetch(
    `https://gemini.google.com${prefix}/_/BardChatUi/data/batchexecute?${params}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-same-domain": "1",
      },
      body: body.toString(),
    }
  );

  if (!resp.ok) {
    return { ok: false, error: `Gemini API エラー: ${resp.status}` };
  }

  return { ok: true, text: await resp.text() };
}

async function fetchAimThreadList({ rlz, aep, amc, opi }) {
  const params = new URLSearchParams({
    aep: aep || "42",
    amc: amc || "1",
    source: "chrome.crn.rb",
    sourceid: "chrome",
    udm: "50",
    "reqpld": "[null,null,0]",
    msc: "gwsclient",
  });
  if (rlz) params.set("rlz", rlz);
  if (opi) params.set("opi", opi);

  const resp = await fetch(
    `https://www.google.com/httpservice/web/AimThreadsService/ListThreads?${params}`,
    { method: "GET", credentials: "include", headers: { Accept: "*/*" } }
  );

  return { ok: true, text: await resp.text() };
}

async function fetchAimThread({ threadId, sessionId, rlz, aep, amc, opi }) {
  const params = new URLSearchParams({
    aep: aep || "42",
    amc: amc || "1",
    source: "chrome.crn.rb",
    sourceid: "chrome",
    udm: "50",
    "reqpld": JSON.stringify([threadId, sessionId]),
    msc: "gwsclient",
  });
  if (rlz) params.set("rlz", rlz);
  if (opi) params.set("opi", opi);

  const resp = await fetch(
    `https://www.google.com/httpservice/web/AimThreadsService/GetThread?${params}`,
    { method: "GET", credentials: "include", headers: { Accept: "*/*" } }
  );

  if (!resp.ok) {
    return { ok: false, error: `AimThreadsService/GetThread エラー: ${resp.status}` };
  }

  return { ok: true, text: await resp.text() };
}

async function fetchPerplexityThreadList({ offset, limit }) {
  const pageLimit = limit ?? 50;
  const pageOffset = offset ?? 0;

  const url = "https://www.perplexity.ai/rest/thread/list_ask_threads?version=2.18&source=default";

  const resp = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      "x-app-apiclient": "default",
      "x-app-apiversion": "2.18",
      "x-perplexity-request-endpoint": url,
      "x-perplexity-request-reason": "library-threads",
      "x-perplexity-request-try-number": "1",
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      limit: pageLimit,
      ascending: false,
      offset: pageOffset,
      search_term: "",
      exclude_asi: false,
      include_assets: true,
    }),
  });

  if (!resp.ok) {
    return { ok: false, error: `Perplexity スレッドリスト取得エラー: ${resp.status}` };
  }

  const data = await resp.json();
  return { ok: true, data };
}

function sanitizeFilename(str) {
  return str
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80)
    .replace(/^_|_$/g, "");
}

async function handleExport({ format, data, folder, dest }) {
  if (dest === "obsidian") {
    return exportToObsidian(format, data);
  }
  return exportToFile(format, data, folder);
}

// --- File download ---

async function exportToFile(format, data, folder) {
  const filename = sanitizeFilename(data?.title || data?.service || "export");
  const subfolder = folder ? `${sanitizeFilename(folder)}/` : "";

  let content, mimeType, ext;
  if (format === "markdown") {
    content = toMarkdown(data, data.service);
    mimeType = "text/markdown";
    ext = "md";
  } else {
    content = toJson(data, data.service);
    mimeType = "application/json";
    ext = "json";
  }

  const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  await chrome.downloads.download({
    url: dataUrl,
    filename: `my-exporter/${subfolder}${filename}.${ext}`,
    saveAs: false,
  });

  return { ok: true };
}

// --- Obsidian Local REST API ---

async function exportToObsidian(format, data) {
  const s = await chrome.storage.local.get(["obsidianApiKey", "obsidianVaultPath", "obsidianBaseUrl"]);

  if (!s.obsidianApiKey) {
    throw new Error("Obsidian API キーが設定されていません（ポップアップの Obsidian 設定から入力してください）");
  }

  const baseUrl = (s.obsidianBaseUrl || "http://127.0.0.1:27123").replace(/\/$/, "");
  const vaultFolder = s.obsidianVaultPath || "";

  // Always write as Markdown to Obsidian regardless of format toggle
  const content = toMarkdown(data, data.service);
  const filename = sanitizeFilename(data?.title || data?.service || "export");

  const pathSegments = [
    ...vaultFolder.split("/").filter(Boolean),
    `${filename}.md`,
  ].map(encodeURIComponent);

  const url = `${baseUrl}/vault/${pathSegments.join("/")}`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "text/markdown",
      "Authorization": `Bearer ${s.obsidianApiKey}`,
    },
    body: content,
  });

  if (!resp.ok && resp.status !== 204) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Obsidian API エラー: ${resp.status} ${body}`);
  }

  return { ok: true };
}
