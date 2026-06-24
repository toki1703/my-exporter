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
  return false;
});

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
